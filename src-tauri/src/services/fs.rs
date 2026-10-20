//! エディタのためのファイル操作(一覧・読み込み・保存)。契約書 docs/stage3-contract.md §4。
//! パスの検証は `resolve` に集めてある。list_dir / read_file / write_file は必ずここを通る(漏れ防止)。
use crate::domain::{
    ContentKind, EditorSession, EntryKind, Eol, FileContent, FileList, FileStat, FsEntry,
    SavedFile, SessionTab, TextEncoding,
};
use std::cmp::Ordering;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

/// クイックオープンの一覧の上限(超えたら打ち切り)
const MAX_LIST_FILES: usize = 50_000;
pub(crate) const MAX_BYTES: u64 = 2 * 1024 * 1024;
pub(crate) const BINARY_SNIFF: usize = 8000;
pub(crate) const BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];
const TMP_PREFIX: &str = ".tactile-tmp-";
/// 一覧に常に出さない名前(どの階層でも)
const HIDDEN_NAMES: [&str; 6] = [
    ".git",
    "node_modules",
    "target",
    ".venv",
    "venv",
    "__pycache__",
];
const RESERVED: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

// ---------------------------------------------------------------- パスの検証

/// 検証を通ったパス。`path` は canonicalize 済み(実体)で、ルートの内側であることが確認済み。
struct Resolved {
    path: PathBuf,
}

fn is_dot_git(name: &str) -> bool {
    name.eq_ignore_ascii_case(".git")
}

/// 相対パス文字列の字面の検証。要素のリストを返す(ルートは空)。
fn validate_rel(rel: &str) -> Result<Vec<&str>, String> {
    if rel.is_empty() {
        return Ok(Vec::new());
    }
    if rel.starts_with('/') {
        return Err("絶対パスは使えません".to_string());
    }
    let parts: Vec<&str> = rel.split('/').collect();
    for part in &parts {
        if part.is_empty() {
            return Err("パスに空の要素があります".to_string());
        }
        if *part == "." || *part == ".." {
            return Err("パスに . や .. は使えません".to_string());
        }
        // `\` はWindowsの区切り、`:` はドライブ指定や代替データストリーム(file:stream)を防ぐ
        if part
            .chars()
            .any(|c| matches!(c, '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*') || c.is_control())
        {
            return Err("パスに使えない文字が含まれています".to_string());
        }
        if part.ends_with('.') || part.ends_with(' ') {
            return Err("名前の末尾に . や空白は使えません".to_string());
        }
        // CON.txt のように拡張子が付いても予約名(最初の . までを見る)
        let stem = part.split('.').next().unwrap_or("").to_lowercase();
        if RESERVED.contains(&stem.as_str()) {
            return Err("Windows の予約名は使えません".to_string());
        }
        if is_dot_git(part) {
            return Err(".git の中は開けません".to_string());
        }
    }
    Ok(parts)
}

fn norm_component(s: &std::ffi::OsStr) -> String {
    let s = s.to_string_lossy();
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s.to_string()
    }
}

/// `target` が `root` の内側なら、ルートからの残りの要素を返す。
/// どちらも canonicalize 済み(同じ `\\?\` 形式)が前提。Windows では大文字小文字を区別しない。
fn relative_inside(root: &Path, target: &Path) -> Option<Vec<String>> {
    let mut t = target.components();
    for r in root.components() {
        let tc = t.next()?;
        if norm_component(r.as_os_str()) != norm_component(tc.as_os_str()) {
            return None;
        }
    }
    Some(
        t.map(|c| c.as_os_str().to_string_lossy().to_string())
            .collect(),
    )
}

fn io_msg(e: &std::io::Error, action: &str) -> String {
    use std::io::ErrorKind::*;
    match e.kind() {
        NotFound => "ファイルが見つかりません".to_string(),
        PermissionDenied => format!(
            "{action}権限がありません(読み取り専用か、ほかのアプリが使用中の可能性があります)"
        ),
        _ => format!("{action}ときにエラーが発生しました"),
    }
}

/// すべての入口が通る唯一の検証。存在するパスだけを受け付け、実体のパスを返す。
fn resolve(root: &Path, rel: &str) -> Result<Resolved, String> {
    let parts = validate_rel(rel)?;
    let canon_root = root
        .canonicalize()
        .map_err(|_| "プロジェクトのフォルダが見つかりません".to_string())?;
    let mut joined = canon_root.clone();
    for p in &parts {
        joined.push(p);
    }
    let canon = joined.canonicalize().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => "ファイルが見つかりません".to_string(),
        _ => "パスを解決できませんでした".to_string(),
    })?;
    // シンボリックリンク・ジャンクションで外へ出ていないか(実体のパスで判定)
    let inner = relative_inside(&canon_root, &canon)
        .ok_or_else(|| "プロジェクトの外には出られません".to_string())?;
    // リンク先が .git の中(8.3短縮名なども実体にすれば現れる)でも拒否する
    if inner.iter().any(|c| is_dot_git(c)) {
        return Err(".git の中は開けません".to_string());
    }
    Ok(Resolved { path: canon })
}

// ---------------------------------------------------------------- 補助

fn fmt_time(t: SystemTime) -> Option<String> {
    OffsetDateTime::from(t).format(&Rfc3339).ok()
}

/// 読み込み時と保存直前で同じ関数を使い、文字列の比較にする。
fn modified_of(md: &std::fs::Metadata) -> Option<String> {
    md.modified().ok().and_then(fmt_time)
}

fn is_reparse(md: &std::fs::Metadata) -> bool {
    if md.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if md.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    false
}

/// 大文字小文字を区別せず、数字は自然順(file2 < file10)で比べる。
fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (mut ai, mut bi) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return a.cmp(b),
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let take = |it: &mut std::iter::Peekable<std::str::Chars>| {
                    let mut s = String::new();
                    while let Some(c) = it.peek().copied().filter(char::is_ascii_digit) {
                        s.push(c);
                        it.next();
                    }
                    s
                };
                let (na, nb) = (take(&mut ai), take(&mut bi));
                let (ta, tb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                let o = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
                if o != Ordering::Equal {
                    return o;
                }
            }
            (Some(x), Some(y)) => {
                let o = x.to_lowercase().cmp(y.to_lowercase());
                if o != Ordering::Equal {
                    return o;
                }
                ai.next();
                bi.next();
            }
        }
    }
}

fn join_rel(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_string()
    } else {
        format!("{dir}/{name}")
    }
}

// ---------------------------------------------------------------- 一覧

pub fn list_dir(root: &Path, rel: &str) -> Result<Vec<FsEntry>, String> {
    let dir = resolve(root, rel)?;
    if !dir.path.is_dir() {
        return Err("フォルダではありません".to_string());
    }
    let rd = std::fs::read_dir(&dir.path).map_err(|e| io_msg(&e, "フォルダを読む"))?;
    let mut out = Vec::new();
    for ent in rd.flatten() {
        let Some(name) = ent.file_name().to_str().map(str::to_string) else {
            continue; // UTF-8 で表せない名前は、relPath で往復できないので出さない
        };
        if HIDDEN_NAMES.iter().any(|h| name.eq_ignore_ascii_case(h)) || name.starts_with(TMP_PREFIX)
        {
            continue;
        }
        // 辿れない・リンクは出さない(外へ出る経路を、そもそも見せない)
        let Ok(md) = std::fs::symlink_metadata(ent.path()) else {
            continue;
        };
        if is_reparse(&md) {
            continue;
        }
        let kind = if md.is_dir() {
            EntryKind::Dir
        } else if md.is_file() {
            EntryKind::File
        } else {
            continue;
        };
        out.push(FsEntry {
            rel_path: join_rel(rel, &name),
            name,
            kind,
            size: if kind == EntryKind::File { md.len() } else { 0 },
            modified: modified_of(&md),
        });
    }
    out.sort_by(|a, b| {
        (a.kind == EntryKind::File)
            .cmp(&(b.kind == EntryKind::File))
            .then_with(|| natural_cmp(&a.name, &b.name))
    });
    Ok(out)
}

// ---------------------------------------------------------------- 全ファイル一覧(クイックオープン)

/// プロジェクト内のファイルの相対パス一覧。除外は言語判定(language.rs)と同じ。
pub fn list_files(root: &Path) -> Result<FileList, String> {
    list_files_limited(root, MAX_LIST_FILES)
}

/// 検索の対象列挙(上限は一覧と同じ)。
pub(crate) fn walk_for_search(root: &Path) -> Result<(PathBuf, FileList), String> {
    walk_project_files(root, MAX_LIST_FILES)
}

fn list_files_limited(root: &Path, limit: usize) -> Result<FileList, String> {
    walk_project_files(root, limit).map(|(_, list)| list)
}

/// 全ファイル一覧の本体。検索(search.rs)も同じ列挙・除外を使うため、実体のルートも返す。
pub(crate) fn walk_project_files(root: &Path, limit: usize) -> Result<(PathBuf, FileList), String> {
    // ルートの検証は resolve に任せる(存在しない場合などを弾く)
    let canon_root = resolve(root, "")?.path;
    let walker = ignore::WalkBuilder::new(&canon_root)
        .hidden(false) // .gitignore や .env も開けるように(VSCode と同じ)。.git だけは下で外す
        .require_git(false) // git 管理外でも .gitignore を効かせる
        .git_global(false) // 利用者ごとの設定で結果が変わらないように
        .follow_links(false) // リンク・ジャンクションの先(外側)へ入らない
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            let is_dir = e.file_type().is_some_and(|t| t.is_dir());
            let name = e.file_name().to_string_lossy();
            // .git は中身が膨大なので、入る前に外す(後段の検査より前に)
            !(is_dir
                && (is_dot_git(&name)
                    || crate::services::language::EXCLUDED_DIRS.contains(&name.as_ref())))
        })
        .build();

    let mut rel_paths = Vec::new();
    let mut truncated = false;
    for entry in walker.flatten() {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        // リンクがファイル扱いで混ざらないよう、メタ情報でも確認する
        if entry.metadata().map(|m| is_reparse(&m)).unwrap_or(true) {
            continue;
        }
        // UTF-8 で表せない名前は、relPath で往復できないので出さない
        if entry.file_name().to_str().is_none() {
            continue;
        }
        let Some(inner) = relative_inside(&canon_root, entry.path()) else {
            continue; // 内側と確認できないものは出さない
        };
        if inner.is_empty()
            || inner
                .iter()
                .any(|c| is_dot_git(c) || c.starts_with(TMP_PREFIX))
        {
            continue;
        }
        if rel_paths.len() >= limit {
            truncated = true;
            break;
        }
        rel_paths.push(inner.join("/"));
    }
    rel_paths.sort_by(|a, b| natural_cmp(a, b));
    Ok((
        canon_root,
        FileList {
            rel_paths,
            truncated,
        },
    ))
}

// ---------------------------------------------------------------- 読み込み

const BOM_UTF16LE: [u8; 2] = [0xFF, 0xFE];
const BOM_UTF16BE: [u8; 2] = [0xFE, 0xFF];

/// 文字コードの判定・変換の結果(デコード側)。
enum Decoded {
    Text {
        text: String,
        encoding: TextEncoding,
        has_bom: bool,
    },
    Binary,
    Unsupported {
        encoding: TextEncoding,
        has_bom: bool,
    },
}

/// UTF-16 は encoding_rs ではエンコードできない(デコードだけ)ため、両方向とも手書きで揃える。
/// 奇数バイトや対の壊れたサロゲートは None(置換文字にしない)。
fn decode_utf16(body: &[u8], little: bool) -> Option<String> {
    if !body.len().is_multiple_of(2) {
        return None;
    }
    let (pairs, _) = body.as_chunks::<2>();
    let units: Vec<u16> = pairs
        .iter()
        .map(|&c| {
            if little {
                u16::from_le_bytes(c)
            } else {
                u16::from_be_bytes(c)
            }
        })
        .collect();
    String::from_utf16(&units).ok()
}

fn encode_utf16(text: &str, little: bool) -> Vec<u8> {
    text.encode_utf16()
        .flat_map(|u| {
            if little {
                u.to_le_bytes()
            } else {
                u.to_be_bytes()
            }
        })
        .collect()
}

fn legacy_encoding(enc: TextEncoding) -> Option<&'static encoding_rs::Encoding> {
    Some(match enc {
        TextEncoding::ShiftJis => encoding_rs::SHIFT_JIS,
        TextEncoding::EucJp => encoding_rs::EUC_JP,
        TextEncoding::Windows1252 => encoding_rs::WINDOWS_1252,
        TextEncoding::Gbk => encoding_rs::GBK,
        TextEncoding::Big5 => encoding_rs::BIG5,
        TextEncoding::EucKr => encoding_rs::EUC_KR,
        _ => return None,
    })
}

/// BOM の自動処理(encoding_rs の decode)は使わず、不正な並びは置換せず None にする。
fn decode_legacy(body: &[u8], enc: TextEncoding) -> Option<String> {
    legacy_encoding(enc)?
        .decode_without_bom_handling_and_without_replacement(body)
        .map(|s| s.into_owned())
}

fn has_nul_in_head(buf: &[u8]) -> bool {
    buf[..buf.len().min(BINARY_SNIFF)].contains(&0)
}

/// 自動判定(契約 §3)。BOM → NUL(バイナリ)→ UTF-8 → Shift_JIS → EUC-JP の順。
fn detect_and_decode(buf: &[u8]) -> Decoded {
    let utf16 = if buf.starts_with(&BOM_UTF16LE) {
        Some(true)
    } else if buf.starts_with(&BOM_UTF16BE) {
        Some(false)
    } else {
        None
    };
    if let Some(little) = utf16 {
        let encoding = if little {
            TextEncoding::Utf16Le
        } else {
            TextEncoding::Utf16Be
        };
        return match decode_utf16(&buf[2..], little) {
            Some(text) => Decoded::Text {
                text,
                encoding,
                has_bom: true,
            },
            None => Decoded::Unsupported {
                encoding,
                has_bom: true,
            },
        };
    }
    let has_bom = buf.starts_with(&BOM);
    let body = if has_bom { &buf[3..] } else { buf };
    if has_nul_in_head(body) {
        return Decoded::Binary;
    }
    if let Ok(text) = std::str::from_utf8(body) {
        return Decoded::Text {
            text: text.to_string(),
            encoding: TextEncoding::Utf8,
            has_bom,
        };
    }
    if has_bom {
        // UTF-8 の BOM があるのに中身が壊れている → 他の文字コードを推測しない
        return Decoded::Unsupported {
            encoding: TextEncoding::Utf8,
            has_bom,
        };
    }
    for encoding in [TextEncoding::ShiftJis, TextEncoding::EucJp] {
        if let Some(text) = decode_legacy(body, encoding) {
            return Decoded::Text {
                text,
                encoding,
                has_bom: false,
            };
        }
    }
    Decoded::Unsupported {
        encoding: TextEncoding::Utf8,
        has_bom: false,
    }
}

/// 文字コード指定の読み込み。自動判定はせず、不正な並びがあれば Unsupported。
fn decode_as(buf: &[u8], enc: TextEncoding) -> Decoded {
    match enc {
        TextEncoding::Utf16Le | TextEncoding::Utf16Be => {
            let little = enc == TextEncoding::Utf16Le;
            let bom: &[u8] = if little { &BOM_UTF16LE } else { &BOM_UTF16BE };
            let has_bom = buf.starts_with(bom);
            let body = if has_bom { &buf[2..] } else { buf };
            match decode_utf16(body, little) {
                Some(text) => Decoded::Text {
                    text,
                    encoding: enc,
                    has_bom,
                },
                None => Decoded::Unsupported {
                    encoding: enc,
                    has_bom,
                },
            }
        }
        TextEncoding::Utf8 => {
            let has_bom = buf.starts_with(&BOM);
            let body = if has_bom { &buf[3..] } else { buf };
            if has_nul_in_head(body) {
                return Decoded::Binary;
            }
            match std::str::from_utf8(body) {
                Ok(text) => Decoded::Text {
                    text: text.to_string(),
                    encoding: enc,
                    has_bom,
                },
                Err(_) => Decoded::Unsupported {
                    encoding: enc,
                    has_bom,
                },
            }
        }
        _ => {
            if has_nul_in_head(buf) {
                return Decoded::Binary;
            }
            match decode_legacy(buf, enc) {
                Some(text) => Decoded::Text {
                    text,
                    encoding: enc,
                    has_bom: false,
                },
                None => Decoded::Unsupported {
                    encoding: enc,
                    has_bom: false,
                },
            }
        }
    }
}

/// 本文を指定の文字コードのバイト列にする。表せない文字があれば `変換:` で始まるエラー。
fn encode_text(text: &str, enc: TextEncoding, has_bom: bool) -> Result<Vec<u8>, String> {
    match enc {
        TextEncoding::Utf8 => {
            let mut out = Vec::with_capacity(text.len() + 3);
            if has_bom {
                out.extend_from_slice(&BOM);
            }
            out.extend_from_slice(text.as_bytes());
            Ok(out)
        }
        TextEncoding::Utf16Le | TextEncoding::Utf16Be => {
            let little = enc == TextEncoding::Utf16Le;
            // BOM 無しの UTF-16 は自動判定できず開けなくなるため、常に付ける
            let mut out: Vec<u8> = if little { BOM_UTF16LE } else { BOM_UTF16BE }.to_vec();
            out.extend(encode_utf16(text, little));
            Ok(out)
        }
        _ => {
            let e = legacy_encoding(enc).ok_or("変換: 未対応の文字コードです")?;
            let (bytes, _, had_errors) = e.encode(text);
            if had_errors {
                return Err(format!(
                    "変換: 一部の文字が {} で表せません",
                    e.name().to_lowercase()
                ));
            }
            Ok(bytes.into_owned())
        }
    }
}

pub fn read_file(
    root: &Path,
    rel: &str,
    encoding: Option<TextEncoding>,
) -> Result<FileContent, String> {
    let f = resolve(root, rel)?;
    if !f.path.is_file() {
        return Err("ファイルではありません".to_string());
    }
    let mut file = std::fs::File::open(&f.path).map_err(|e| io_msg(&e, "ファイルを開く"))?;
    let md = file.metadata().map_err(|e| io_msg(&e, "ファイルを読む"))?;
    let modified = modified_of(&md).ok_or("更新日時を取得できませんでした")?;
    let mk = |kind, content, size, eol, has_bom, encoding| FileContent {
        rel_path: rel.to_string(),
        kind,
        content,
        size,
        modified: modified.clone(),
        eol,
        has_bom,
        encoding,
    };
    let default_enc = encoding.unwrap_or(TextEncoding::Utf8);
    if md.len() > MAX_BYTES {
        return Ok(mk(
            ContentKind::TooLarge,
            None,
            md.len(),
            Eol::Lf,
            false,
            default_enc,
        ));
    }
    let mut buf = Vec::new();
    // 読む間に大きくなっても、上限+1 で止める
    (&mut file)
        .take(MAX_BYTES + 1)
        .read_to_end(&mut buf)
        .map_err(|e| io_msg(&e, "ファイルを読む"))?;
    let size = buf.len() as u64;
    if size > MAX_BYTES {
        return Ok(mk(
            ContentKind::TooLarge,
            None,
            size,
            Eol::Lf,
            false,
            default_enc,
        ));
    }
    let decoded = match encoding {
        Some(enc) => decode_as(&buf, enc),
        None => detect_and_decode(&buf),
    };
    match decoded {
        Decoded::Binary => Ok(mk(
            ContentKind::Binary,
            None,
            size,
            Eol::Lf,
            false,
            default_enc,
        )),
        Decoded::Unsupported { encoding, has_bom } => Ok(mk(
            ContentKind::UnsupportedEncoding,
            None,
            size,
            Eol::Lf,
            has_bom,
            encoding,
        )),
        Decoded::Text {
            text,
            encoding,
            has_bom,
        } => {
            let eol = match text.find('\n') {
                Some(i) if i > 0 && text.as_bytes()[i - 1] == b'\r' => Eol::Crlf,
                _ => Eol::Lf,
            };
            Ok(mk(
                ContentKind::Text,
                Some(text.replace("\r\n", "\n")),
                size,
                eol,
                has_bom,
                encoding,
            ))
        }
    }
}

// ---------------------------------------------------------------- 書き込み

pub struct WriteRequest<'a> {
    pub content: &'a str,
    pub expected_modified: Option<&'a str>,
    pub eol: Eol,
    pub has_bom: bool,
    pub encoding: TextEncoding,
    pub force: bool,
}

pub fn write_file(root: &Path, rel: &str, req: &WriteRequest) -> Result<SavedFile, String> {
    if req.content.len() as u64 > MAX_BYTES {
        return Err("2MBを超えるため保存できません".to_string());
    }
    // 存在しないパスは resolve が「見つかりません」で拒否する(新規作成は3b)
    let f = resolve(root, rel)?;
    if !f.path.is_file() {
        return Err("ファイルではありません".to_string());
    }
    let md = std::fs::metadata(&f.path).map_err(|e| io_msg(&e, "ファイルを調べる"))?;
    if md.permissions().readonly() {
        return Err("読み取り専用のファイルのため保存できません".to_string());
    }
    let parent = f
        .path
        .parent()
        .ok_or("保存先のフォルダを解決できませんでした")?;

    // 改行を整えてから文字コードへ変換する(変換できなければ、何も書かずに失敗)
    let text = match req.eol {
        Eol::Lf => std::borrow::Cow::Borrowed(req.content),
        Eol::Crlf => {
            std::borrow::Cow::Owned(req.content.replace("\r\n", "\n").replace('\n', "\r\n"))
        }
    };
    let bytes = encode_text(&text, req.encoding, req.has_bom)?;
    // UTF-16 などは UTF-8 より大きくなるので、変換後のサイズでも上限を守る
    if bytes.len() as u64 > MAX_BYTES {
        return Err("2MBを超えるため保存できません".to_string());
    }

    // 同じフォルダに書いてから置き換える(途中で失敗しても元のファイルは壊れない)
    let tmp = parent.join(format!("{TMP_PREFIX}{}", uuid::Uuid::new_v4()));
    let result = write_tmp_and_replace(&tmp, &f.path, &bytes, req);
    if result.is_err() {
        // 自分が作った一時ファイルだけを、絶対パスで消す
        let _ = std::fs::remove_file(&tmp);
    }
    result?;
    let md = std::fs::metadata(&f.path).map_err(|e| io_msg(&e, "ファイルを調べる"))?;
    Ok(SavedFile {
        modified: modified_of(&md).ok_or("更新日時を取得できませんでした")?,
        size: md.len(),
    })
}

fn write_tmp_and_replace(
    tmp: &Path,
    target: &Path,
    bytes: &[u8],
    req: &WriteRequest,
) -> Result<(), String> {
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(tmp)
        .map_err(|e| io_msg(&e, "保存する"))?;
    f.write_all(bytes)
        .and_then(|_| f.flush())
        .and_then(|_| f.sync_all())
        .map_err(|e| io_msg(&e, "保存する"))?;
    drop(f);
    // 競合の検査は、置き換える直前に行う(読んだときと同じ文字列化で比べる)
    if !req.force
        && let Some(expected) = req.expected_modified
    {
        let now = std::fs::metadata(target)
            .map_err(|e| io_msg(&e, "ファイルを調べる"))
            .map(|m| modified_of(&m))?;
        if now.as_deref() != Some(expected) {
            return Err("競合: ほかのアプリでファイルが変更されています".to_string());
        }
    }
    std::fs::rename(tmp, target).map_err(|e| io_msg(&e, "保存する"))
}

// ---------------------------------------------------------------- 外部変更の検知・セッション(段階3b-1)

pub const MAX_STAT_FILES: usize = 200;
pub const MAX_SESSION_TABS: usize = 200;
pub const MAX_SESSION_EXPANDED: usize = 500;
pub const MAX_SESSION_PATH_CHARS: usize = 1000;

/// 更新日時だけを返す。無い・読めない・パスが不正は exists:false(1件の失敗で全体を止めない)。
/// 検証は他と同じ resolve を通す(リンクで外を覗かせない)。
pub fn stat_files(root: &Path, rels: &[String]) -> Result<Vec<FileStat>, String> {
    if rels.len() > MAX_STAT_FILES {
        return Err(format!("一度に調べられるのは{MAX_STAT_FILES}件までです"));
    }
    Ok(rels
        .iter()
        .map(|rel| {
            let modified = resolve(root, rel)
                .ok()
                .and_then(|f| std::fs::metadata(&f.path).ok())
                .filter(|md| md.is_file())
                .and_then(|md| modified_of(&md));
            FileStat {
                rel_path: rel.clone(),
                // 更新日時が取れないファイルは、比較できないので「無い」側に倒す
                exists: modified.is_some(),
                modified,
            }
        })
        .collect())
}

/// 保存前の整え。字面が不正なパスは落とし、長すぎる文字列と件数は切り詰める(エラーにしない)。
/// 存在確認はしない(復元時にフロントが捨てる)。
pub fn sanitize_session(s: EditorSession) -> EditorSession {
    let clean = |p: String| -> Option<String> {
        let p: String = p.chars().take(MAX_SESSION_PATH_CHARS).collect();
        validate_rel(&p).is_ok().then_some(p)
    };
    EditorSession {
        tabs: s
            .tabs
            .into_iter()
            .filter_map(|t| {
                clean(t.rel_path).map(|rel_path| SessionTab {
                    rel_path,
                    md_mode: t.md_mode,
                })
            })
            .take(MAX_SESSION_TABS)
            .collect(),
        active: s.active.and_then(clean),
        expanded: s
            .expanded
            .into_iter()
            .filter_map(clean)
            .take(MAX_SESSION_EXPANDED)
            .collect(),
    }
}

// ---------------------------------------------------------------- ファイル操作(段階3b-2)

/// 親フォルダだけを実体にした位置。対象自身は、まだ無くてもよい(作成・移動先)。
/// 対象自身を canonicalize しないのは、リンク自体を操作の対象にするため(リンク先を触らない)。
struct Located {
    /// 親フォルダ(canonicalize 済み・ルートの内側)
    parent: PathBuf,
    name: String,
    path: PathBuf,
}

/// 空でない相対パスを、親の検証つきで解決する。字面の検証(`.git`・予約名など)は validate_rel が行う。
fn locate(root: &Path, rel: &str) -> Result<Located, String> {
    let parts = validate_rel(rel)?;
    let (name, parent_parts) = parts
        .split_last()
        .ok_or("プロジェクトのフォルダ自体は操作できません")?;
    let parent = resolve(root, &parent_parts.join("/"))?.path;
    if !parent.is_dir() {
        return Err("親のフォルダが見つかりません".to_string());
    }
    Ok(Located {
        path: parent.join(name),
        name: (*name).to_string(),
        parent,
    })
}

/// リンクの切れたものも「在る」と数えるため、symlink_metadata で見る。
fn exists_nofollow(p: &Path) -> bool {
    std::fs::symlink_metadata(p).is_ok()
}

fn entry_of(rel: &str, name: &str, path: &Path) -> Result<FsEntry, String> {
    let md = std::fs::symlink_metadata(path).map_err(|e| io_msg(&e, "ファイルを調べる"))?;
    let kind = if md.is_dir() {
        EntryKind::Dir
    } else {
        EntryKind::File
    };
    Ok(FsEntry {
        rel_path: rel.to_string(),
        name: name.to_string(),
        kind,
        size: if kind == EntryKind::File { md.len() } else { 0 },
        modified: modified_of(&md),
    })
}

pub fn create_file(root: &Path, rel: &str) -> Result<FsEntry, String> {
    let t = locate(root, rel)?;
    if exists_nofollow(&t.path) {
        return Err("既存: 同じ名前がすでにあります".to_string());
    }
    // create_new で、確認から作成までの間に作られても上書きしない
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&t.path)
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => "既存: 同じ名前がすでにあります".to_string(),
            _ => io_msg(&e, "作成する"),
        })?;
    entry_of(rel, &t.name, &t.path)
}

pub fn create_dir(root: &Path, rel: &str) -> Result<FsEntry, String> {
    let t = locate(root, rel)?;
    if exists_nofollow(&t.path) {
        return Err("既存: 同じ名前がすでにあります".to_string());
    }
    // create_dir_all ではなく create_dir(親は作らない)
    std::fs::create_dir(&t.path).map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => "既存: 同じ名前がすでにあります".to_string(),
        _ => io_msg(&e, "作成する"),
    })?;
    entry_of(rel, &t.name, &t.path)
}

pub fn rename_entry(root: &Path, from: &str, to: &str) -> Result<FsEntry, String> {
    let src = locate(root, from)?;
    let dst = locate(root, to)?;
    if !exists_nofollow(&src.path) {
        return Err("ファイルが見つかりません".to_string());
    }
    // フォルダを自分の中(または自分自身の位置)へ移す操作は拒否
    if relative_inside(&src.path, &dst.parent).is_some() {
        return Err("フォルダを自分の中には移せません".to_string());
    }
    if exists_nofollow(&dst.path) {
        // Windows は大文字小文字を区別しないので、同じ場所の綴り違いだけの変更は「同じもの」として許す
        let case_only = cfg!(windows)
            && norm_component(src.parent.as_os_str()) == norm_component(dst.parent.as_os_str())
            && src.name != dst.name
            && src.name.to_lowercase() == dst.name.to_lowercase();
        if !case_only {
            return Err("既存: 移動先に同じ名前がすでにあります".to_string());
        }
    }
    std::fs::rename(&src.path, &dst.path).map_err(|e| io_msg(&e, "名前を変更する"))?;
    entry_of(to, &dst.name, &dst.path)
}

/// `\\?\` 形式(canonicalize の結果)を、シェルやコマンドが読める通常の形に戻す。
fn plain_path(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => p.to_path_buf(),
    }
}

pub fn delete_entry(root: &Path, rel: &str) -> Result<(), String> {
    let t = locate(root, rel)?;
    if !exists_nofollow(&t.path) {
        return Err("ファイルが見つかりません".to_string());
    }
    // 親だけを実体にしているので、リンクならリンク自体がごみ箱へ行く(中身へは入らない)
    trash::delete(plain_path(&t.path)).map_err(|_| "ごみ箱へ移せませんでした".to_string())
}

/// PATH から実行ファイルを探す。Windows では `code` が code.cmd のため拡張子も試す。
fn find_in_path(name: &str, path_var: &std::ffi::OsStr) -> Option<PathBuf> {
    let exts: &[&str] = if cfg!(windows) {
        &["cmd", "exe", "bat"]
    } else {
        &[""]
    };
    std::env::split_paths(path_var).find_map(|dir| {
        exts.iter().find_map(|ext| {
            let file = if ext.is_empty() {
                dir.join(name)
            } else {
                dir.join(format!("{name}.{ext}"))
            };
            file.is_file().then_some(file)
        })
    })
}

pub fn open_in_vscode(root: &Path, rel: &str) -> Result<(), String> {
    // 先にパスを検証する(不正なパスでは、プロセスを起動しない)
    let target = plain_path(&resolve(root, rel)?.path);
    let path_var = std::env::var_os("PATH").unwrap_or_default();
    if find_in_path("code", &path_var).is_none() {
        return Err("VSCode(code コマンド)が見つかりません".to_string());
    }
    let mut cmd = launch_command(&target)?;
    let mut child = cmd
        .spawn()
        .map_err(|_| "VSCode: 起動できませんでした".to_string())?;
    // 待たない。終了だけ回収する(ゾンビ防止)
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(windows)]
fn launch_command(target: &Path) -> Result<std::process::Command, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let s = target.to_string_lossy();
    // cmd は % を展開してしまうので、引用符でも防げない。ほかの記号は引用符の中なら文字のまま
    if s.contains('%') {
        return Err("VSCode: パスに % が含まれているため開けません".to_string());
    }
    let mut cmd = std::process::Command::new("cmd");
    // raw_arg で自前の引用符を付ける(空白・日本語・& を含むパスでも壊れない)。-- 以降はオプション扱いされない
    cmd.args(["/C", "code", "--"])
        .raw_arg(format!("\"{s}\""))
        .creation_flags(CREATE_NO_WINDOW);
    Ok(cmd)
}

#[cfg(not(windows))]
fn launch_command(target: &Path) -> Result<std::process::Command, String> {
    let mut cmd = std::process::Command::new("code");
    cmd.arg("--").arg(target);
    Ok(cmd)
}

// ---------------------------------------------------------------- テスト

#[cfg(test)]
mod tests {
    use super::*;

    fn proj() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn req<'a>(content: &'a str, expected: Option<&'a str>, force: bool) -> WriteRequest<'a> {
        WriteRequest {
            content,
            expected_modified: expected,
            eol: Eol::Lf,
            has_bom: false,
            encoding: TextEncoding::Utf8,
            force,
        }
    }

    #[test]
    fn list_files_basic_exclusions_and_order() {
        let d = proj();
        let r = d.path();
        for rel in [
            "src/main.rs",
            "file10.txt",
            "file2.txt",
            "日本語/メモ.md",
            "node_modules/a/index.js",
            "target/debug/x.rs",
            ".git/config",
            ".hidden/a.py",
            "gen/out.txt",
            "keep.txt",
        ] {
            let p = r.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, "x").unwrap();
        }
        std::fs::write(r.join(".gitignore"), "gen/\n").unwrap();
        let l = list_files(r).unwrap();
        assert!(!l.truncated);
        // フォルダは含まない・`/` 区切り・自然順(file2 < file10)。
        // 隠しファイル(.gitignore・.hidden/a.py)は含め、.git・node_modules・target・.gitignore 済みは除く
        assert_eq!(
            l.rel_paths,
            [
                ".gitignore",
                ".hidden/a.py",
                "file2.txt",
                "file10.txt",
                "keep.txt",
                "src/main.rs",
                "日本語/メモ.md"
            ]
        );
    }

    #[test]
    fn list_files_truncates_at_limit() {
        let d = proj();
        for i in 0..5 {
            std::fs::write(d.path().join(format!("f{i}.txt")), "x").unwrap();
        }
        let l = list_files_limited(d.path(), 3).unwrap();
        assert_eq!(l.rel_paths.len(), 3);
        assert!(l.truncated);
        // ちょうど上限なら打ち切りではない
        let l = list_files_limited(d.path(), 5).unwrap();
        assert_eq!(l.rel_paths.len(), 5);
        assert!(!l.truncated);
    }

    #[test]
    fn list_files_missing_root_is_error() {
        let d = proj();
        assert!(list_files(&d.path().join("nope")).is_err());
    }

    #[test]
    fn list_files_does_not_follow_links() {
        let outside = proj();
        std::fs::write(outside.path().join("secret.txt"), "x").unwrap();
        let d = proj();
        std::fs::write(d.path().join("ok.txt"), "x").unwrap();
        let link = d.path().join("lnk");
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_dir(outside.path(), &link).is_ok()
            || std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(&link)
                .arg(outside.path())
                .output()
                .is_ok_and(|o| o.status.success());
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(outside.path(), &link).is_ok();
        if !made {
            return; // 権限がなく作れない環境ではスキップ
        }
        let l = list_files(d.path()).unwrap();
        assert_eq!(l.rel_paths, ["ok.txt"]);
    }

    #[test]
    fn rejects_bad_paths() {
        let d = proj();
        std::fs::write(d.path().join("a.txt"), "x").unwrap();
        let bad = [
            "/a.txt",
            "..",
            "../a.txt",
            "a/../a.txt",
            ".",
            "./a.txt",
            "a//b",
            "a/",
            "a\\b",
            "C:\\Windows",
            "C:",
            "a.txt:stream",
            "a.txt.",
            "a.txt ",
            "CON",
            "con.txt",
            "Nul.tar.gz",
            "dir/COM1",
            "lpt9.md",
            "a?b",
            ".git",
            ".git/config",
            "sub/.GIT/HEAD",
        ];
        for rel in bad {
            assert!(
                read_file(d.path(), rel, None).is_err(),
                "読めてしまった: {rel}"
            );
            assert!(list_dir(d.path(), rel).is_err(), "一覧できた: {rel}");
            assert!(
                write_file(d.path(), rel, &req("x", None, true)).is_err(),
                "書けてしまった: {rel}"
            );
        }
        // 正常なものは通る(予約名に似ているだけの名前)
        std::fs::write(d.path().join("console.txt"), "ok").unwrap();
        assert!(read_file(d.path(), "console.txt", None).is_ok());
        assert!(read_file(d.path(), "a.txt", None).is_ok());
    }

    #[test]
    fn git_dir_is_refused_and_hidden() {
        let d = proj();
        std::fs::create_dir(d.path().join(".git")).unwrap();
        std::fs::write(d.path().join(".git").join("config"), "x").unwrap();
        assert!(read_file(d.path(), ".git/config", None).is_err());
        assert!(write_file(d.path(), ".git/config", &req("y", None, true)).is_err());
        assert_eq!(
            std::fs::read_to_string(d.path().join(".git").join("config")).unwrap(),
            "x"
        );
        assert!(list_dir(d.path(), "").unwrap().is_empty());
    }

    #[test]
    fn missing_project_folder() {
        let d = proj();
        let gone = d.path().join("gone");
        assert!(list_dir(&gone, "").is_err());
    }

    #[test]
    fn list_order_and_hidden() {
        let d = proj();
        for n in ["file10.txt", "file2.txt", "B.txt", "a.txt", "file02.txt"] {
            std::fs::write(d.path().join(n), "x").unwrap();
        }
        for n in [
            "zdir",
            "Adir",
            "node_modules",
            "target",
            ".venv",
            "venv",
            "__pycache__",
            ".git",
        ] {
            std::fs::create_dir(d.path().join(n)).unwrap();
        }
        std::fs::write(d.path().join(".tactile-tmp-x"), "x").unwrap();
        let names: Vec<_> = list_dir(d.path(), "")
            .unwrap()
            .into_iter()
            .map(|e| e.name)
            .collect();
        assert_eq!(
            names,
            [
                "Adir",
                "zdir",
                "a.txt",
                "B.txt",
                "file02.txt",
                "file2.txt",
                "file10.txt"
            ]
        );
        // 下の階層でも隠す・relPath は / 区切り
        std::fs::create_dir(d.path().join("Adir").join("node_modules")).unwrap();
        std::fs::write(d.path().join("Adir").join("x.md"), "x").unwrap();
        let sub = list_dir(d.path(), "Adir").unwrap();
        assert_eq!(sub.len(), 1);
        assert_eq!(sub[0].rel_path, "Adir/x.md");
        assert_eq!(sub[0].size, 1);
        assert!(sub[0].modified.is_some());
    }

    #[test]
    fn read_kinds() {
        let d = proj();
        let p = d.path();
        std::fs::write(p.join("t.txt"), "あ\nb").unwrap();
        std::fs::write(p.join("bin.dat"), [b'a', 0, b'b']).unwrap();
        std::fs::write(p.join("sjis.txt"), [0x81, 0x20]).unwrap(); // どの文字コードでも不正な並び
        std::fs::write(p.join("big.txt"), vec![b'a'; (MAX_BYTES + 1) as usize]).unwrap();
        std::fs::write(p.join("edge.txt"), vec![b'a'; MAX_BYTES as usize]).unwrap();

        let t = read_file(p, "t.txt", None).unwrap();
        assert_eq!(t.kind, ContentKind::Text);
        assert_eq!(t.content.as_deref(), Some("あ\nb"));
        assert_eq!(t.eol, Eol::Lf);
        assert!(!t.has_bom);
        assert!(t.modified.contains('T'));
        assert_eq!(
            read_file(p, "bin.dat", None).unwrap().kind,
            ContentKind::Binary
        );
        let s = read_file(p, "sjis.txt", None).unwrap();
        assert_eq!(s.kind, ContentKind::UnsupportedEncoding);
        assert!(s.content.is_none());
        let b = read_file(p, "big.txt", None).unwrap();
        assert_eq!(b.kind, ContentKind::TooLarge);
        assert!(b.content.is_none());
        assert_eq!(
            read_file(p, "edge.txt", None).unwrap().kind,
            ContentKind::Text
        );
        assert!(read_file(p, "nope.txt", None).is_err());
        assert!(read_file(p, "", None).is_err()); // フォルダは読めない
    }

    #[test]
    fn bom_and_eol_roundtrip() {
        let d = proj();
        let p = d.path();
        let cases: [&[u8]; 4] = [
            b"\xEF\xBB\xBFline1\r\nline2\r\n",
            b"line1\r\nline2",
            b"\xEF\xBB\xBFa\nb\n",
            "日本語\r\n".as_bytes(),
        ];
        for (i, orig) in cases.iter().enumerate() {
            let name = format!("f{i}.txt");
            std::fs::write(p.join(&name), orig).unwrap();
            let r = read_file(p, &name, None).unwrap();
            let c = r.content.clone().unwrap();
            assert!(!c.contains('\r'));
            let w = WriteRequest {
                content: &c,
                expected_modified: Some(&r.modified),
                eol: r.eol,
                has_bom: r.has_bom,
                encoding: r.encoding,
                force: false,
            };
            write_file(p, &name, &w).unwrap();
            assert_eq!(&std::fs::read(p.join(&name)).unwrap(), orig, "{name}");
        }
        // 最初の改行が CRLF かどうか
        std::fs::write(p.join("m.txt"), "a\nb\r\n").unwrap();
        assert_eq!(read_file(p, "m.txt", None).unwrap().eol, Eol::Lf);
    }

    #[test]
    fn conflict_detection() {
        let d = proj();
        let p = d.path();
        std::fs::write(p.join("a.txt"), "v1").unwrap();
        let r = read_file(p, "a.txt", None).unwrap();
        // 変更なし → 通る
        let saved = write_file(p, "a.txt", &req("v2", Some(&r.modified), false)).unwrap();
        assert_eq!(saved.size, 2);
        assert_eq!(
            read_file(p, "a.txt", None).unwrap().modified,
            saved.modified
        );
        // 外部で変更 → 競合
        std::thread::sleep(std::time::Duration::from_millis(30));
        std::fs::write(p.join("a.txt"), "external").unwrap();
        let err = write_file(p, "a.txt", &req("v3", Some(&saved.modified), false)).unwrap_err();
        assert!(err.starts_with("競合:"), "{err}");
        assert_eq!(
            std::fs::read_to_string(p.join("a.txt")).unwrap(),
            "external"
        );
        // force なら上書き、expected が None なら検査しない
        write_file(p, "a.txt", &req("v3", Some(&saved.modified), true)).unwrap();
        assert_eq!(std::fs::read_to_string(p.join("a.txt")).unwrap(), "v3");
        write_file(p, "a.txt", &req("v4", None, false)).unwrap();
        assert_eq!(std::fs::read_to_string(p.join("a.txt")).unwrap(), "v4");
    }

    #[test]
    fn atomic_write_leaves_no_tmp() {
        let d = proj();
        let p = d.path();
        std::fs::write(p.join("a.txt"), "v1").unwrap();
        write_file(p, "a.txt", &req("v2", None, false)).unwrap();
        // 競合で失敗した場合も、一時ファイルは残らない
        let r = write_file(p, "a.txt", &req("v3", Some("2000-01-01T00:00:00Z"), false));
        assert!(r.is_err());
        let left: Vec<_> = std::fs::read_dir(p)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(left, ["a.txt"]);
        assert_eq!(std::fs::read_to_string(p.join("a.txt")).unwrap(), "v2");
    }

    #[test]
    fn write_rules() {
        let d = proj();
        let p = d.path();
        // 存在しない・フォルダ・大きすぎる
        assert!(write_file(p, "new.txt", &req("x", None, true)).is_err());
        assert!(!p.join("new.txt").exists());
        std::fs::create_dir(p.join("dir")).unwrap();
        assert!(write_file(p, "dir", &req("x", None, true)).is_err());
        std::fs::write(p.join("a.txt"), "v1").unwrap();
        let big = "a".repeat((MAX_BYTES + 1) as usize);
        assert!(write_file(p, "a.txt", &req(&big, None, true)).is_err());
        // 読み取り専用は書き込めない旨を返し、属性は変えない
        let mut perm = std::fs::metadata(p.join("a.txt")).unwrap().permissions();
        perm.set_readonly(true);
        std::fs::set_permissions(p.join("a.txt"), perm).unwrap();
        let err = write_file(p, "a.txt", &req("v2", None, true)).unwrap_err();
        assert!(err.contains("読み取り専用"), "{err}");
        assert!(
            std::fs::metadata(p.join("a.txt"))
                .unwrap()
                .permissions()
                .readonly()
        );
        // 後始末(一時フォルダを消せるように戻す)
        let mut perm = std::fs::metadata(p.join("a.txt")).unwrap().permissions();
        #[allow(clippy::permissions_set_readonly_false)]
        perm.set_readonly(false);
        std::fs::set_permissions(p.join("a.txt"), perm).unwrap();
    }

    #[test]
    fn natural_order() {
        assert_eq!(natural_cmp("file2", "file10"), Ordering::Less);
        assert_eq!(natural_cmp("A", "b"), Ordering::Less);
        assert_eq!(natural_cmp("abc", "ab"), Ordering::Greater);
    }

    /// ジャンクション(管理者権限なしで作れる)。作れない環境では None → テストを飛ばす。
    #[cfg(windows)]
    fn make_junction(link: &Path, target: &Path) -> Option<()> {
        std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|_| ())
    }

    #[cfg(windows)]
    #[test]
    fn junction_cannot_escape() {
        let d = proj();
        let outside = proj();
        std::fs::write(outside.path().join("secret.txt"), "s").unwrap();
        let link = d.path().join("link");
        if make_junction(&link, outside.path()).is_none() {
            eprintln!("ジャンクションを作れないため skip");
            return;
        }
        assert!(read_file(d.path(), "link/secret.txt", None).is_err());
        assert!(list_dir(d.path(), "link").is_err());
        assert!(write_file(d.path(), "link/secret.txt", &req("x", None, true)).is_err());
        assert_eq!(
            std::fs::read_to_string(outside.path().join("secret.txt")).unwrap(),
            "s"
        );
        // 一覧にもリンク自体を出さない
        assert!(list_dir(d.path(), "").unwrap().is_empty());
        // 後始末: ジャンクションは rmdir で外す(リンク先は消えない)
        let _ = std::fs::remove_dir(&link);
    }

    #[test]
    fn symlink_cannot_escape() {
        let d = proj();
        let outside = proj();
        std::fs::write(outside.path().join("secret.txt"), "s").unwrap();
        let link = d.path().join("flink");
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_file(outside.path().join("secret.txt"), &link);
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(outside.path().join("secret.txt"), &link);
        if made.is_err() {
            eprintln!("シンボリックリンクを作れないため skip");
            return;
        }
        assert!(read_file(d.path(), "flink", None).is_err());
        assert!(write_file(d.path(), "flink", &req("x", None, true)).is_err());
        assert!(list_dir(d.path(), "").unwrap().is_empty());
        assert_eq!(
            std::fs::read_to_string(outside.path().join("secret.txt")).unwrap(),
            "s"
        );
    }

    #[cfg(windows)]
    #[test]
    fn case_insensitive_root_compare() {
        let d = proj();
        std::fs::write(d.path().join("a.txt"), "x").unwrap();
        // ルートの綴りの大文字小文字が違っても、内側と判定される
        let upper = PathBuf::from(d.path().to_string_lossy().to_uppercase());
        assert!(read_file(&upper, "a.txt", None).is_ok());
        // ファイル名の大文字小文字違い(Windows)
        assert!(read_file(d.path(), "A.TXT", None).is_ok());
    }

    // ---- 段階3b-3: 文字コード ----

    fn text_of(p: &Path, name: &str, enc: Option<TextEncoding>) -> FileContent {
        read_file(p, name, enc).unwrap()
    }

    fn save(
        p: &Path,
        name: &str,
        content: &str,
        enc: TextEncoding,
        bom: bool,
    ) -> Result<SavedFile, String> {
        let w = WriteRequest {
            content,
            expected_modified: None,
            eol: Eol::Lf,
            has_bom: bom,
            encoding: enc,
            force: true,
        };
        write_file(p, name, &w)
    }

    fn utf16_bytes(s: &str, little: bool, bom: bool) -> Vec<u8> {
        let mut v = Vec::new();
        if bom {
            v.extend(if little { [0xFF, 0xFE] } else { [0xFE, 0xFF] });
        }
        v.extend(encode_utf16(s, little));
        v
    }

    #[test]
    fn detect_boms_and_utf8() {
        let d = proj();
        let p = d.path();
        std::fs::write(p.join("u8.txt"), "\u{FEFF}日本語".as_bytes()).unwrap();
        std::fs::write(
            p.join("le.txt"),
            utf16_bytes("a日\u{1F600}\r\nb", true, true),
        )
        .unwrap();
        std::fs::write(p.join("be.txt"), utf16_bytes("a日", false, true)).unwrap();
        std::fs::write(p.join("plain.txt"), "日本語".as_bytes()).unwrap();
        let r = text_of(p, "u8.txt", None);
        assert_eq!((r.encoding, r.has_bom), (TextEncoding::Utf8, true));
        assert_eq!(r.content.as_deref(), Some("日本語"));
        let r = text_of(p, "le.txt", None);
        assert_eq!(
            (r.encoding, r.has_bom, r.eol),
            (TextEncoding::Utf16Le, true, Eol::Crlf)
        );
        assert_eq!(r.content.as_deref(), Some("a日\u{1F600}\nb"));
        let r = text_of(p, "be.txt", None);
        assert_eq!((r.encoding, r.has_bom), (TextEncoding::Utf16Be, true));
        assert_eq!(r.content.as_deref(), Some("a日"));
        let r = text_of(p, "plain.txt", None);
        assert_eq!((r.encoding, r.has_bom), (TextEncoding::Utf8, false));
    }

    #[test]
    fn detect_shift_jis_euc_jp_and_unknown() {
        let d = proj();
        let p = d.path();
        let (sj, _, _) = encoding_rs::SHIFT_JIS.encode("日本語のテキスト");
        let (euc, _, _) = encoding_rs::EUC_JP.encode("日本語のテキスト");
        std::fs::write(p.join("sj.txt"), &sj).unwrap();
        std::fs::write(p.join("euc.txt"), &euc).unwrap();
        // 先頭 0x81 に ASCII が続く並びは、UTF-8・Shift_JIS・EUC-JP のどれでもない
        std::fs::write(p.join("bad.txt"), [b'a', 0x81, 0x20]).unwrap();
        // BOM の無い UTF-16 は NUL を含むのでバイナリ扱い
        std::fs::write(p.join("nobom16.txt"), utf16_bytes("abc", true, false)).unwrap();
        std::fs::write(p.join("badbom.txt"), [0xEF, 0xBB, 0xBF, 0x81, 0x20]).unwrap();
        std::fs::write(p.join("odd16.txt"), [0xFF, 0xFE, 0x41]).unwrap();
        let r = text_of(p, "sj.txt", None);
        assert_eq!(r.encoding, TextEncoding::ShiftJis);
        assert_eq!(r.content.as_deref(), Some("日本語のテキスト"));
        assert!(!r.has_bom);
        let r = text_of(p, "euc.txt", None);
        assert_eq!(r.encoding, TextEncoding::EucJp);
        assert_eq!(r.content.as_deref(), Some("日本語のテキスト"));
        let kind = |n: &str| text_of(p, n, None).kind;
        assert_eq!(kind("bad.txt"), ContentKind::UnsupportedEncoding);
        assert_eq!(kind("nobom16.txt"), ContentKind::Binary);
        assert_eq!(kind("badbom.txt"), ContentKind::UnsupportedEncoding);
        assert_eq!(kind("odd16.txt"), ContentKind::UnsupportedEncoding);
    }

    #[test]
    fn byte_roundtrip_per_encoding() {
        let d = proj();
        let p = d.path();
        let text = "日本語のテキスト\r\n二行目\r\n";
        let cases: Vec<(&str, Vec<u8>)> = vec![
            ("sj", encoding_rs::SHIFT_JIS.encode(text).0.into_owned()),
            ("euc", encoding_rs::EUC_JP.encode(text).0.into_owned()),
            ("le", utf16_bytes(text, true, true)),
            ("be", utf16_bytes(text, false, true)),
            ("u8", text.as_bytes().to_vec()),
            ("u8bom", [&BOM[..], text.as_bytes()].concat()),
        ];
        for (name, orig) in cases {
            let name = format!("{name}.txt");
            std::fs::write(p.join(&name), &orig).unwrap();
            let r = text_of(p, &name, None);
            assert_eq!(r.kind, ContentKind::Text, "{name}");
            let w = WriteRequest {
                content: r.content.as_deref().unwrap(),
                expected_modified: Some(&r.modified),
                eol: r.eol,
                has_bom: r.has_bom,
                encoding: r.encoding,
                force: false,
            };
            write_file(p, &name, &w).unwrap();
            assert_eq!(std::fs::read(p.join(&name)).unwrap(), orig, "{name}");
        }
    }

    #[test]
    fn unmappable_chars_refuse_to_write() {
        let d = proj();
        let p = d.path();
        std::fs::write(p.join("a.txt"), "keep").unwrap();
        let err = save(
            p,
            "a.txt",
            "絵文字 \u{1F600}",
            TextEncoding::ShiftJis,
            false,
        )
        .unwrap_err();
        assert!(err.starts_with("変換:"), "{err}");
        assert!(err.contains("shift_jis"), "{err}");
        let err = save(p, "a.txt", "日本語", TextEncoding::Windows1252, false).unwrap_err();
        assert!(err.starts_with("変換:"), "{err}");
        // 元のファイルは無傷で、一時ファイルも残らない
        assert_eq!(std::fs::read_to_string(p.join("a.txt")).unwrap(), "keep");
        assert_eq!(std::fs::read_dir(p).unwrap().count(), 1);
    }

    #[test]
    fn utf16_always_gets_bom_and_surrogates_roundtrip() {
        let d = proj();
        let p = d.path();
        std::fs::write(p.join("a.txt"), "x").unwrap();
        // hasBom=false を渡しても、UTF-16 は BOM を付けて保存する
        save(p, "a.txt", "a\u{1F600}", TextEncoding::Utf16Le, false).unwrap();
        assert_eq!(
            std::fs::read(p.join("a.txt")).unwrap(),
            [0xFF, 0xFE, 0x61, 0x00, 0x3D, 0xD8, 0x00, 0xDE]
        );
        save(p, "a.txt", "a", TextEncoding::Utf16Be, false).unwrap();
        assert_eq!(
            std::fs::read(p.join("a.txt")).unwrap(),
            [0xFE, 0xFF, 0x00, 0x61]
        );
        let r = text_of(p, "a.txt", None);
        assert_eq!((r.encoding, r.has_bom), (TextEncoding::Utf16Be, true));
    }

    #[test]
    fn change_encoding_on_save() {
        let d = proj();
        let p = d.path();
        std::fs::write(p.join("a.txt"), "日本語".as_bytes()).unwrap();
        // UTF-8 の本文を Shift_JIS で保存 → 読み直すと Shift_JIS と判定される
        save(p, "a.txt", "日本語のテキスト", TextEncoding::ShiftJis, true).unwrap();
        let bytes = std::fs::read(p.join("a.txt")).unwrap();
        assert!(
            !bytes.starts_with(&BOM),
            "UTF-8 以外には UTF-8 の BOM を付けない"
        );
        assert_eq!(text_of(p, "a.txt", None).encoding, TextEncoding::ShiftJis);
    }

    #[test]
    fn read_with_explicit_encoding() {
        let d = proj();
        let p = d.path();
        let (sj, _, _) = encoding_rs::SHIFT_JIS.encode("日本語のテキスト");
        std::fs::write(p.join("sj.txt"), &sj).unwrap();
        std::fs::write(p.join("u8.txt"), "日本語".as_bytes()).unwrap();
        std::fs::write(p.join("bad.txt"), [b'a', 0x81, 0x20]).unwrap();
        std::fs::write(p.join("le.txt"), utf16_bytes("abc", true, false)).unwrap();
        std::fs::write(p.join("bin.dat"), [b'a', 0, 0x82, 0xA0]).unwrap();
        // 指定どおりに読む
        let r = text_of(p, "sj.txt", Some(TextEncoding::ShiftJis));
        assert_eq!(r.content.as_deref(), Some("日本語のテキスト"));
        assert_eq!(r.encoding, TextEncoding::ShiftJis);
        // 誤った指定は、置換文字にせず unsupportedEncoding(指定した文字コードを返す)
        let r = text_of(p, "sj.txt", Some(TextEncoding::Utf8));
        assert_eq!(r.kind, ContentKind::UnsupportedEncoding);
        assert!(r.content.is_none());
        assert_eq!(r.encoding, TextEncoding::Utf8);
        // 自動判定の対象外の文字コードも、指定すれば読める
        let r = text_of(p, "u8.txt", Some(TextEncoding::Windows1252));
        assert_eq!(r.kind, ContentKind::Text);
        assert_eq!(r.encoding, TextEncoding::Windows1252);
        assert_ne!(r.content.as_deref(), Some("日本語"));
        assert_eq!(
            text_of(p, "bad.txt", Some(TextEncoding::ShiftJis)).kind,
            ContentKind::UnsupportedEncoding
        );
        // BOM 無し UTF-16 は、指定すれば読める
        let r = text_of(p, "le.txt", Some(TextEncoding::Utf16Le));
        assert_eq!(r.content.as_deref(), Some("abc"));
        assert!(!r.has_bom);
        // NUL を含む非 UTF-16 指定はバイナリ
        assert_eq!(
            text_of(p, "bin.dat", Some(TextEncoding::ShiftJis)).kind,
            ContentKind::Binary
        );
        // 指定読みでも UTF-8 の BOM は外して hasBom に反映
        std::fs::write(p.join("bom.txt"), [&BOM[..], "あ".as_bytes()].concat()).unwrap();
        let r = text_of(p, "bom.txt", Some(TextEncoding::Utf8));
        assert_eq!((r.content.as_deref(), r.has_bom), (Some("あ"), true));
    }

    // ---- 段階3b-1: stat_files / sanitize_session ----

    fn strs(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn stat_existing_missing_and_bad_paths_keep_order() {
        let d = proj();
        std::fs::write(d.path().join("a.txt"), "x").unwrap();
        std::fs::create_dir(d.path().join("dir")).unwrap();
        let rels = strs(&[
            "a.txt",
            "nope.txt",
            "../a.txt",
            "dir",
            ".git/config",
            "a.txt",
        ]);
        let got = stat_files(d.path(), &rels).unwrap();
        assert_eq!(got.len(), rels.len());
        for (g, r) in got.iter().zip(&rels) {
            assert_eq!(&g.rel_path, r);
        }
        assert!(got[0].exists && got[0].modified.is_some());
        assert_eq!(got[0].modified, got[5].modified);
        // 不在・不正・フォルダは exists:false で modified は null
        for g in &got[1..=4] {
            assert!(!g.exists && g.modified.is_none(), "{}", g.rel_path);
        }
    }

    #[test]
    fn stat_modified_matches_read_file_and_changes_on_write() {
        let d = proj();
        std::fs::write(d.path().join("a.txt"), "x").unwrap();
        let read = read_file(d.path(), "a.txt", None).unwrap();
        let st = stat_files(d.path(), &strs(&["a.txt"])).unwrap();
        assert_eq!(st[0].modified.as_deref(), Some(read.modified.as_str()));
        // 自分の保存の戻り値とも一致する(誤検知しない)
        let saved = write_file(d.path(), "a.txt", &req("yy", None, true)).unwrap();
        let st = stat_files(d.path(), &strs(&["a.txt"])).unwrap();
        assert_eq!(st[0].modified.as_deref(), Some(saved.modified.as_str()));
    }

    #[test]
    fn stat_limit_and_missing_root() {
        let d = proj();
        let many: Vec<String> = (0..=MAX_STAT_FILES).map(|i| format!("f{i}")).collect();
        assert!(stat_files(d.path(), &many).is_err());
        assert_eq!(
            stat_files(d.path(), &many[..MAX_STAT_FILES]).unwrap().len(),
            200
        );
        // ルートが消えていても失敗にしない
        let gone = d.path().join("gone");
        let got = stat_files(&gone, &strs(&["a.txt"])).unwrap();
        assert!(!got[0].exists);
        assert!(stat_files(d.path(), &[]).unwrap().is_empty());
    }

    #[test]
    fn stat_symlink_to_outside_is_not_exists() {
        let d = proj();
        let outside = proj();
        std::fs::write(outside.path().join("secret.txt"), "s").unwrap();
        let link = d.path().join("flink");
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_file(outside.path().join("secret.txt"), &link);
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(outside.path().join("secret.txt"), &link);
        if made.is_err() {
            eprintln!("シンボリックリンクを作れないため skip");
            return;
        }
        let got = stat_files(d.path(), &strs(&["flink"])).unwrap();
        assert!(!got[0].exists && got[0].modified.is_none());
    }

    #[cfg(windows)]
    #[test]
    fn stat_junction_to_outside_is_not_exists() {
        let d = proj();
        let outside = proj();
        std::fs::write(outside.path().join("secret.txt"), "s").unwrap();
        let link = d.path().join("link");
        if make_junction(&link, outside.path()).is_none() {
            eprintln!("ジャンクションを作れないため skip");
            return;
        }
        let got = stat_files(d.path(), &strs(&["link/secret.txt"])).unwrap();
        assert!(!got[0].exists);
        let _ = std::fs::remove_dir(&link);
    }

    fn tab(p: &str) -> SessionTab {
        SessionTab {
            rel_path: p.to_string(),
            md_mode: crate::domain::MdMode::Split,
        }
    }

    #[test]
    fn sanitize_drops_bad_paths_and_keeps_good() {
        let s = EditorSession {
            tabs: vec![
                tab("a.md"),
                tab("../x"),
                tab("/abs"),
                tab("sub/b.rs"),
                tab(".git/HEAD"),
            ],
            active: Some("../x".into()),
            expanded: strs(&["sub", "a//b", "C:", "sub/deep"]),
        };
        let got = sanitize_session(s);
        assert_eq!(got.tabs, vec![tab("a.md"), tab("sub/b.rs")]);
        assert_eq!(got.active, None);
        assert_eq!(got.expanded, strs(&["sub", "sub/deep"]));
        let ok = sanitize_session(EditorSession {
            tabs: vec![],
            active: Some("sub/b.rs".into()),
            expanded: vec![],
        });
        assert_eq!(ok.active.as_deref(), Some("sub/b.rs"));
    }

    #[test]
    fn sanitize_truncates_counts_and_long_paths() {
        let tabs: Vec<SessionTab> = (0..300).map(|i| tab(&format!("f{i}.txt"))).collect();
        let expanded: Vec<String> = (0..700).map(|i| format!("d{i}")).collect();
        let long = "a".repeat(1500);
        let mut tabs2 = tabs.clone();
        tabs2.insert(0, tab(&long));
        let got = sanitize_session(EditorSession {
            tabs: tabs2,
            active: Some(long.clone()),
            expanded,
        });
        assert_eq!(got.tabs.len(), MAX_SESSION_TABS);
        assert_eq!(got.expanded.len(), MAX_SESSION_EXPANDED);
        // 長いパスは 1,000 文字に切り詰めて残す(エラーにしない)
        assert_eq!(got.tabs[0].rel_path.chars().count(), 1000);
        assert_eq!(got.active.unwrap().chars().count(), 1000);
    }

    // ---- 段階3b-2: 作成・名前変更・削除・VSCode ----

    #[test]
    fn create_file_and_dir_basic() {
        let d = proj();
        let p = d.path();
        std::fs::create_dir(p.join("sub")).unwrap();
        let f = create_file(p, "sub/new.md").unwrap();
        assert_eq!(f.rel_path, "sub/new.md");
        assert_eq!(f.name, "new.md");
        assert_eq!(f.kind, EntryKind::File);
        assert_eq!(f.size, 0);
        assert!(f.modified.is_some());
        assert!(p.join("sub").join("new.md").is_file());
        let dir = create_dir(p, "sub/inner").unwrap();
        assert_eq!(dir.kind, EntryKind::Dir);
        assert!(p.join("sub").join("inner").is_dir());
        // ルート直下
        create_file(p, "top.txt").unwrap();
    }

    #[test]
    fn create_rejects_existing_missing_parent_and_bad_names() {
        let d = proj();
        let p = d.path();
        std::fs::write(p.join("a.txt"), "keep").unwrap();
        std::fs::create_dir(p.join("dir")).unwrap();
        // 既存(ファイル・フォルダ、種類をまたいでも)は上書きしない
        assert!(create_file(p, "a.txt").unwrap_err().starts_with("既存:"));
        assert!(create_dir(p, "a.txt").unwrap_err().starts_with("既存:"));
        assert!(create_file(p, "dir").unwrap_err().starts_with("既存:"));
        assert!(create_dir(p, "dir").unwrap_err().starts_with("既存:"));
        assert_eq!(std::fs::read_to_string(p.join("a.txt")).unwrap(), "keep");
        // 親が無い・親がファイル → エラーで、親は作らない
        assert!(create_file(p, "nope/x.txt").is_err());
        assert!(create_dir(p, "nope/x").is_err());
        assert!(!p.join("nope").exists());
        assert!(create_file(p, "a.txt/x").is_err());
        // 空(ルート自体)・不正名・予約名・.git
        for bad in [
            "", "../x", "/x", "a//b", "x:y", "x.", "x ", "CON", "con.txt", "a?b", "dir/NUL",
            ".git", ".git/x", "dir/.GIT", "a\\b",
        ] {
            assert!(create_file(p, bad).is_err(), "作れてしまった: {bad}");
            assert!(create_dir(p, bad).is_err(), "作れてしまった: {bad}");
        }
        assert!(!p.join(".git").exists());
        // 大文字小文字違いは Windows では既存扱い
        if cfg!(windows) {
            assert!(create_file(p, "A.TXT").unwrap_err().starts_with("既存:"));
        }
    }

    #[test]
    fn create_cannot_escape_through_link() {
        let d = proj();
        let outside = proj();
        let link = d.path().join("link");
        #[cfg(windows)]
        if make_junction(&link, outside.path()).is_none() {
            eprintln!("ジャンクションを作れないため skip");
            return;
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();
        assert!(create_file(d.path(), "link/x.txt").is_err());
        assert!(create_dir(d.path(), "link/x").is_err());
        assert!(rename_entry(d.path(), "link/x", "y").is_err());
        assert!(delete_entry(d.path(), "link/x").is_err());
        assert!(std::fs::read_dir(outside.path()).unwrap().next().is_none());
        let _ = std::fs::remove_dir(&link);
    }

    #[test]
    fn rename_file_dir_and_move() {
        let d = proj();
        let p = d.path();
        std::fs::write(p.join("a.txt"), "x").unwrap();
        std::fs::create_dir_all(p.join("dir").join("sub")).unwrap();
        std::fs::write(p.join("dir").join("sub").join("f.txt"), "y").unwrap();
        std::fs::create_dir(p.join("other")).unwrap();
        let e = rename_entry(p, "a.txt", "b.txt").unwrap();
        assert_eq!((e.rel_path.as_str(), e.name.as_str()), ("b.txt", "b.txt"));
        assert!(!p.join("a.txt").exists() && p.join("b.txt").is_file());
        // フォルダごと別フォルダへ(移動)
        let e = rename_entry(p, "dir", "other/dir2").unwrap();
        assert_eq!(e.kind, EntryKind::Dir);
        assert_eq!(e.rel_path, "other/dir2");
        let moved = p.join("other").join("dir2").join("sub").join("f.txt");
        assert_eq!(std::fs::read_to_string(moved).unwrap(), "y");
        // 無いもの
        assert!(rename_entry(p, "nope", "z").is_err());
        // 移動先の親が無い
        assert!(rename_entry(p, "b.txt", "nodir/b.txt").is_err());
        assert!(p.join("b.txt").exists());
    }

    #[test]
    fn rename_rejects_existing_root_git_and_self_move() {
        let d = proj();
        let p = d.path();
        std::fs::write(p.join("a.txt"), "A").unwrap();
        std::fs::write(p.join("b.txt"), "B").unwrap();
        std::fs::create_dir_all(p.join("dir").join("in")).unwrap();
        std::fs::create_dir(p.join(".git")).unwrap();
        // 既存を上書きしない
        let err = rename_entry(p, "a.txt", "b.txt").unwrap_err();
        assert!(err.starts_with("既存:"), "{err}");
        assert_eq!(std::fs::read_to_string(p.join("b.txt")).unwrap(), "B");
        assert!(rename_entry(p, "a.txt", "dir").is_err());
        // 同じ名前への変更も「既存」(何も起きない)
        assert!(rename_entry(p, "a.txt", "a.txt").is_err());
        // ルート自体・.git
        assert!(rename_entry(p, "", "x").is_err());
        assert!(rename_entry(p, "a.txt", "").is_err());
        assert!(rename_entry(p, ".git", "g").is_err());
        assert!(rename_entry(p, "a.txt", ".git").is_err());
        assert!(rename_entry(p, "a.txt", ".git/a.txt").is_err());
        assert!(p.join(".git").is_dir());
        // 自分の中へ・自分自身の位置へ
        assert!(rename_entry(p, "dir", "dir/in/dir").is_err());
        assert!(rename_entry(p, "dir", "dir/x").is_err());
        assert!(p.join("dir").join("in").is_dir());
        // 名前が似ているだけの別フォルダへは動かせる
        std::fs::create_dir(p.join("dir2")).unwrap();
        assert!(rename_entry(p, "dir", "dir2/dir").is_ok());
        // 外へ出る・不正
        for bad in ["../x", "/x", "a//b", "CON"] {
            assert!(rename_entry(p, "b.txt", bad).is_err(), "{bad}");
            assert!(rename_entry(p, bad, "ok.txt").is_err(), "{bad}");
        }
        assert!(p.join("b.txt").exists());
    }

    #[test]
    fn rename_case_only_change() {
        let d = proj();
        let p = d.path();
        std::fs::write(p.join("readme.md"), "x").unwrap();
        std::fs::create_dir(p.join("docs")).unwrap();
        let e = rename_entry(p, "readme.md", "README.md").unwrap();
        assert_eq!(e.name, "README.md");
        let names: Vec<_> = std::fs::read_dir(p)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert!(names.contains(&"README.md".to_string()), "{names:?}");
        assert!(!names.contains(&"readme.md".to_string()), "{names:?}");
        // フォルダでも
        rename_entry(p, "docs", "Docs").unwrap();
        // 別々のフォルダの同名(大文字小文字違い)は、Windows では既存扱い
        std::fs::create_dir(p.join("sub")).unwrap();
        std::fs::write(p.join("sub").join("x.txt"), "x").unwrap();
        if cfg!(windows) {
            let err = rename_entry(p, "sub/x.txt", "SUB/x.txt");
            assert!(err.is_err(), "同じ場所(綴り違い)でも名前が同じなら既存");
        }
    }

    #[test]
    fn delete_rejects_root_git_missing_and_bad() {
        let d = proj();
        let p = d.path();
        std::fs::write(p.join("a.txt"), "x").unwrap();
        std::fs::create_dir(p.join(".git")).unwrap();
        let bad = [
            "",
            ".git",
            ".git/config",
            "../a.txt",
            "/a.txt",
            "nope.txt",
            "CON",
        ];
        for b in bad {
            assert!(delete_entry(p, b).is_err(), "{b}");
        }
        assert!(p.join("a.txt").exists() && p.join(".git").exists() && p.exists());
    }

    /// 実際のごみ箱へ移す(一時フォルダ内の1件だけ)。
    #[test]
    fn delete_moves_one_temp_file_to_trash() {
        let d = proj();
        let p = d.path();
        let name = format!("tactile-trash-test-{}.txt", uuid::Uuid::new_v4());
        std::fs::write(p.join(&name), "x").unwrap();
        std::fs::write(p.join("keep.txt"), "k").unwrap();
        delete_entry(p, &name).unwrap();
        assert!(!p.join(&name).exists());
        assert!(p.join("keep.txt").exists());
        // もう無い
        assert!(delete_entry(p, &name).is_err());
    }

    #[test]
    fn plain_path_strips_verbatim_prefix() {
        assert_eq!(
            plain_path(Path::new(r"\\?\C:\a b\日本語")),
            PathBuf::from(r"C:\a b\日本語")
        );
        assert_eq!(
            plain_path(Path::new(r"\\?\UNC\srv\share")),
            PathBuf::from(r"\\?\UNC\srv\share")
        );
        assert_eq!(plain_path(Path::new("/a/b")), PathBuf::from("/a/b"));
    }

    #[test]
    fn find_in_path_finds_code_launcher() {
        let with = proj();
        let without = proj();
        let file = if cfg!(windows) { "code.cmd" } else { "code" };
        std::fs::write(with.path().join(file), "").unwrap();
        let joined = std::env::join_paths([without.path(), with.path()]).unwrap();
        assert_eq!(find_in_path("code", &joined), Some(with.path().join(file)));
        let only_without = std::env::join_paths([without.path()]).unwrap();
        assert_eq!(find_in_path("code", &only_without), None);
    }

    #[test]
    fn open_in_vscode_validates_path_before_launching() {
        let d = proj();
        // 不正・不在・.git は、code の有無に関わらず(起動する前に)エラー
        for bad in ["../x", "/x", "nope", ".git", "a//b", "CON"] {
            let err = open_in_vscode(d.path(), bad).unwrap_err();
            assert!(!err.starts_with("VSCode:"), "{bad}: {err}");
        }
        assert!(open_in_vscode(&d.path().join("gone"), "").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn launch_command_quotes_unusual_paths() {
        let c = launch_command(Path::new(r"C:\R&D\日本語 フォルダ\a b.md")).unwrap();
        let dbg = format!("{c:?}");
        assert!(dbg.contains("code"), "{dbg}");
        assert!(dbg.contains("日本語 フォルダ"), "{dbg}");
        let err = launch_command(Path::new(r"C:\100%\x")).unwrap_err();
        assert!(err.starts_with("VSCode:"));
    }
}
