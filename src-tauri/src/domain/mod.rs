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
}

impl Default for StoreFile {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            projects: Vec::new(),
            strokes: Vec::new(),
            viewport: None,
        }
    }
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
