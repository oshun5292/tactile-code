//! エディタのためのファイル操作(一覧・読み込み・保存)。契約書 docs/stage3-contract.md §4。
//! パスの検証は `resolve` に集めてある。list_dir / read_file / write_file は必ずここを通る(漏れ防止)。
use crate::domain::{ContentKind, EntryKind, Eol, FileContent, FsEntry, SavedFile};
use std::cmp::Ordering;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

const MAX_BYTES: u64 = 2 * 1024 * 1024;
const BINARY_SNIFF: usize = 8000;
const BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];
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

// ---------------------------------------------------------------- 読み込み

pub fn read_file(root: &Path, rel: &str) -> Result<FileContent, String> {
    let f = resolve(root, rel)?;
    if !f.path.is_file() {
        return Err("ファイルではありません".to_string());
    }
    let mut file = std::fs::File::open(&f.path).map_err(|e| io_msg(&e, "ファイルを開く"))?;
    let md = file.metadata().map_err(|e| io_msg(&e, "ファイルを読む"))?;
    let modified = modified_of(&md).ok_or("更新日時を取得できませんでした")?;
    let mk = |kind, content, size, eol, has_bom| FileContent {
        rel_path: rel.to_string(),
        kind,
        content,
        size,
        modified: modified.clone(),
        eol,
        has_bom,
    };
    if md.len() > MAX_BYTES {
        return Ok(mk(ContentKind::TooLarge, None, md.len(), Eol::Lf, false));
    }
    let mut buf = Vec::new();
    // 読む間に大きくなっても、上限+1 で止める
    (&mut file)
        .take(MAX_BYTES + 1)
        .read_to_end(&mut buf)
        .map_err(|e| io_msg(&e, "ファイルを読む"))?;
    let size = buf.len() as u64;
    if size > MAX_BYTES {
        return Ok(mk(ContentKind::TooLarge, None, size, Eol::Lf, false));
    }
    if buf[..buf.len().min(BINARY_SNIFF)].contains(&0) {
        return Ok(mk(ContentKind::Binary, None, size, Eol::Lf, false));
    }
    let has_bom = buf.starts_with(&BOM);
    let body = if has_bom { &buf[3..] } else { &buf[..] };
    let Ok(text) = std::str::from_utf8(body) else {
        return Ok(mk(
            ContentKind::UnsupportedEncoding,
            None,
            size,
            Eol::Lf,
            has_bom,
        ));
    };
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
    ))
}

// ---------------------------------------------------------------- 書き込み

pub struct WriteRequest<'a> {
    pub content: &'a str,
    pub expected_modified: Option<&'a str>,
    pub eol: Eol,
    pub has_bom: bool,
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

    let mut bytes = Vec::with_capacity(req.content.len() + 3);
    if req.has_bom {
        bytes.extend_from_slice(&BOM);
    }
    match req.eol {
        Eol::Lf => bytes.extend_from_slice(req.content.as_bytes()),
        Eol::Crlf => bytes.extend_from_slice(
            req.content
                .replace("\r\n", "\n")
                .replace('\n', "\r\n")
                .as_bytes(),
        ),
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
            force,
        }
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
            assert!(read_file(d.path(), rel).is_err(), "読めてしまった: {rel}");
            assert!(list_dir(d.path(), rel).is_err(), "一覧できた: {rel}");
            assert!(
                write_file(d.path(), rel, &req("x", None, true)).is_err(),
                "書けてしまった: {rel}"
            );
        }
        // 正常なものは通る(予約名に似ているだけの名前)
        std::fs::write(d.path().join("console.txt"), "ok").unwrap();
        assert!(read_file(d.path(), "console.txt").is_ok());
        assert!(read_file(d.path(), "a.txt").is_ok());
    }

    #[test]
    fn git_dir_is_refused_and_hidden() {
        let d = proj();
        std::fs::create_dir(d.path().join(".git")).unwrap();
        std::fs::write(d.path().join(".git").join("config"), "x").unwrap();
        assert!(read_file(d.path(), ".git/config").is_err());
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
        std::fs::write(p.join("sjis.txt"), [0x82, 0xA0]).unwrap();
        std::fs::write(p.join("big.txt"), vec![b'a'; (MAX_BYTES + 1) as usize]).unwrap();
        std::fs::write(p.join("edge.txt"), vec![b'a'; MAX_BYTES as usize]).unwrap();

        let t = read_file(p, "t.txt").unwrap();
        assert_eq!(t.kind, ContentKind::Text);
        assert_eq!(t.content.as_deref(), Some("あ\nb"));
        assert_eq!(t.eol, Eol::Lf);
        assert!(!t.has_bom);
        assert!(t.modified.contains('T'));
        assert_eq!(read_file(p, "bin.dat").unwrap().kind, ContentKind::Binary);
        let s = read_file(p, "sjis.txt").unwrap();
        assert_eq!(s.kind, ContentKind::UnsupportedEncoding);
        assert!(s.content.is_none());
        let b = read_file(p, "big.txt").unwrap();
        assert_eq!(b.kind, ContentKind::TooLarge);
        assert!(b.content.is_none());
        assert_eq!(read_file(p, "edge.txt").unwrap().kind, ContentKind::Text);
        assert!(read_file(p, "nope.txt").is_err());
        assert!(read_file(p, "").is_err()); // フォルダは読めない
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
            let r = read_file(p, &name).unwrap();
            let c = r.content.clone().unwrap();
            assert!(!c.contains('\r'));
            let w = WriteRequest {
                content: &c,
                expected_modified: Some(&r.modified),
                eol: r.eol,
                has_bom: r.has_bom,
                force: false,
            };
            write_file(p, &name, &w).unwrap();
            assert_eq!(&std::fs::read(p.join(&name)).unwrap(), orig, "{name}");
        }
        // 最初の改行が CRLF かどうか
        std::fs::write(p.join("m.txt"), "a\nb\r\n").unwrap();
        assert_eq!(read_file(p, "m.txt").unwrap().eol, Eol::Lf);
    }

    #[test]
    fn conflict_detection() {
        let d = proj();
        let p = d.path();
        std::fs::write(p.join("a.txt"), "v1").unwrap();
        let r = read_file(p, "a.txt").unwrap();
        // 変更なし → 通る
        let saved = write_file(p, "a.txt", &req("v2", Some(&r.modified), false)).unwrap();
        assert_eq!(saved.size, 2);
        assert_eq!(read_file(p, "a.txt").unwrap().modified, saved.modified);
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
        assert!(read_file(d.path(), "link/secret.txt").is_err());
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
        assert!(read_file(d.path(), "flink").is_err());
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
        assert!(read_file(&upper, "a.txt").is_ok());
        // ファイル名の大文字小文字違い(Windows)
        assert!(read_file(d.path(), "A.TXT").is_ok());
    }
}
