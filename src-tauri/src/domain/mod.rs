//! 型の定義。JSON は camelCase(契約書 §2, §4)。
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LangShare {
    pub name: String,
    pub percent: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub repo: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub branch: Option<String>,
    pub remote: Option<Remote>,
    pub ahead: u32,
    pub behind: u32,
    pub has_upstream: bool,
    pub last_commit_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

/// 画面に返す1件分。保存はしない(毎回計算する)。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub path: String,
    pub display_path: String,
    pub exists: bool,
    pub description: Option<String>,
    pub note: String,
    pub languages: Vec<LangShare>,
    pub main_language: Option<String>,
    pub git: Option<GitInfo>,
    pub last_updated: Option<String>,
    pub position: Position,
}

/// projects.json に保存する1件分(契約書 §4)。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredProject {
    pub id: String,
    pub path: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub description_override: Option<String>,
    pub position: Position,
    /// 段階3b-1: エディタの復元用。古いファイルには無いので default で読む。
    /// 無いときは書き出さず、ファイルの形を変えない(schemaVersion は 2 のまま)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub editor_session: Option<EditorSession>,
}

/// マークダウンの表示モード(フロントの "write" | "split" | "read")。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MdMode {
    Write,
    Split,
    Read,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTab {
    pub rel_path: String,
    pub md_mode: MdMode,
}

/// 再起動後に復元する、プロジェクトごとのエディタの状態(契約書 docs/stage3b1-contract.md §2)。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSession {
    pub tabs: Vec<SessionTab>,
    pub active: Option<String>,
    pub expanded: Vec<String>,
}

/// stat_files の1件分。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub rel_path: String,
    pub exists: bool,
    pub modified: Option<String>,
}

/// list_files の結果。relPaths は `/` 区切りの相対パス(自然順)。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileList {
    pub rel_paths: Vec<String>,
    pub truncated: bool,
}

/// 検索の1件。line は 1 始まり、column / length は Unicode スカラー値の数(行頭から)。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub rel_path: String,
    pub line: usize,
    pub column: usize,
    pub length: usize,
    pub preview: String,
    /// preview の中で、一致が始まる位置(文字数)
    pub preview_column: usize,
}

/// search_in_project の結果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub matches: Vec<SearchMatch>,
    pub truncated: bool,
    pub files_searched: usize,
}

/// 検索の設定(正規表現は無し)。
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
}

/// 手書き1本。points はボード(フロー)座標。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stroke {
    pub id: String,
    pub color: String,
    pub width: f64,
    pub points: Vec<[f64; 2]>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

/// get_board の戻り値。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardState {
    pub strokes: Vec<Stroke>,
    pub viewport: Option<Viewport>,
}

pub const SCHEMA_VERSION: u32 = 2;

/// v1 のファイルには strokes / viewport が無いので、欠けたら既定値で読む。
/// 旧版が書いた `edges`(コネクタ)は未知のフィールドとして無視する(次の保存で消える)。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreFile {
    pub schema_version: u32,
    pub projects: Vec<StoredProject>,
    #[serde(default)]
    pub strokes: Vec<Stroke>,
    #[serde(default)]
    pub viewport: Option<Viewport>,
    /// N9: エディタ設定(アプリ全体で共通)。古いファイルには無いので default で読み、
    /// 無いときは書き出さず、ファイルの形を変えない(schemaVersion は 2 のまま)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<EditorSettings>,
}

impl Default for StoreFile {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            projects: Vec::new(),
            strokes: Vec::new(),
            viewport: None,
            settings: None,
        }
    }
}

/// 自動保存の方式(フロントの "off" | "afterDelay" | "onFocusChange")。列挙以外は読み込みでエラーになる。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AutoSaveMode {
    Off,
    AfterDelay,
    OnFocusChange,
}

/// 数値を丸めて整数にする。JS 側が 12.5 のような小数や範囲外を送っても、エラーにせず後で範囲内へ丸めるため。
fn lenient_u32<'de, D: serde::Deserializer<'de>>(d: D) -> Result<u32, D::Error> {
    let v = f64::deserialize(d)?;
    if !v.is_finite() {
        return Err(serde::de::Error::custom("数値が不正です"));
    }
    // 負数は 0、巨大な値は上限へ寄る(as は飽和変換)
    Ok(v.round() as u32)
}

/// N9/N10: エディタの設定(契約書 docs/stage-n9-contract.md)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSettings {
    #[serde(deserialize_with = "lenient_u32")]
    pub font_size: u32,
    pub word_wrap: bool,
    pub auto_save: AutoSaveMode,
    #[serde(deserialize_with = "lenient_u32")]
    pub auto_save_delay_ms: u32,
}

// ---- 段階3: エディタのファイル操作(契約書 docs/stage3-contract.md §2) ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Dir,
    File,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub rel_path: String,
    pub kind: EntryKind,
    pub size: u64,
    pub modified: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ContentKind {
    Text,
    Binary,
    TooLarge,
    UnsupportedEncoding,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Eol {
    Lf,
    Crlf,
}

/// 扱える文字コード(段階3b-3)。名前は src/api/types.ts の ENCODINGS と一致させる。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TextEncoding {
    #[serde(rename = "utf-8")]
    Utf8,
    #[serde(rename = "shift_jis")]
    ShiftJis,
    #[serde(rename = "euc-jp")]
    EucJp,
    #[serde(rename = "utf-16le")]
    Utf16Le,
    #[serde(rename = "utf-16be")]
    Utf16Be,
    #[serde(rename = "windows-1252")]
    Windows1252,
    #[serde(rename = "gbk")]
    Gbk,
    #[serde(rename = "big5")]
    Big5,
    #[serde(rename = "euc-kr")]
    EucKr,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub rel_path: String,
    pub kind: ContentKind,
    pub content: Option<String>,
    pub size: u64,
    pub modified: String,
    pub eol: Eol,
    pub has_bom: bool,
    pub encoding: TextEncoding,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedFile {
    pub modified: String,
    pub size: u64,
}
