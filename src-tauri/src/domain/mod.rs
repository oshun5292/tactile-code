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
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreFile {
    pub schema_version: u32,
    pub projects: Vec<StoredProject>,
}

impl Default for StoreFile {
    fn default() -> Self {
        Self {
            schema_version: 1,
            projects: Vec::new(),
        }
    }
}
