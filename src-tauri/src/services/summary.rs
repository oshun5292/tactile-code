//! 保存データ(StoredProject)から、画面に返す ProjectSummary を組み立てる。
use super::{git, language, paths, readme};
use crate::domain::{ProjectSummary, StoredProject};
use std::path::Path;
use std::time::SystemTime;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

pub fn to_iso(t: SystemTime) -> Option<String> {
    OffsetDateTime::from(t).format(&Rfc3339).ok()
}

/// 重い処理(フォルダ走査・git)を含むので、呼び出し側で spawn_blocking すること。
/// フォルダが消えていても失敗させず exists:false で返す。
pub fn build_summary(p: &StoredProject) -> ProjectSummary {
    let root = Path::new(&p.path);
    let exists = root.is_dir();
    let mut summary = ProjectSummary {
        id: p.id.clone(),
        name: paths::dir_name(&p.path),
        path: p.path.clone(),
        display_path: paths::display_path(&p.path),
        exists,
        description: p.description_override.clone(),
        note: p.note.clone(),
        languages: Vec::new(),
        main_language: None,
        git: None,
        last_updated: None,
        position: p.position,
    };
    if !exists {
        return summary;
    }

    let scan = language::scan_project(root);
    summary.main_language = scan.languages.first().map(|l| l.name.clone());
    summary.languages = scan.languages;
    summary.git = git::read_git_info(root);
    // git があればコミット日時を優先、なければファイルの最新更新日時
    summary.last_updated = summary
        .git
        .as_ref()
        .and_then(|g| g.last_commit_at.clone())
        .or_else(|| scan.latest_modified.and_then(to_iso));
    if summary.description.is_none() {
        summary.description = readme::extract_description(root);
    }
    summary
}
