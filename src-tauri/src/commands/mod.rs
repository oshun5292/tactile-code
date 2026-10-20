//! Tauri コマンドの入口(薄く保つ。処理は services / storage)。
use crate::domain::{
    BoardState, EditorSession, EditorSettings, Eol, FileContent, FileList, FileStat, FsEntry,
    Position, ProjectSummary, SavedFile, SearchOptions, SearchResult, StoredProject, Stroke,
    TextEncoding, Viewport,
};
use crate::services::{board, fs, paths, search, settings, summary::build_summary};
use crate::storage::Store;
use tauri::State;

const MAX_NOTE_CHARS: usize = 200;
// カードの初期配置(格子)。既存カードと重なりにくくする
const GRID_COLS: usize = 3;
// カードの幅(420px)+すき間24px。高さは約350px+すき間。画面(1440px)に3列で収まる間隔
const GRID_W: f64 = 444.0;
const GRID_H: f64 = 380.0;
const GRID_ORIGIN: f64 = 0.0;

fn join_err(_: tauri::Error) -> String {
    "内部エラーが発生しました".to_string()
}

fn find<'a>(
    data: &'a mut crate::domain::StoreFile,
    id: &str,
) -> Result<&'a mut StoredProject, String> {
    data.projects
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| "プロジェクトが見つかりません".to_string())
}

/// 重い計算は別スレッドで。1件の失敗は exists:false で吸収されるので全体は失敗しない。
async fn summarize(p: StoredProject) -> Result<ProjectSummary, String> {
    tauri::async_runtime::spawn_blocking(move || build_summary(&p))
        .await
        .map_err(join_err)
}

async fn run_store<R: Send + 'static>(
    store: &Store,
    f: impl FnOnce(&Store) -> Result<R, String> + Send + 'static,
) -> Result<R, String> {
    let store = store.clone();
    tauri::async_runtime::spawn_blocking(move || f(&store))
        .await
        .map_err(join_err)?
}

#[tauri::command]
pub async fn list_projects(store: State<'_, Store>) -> Result<Vec<ProjectSummary>, String> {
    let data = run_store(&store, |s| Ok(s.read())).await?;
    let tasks: Vec<_> = data
        .projects
        .into_iter()
        .map(|p| tauri::async_runtime::spawn_blocking(move || build_summary(&p)))
        .collect();
    let mut out = Vec::with_capacity(tasks.len());
    for t in tasks {
        out.push(t.await.map_err(join_err)?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn add_project(path: String, store: State<'_, Store>) -> Result<ProjectSummary, String> {
    let stored = run_store(&store, move |s| {
        let dir = paths::normalize_dir(&path)?;
        let dir_str = dir.to_string_lossy().to_string();
        s.update(|data| {
            let key = paths::path_key(&dir_str);
            if data
                .projects
                .iter()
                .any(|p| paths::path_key(&p.path) == key)
            {
                return Err("すでに登録されています".to_string());
            }
            let p = StoredProject {
                id: uuid::Uuid::new_v4().to_string(),
                path: dir_str,
                note: String::new(),
                description_override: None,
                position: free_grid_slot(&data.projects),
                editor_session: None,
            };
            data.projects.push(p.clone());
            Ok(p)
        })
    })
    .await?;
    summarize(stored).await
}

/// 格子の中で、まだ誰も使っていない最初の位置。
fn free_grid_slot(existing: &[StoredProject]) -> Position {
    (0usize..)
        .map(|i| Position {
            x: GRID_ORIGIN + (i % GRID_COLS) as f64 * GRID_W,
            y: GRID_ORIGIN + (i / GRID_COLS) as f64 * GRID_H,
        })
        .find(|pos| {
            !existing
                .iter()
                .any(|p| p.position.x == pos.x && p.position.y == pos.y)
        })
        .expect("無限に続くイテレータ")
}

/// 記憶から外すだけ。フォルダには触らない。
#[tauri::command]
pub async fn remove_project(id: String, store: State<'_, Store>) -> Result<(), String> {
    run_store(&store, move |s| {
        s.update(|data| {
            let before = data.projects.len();
            data.projects.retain(|p| p.id != id);
            if data.projects.len() == before {
                return Err("プロジェクトが見つかりません".to_string());
            }
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn update_project_note(
    id: String,
    note: String,
    store: State<'_, Store>,
) -> Result<(), String> {
    if note.chars().count() > MAX_NOTE_CHARS {
        return Err(format!(
            "ひと言メモは{MAX_NOTE_CHARS}文字以内にしてください"
        ));
    }
    run_store(&store, move |s| {
        s.update(|data| {
            find(data, &id)?.note = note;
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn update_project_description(
    id: String,
    description: Option<String>,
    store: State<'_, Store>,
) -> Result<(), String> {
    // 空文字は「README由来に戻す」と同じ扱いにする
    let description = description.filter(|d| !d.trim().is_empty());
    run_store(&store, move |s| {
        s.update(|data| {
            find(data, &id)?.description_override = description;
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn move_project(
    id: String,
    x: f64,
    y: f64,
    store: State<'_, Store>,
) -> Result<(), String> {
    if !x.is_finite() || !y.is_finite() {
        return Err("位置が不正です".to_string());
    }
    run_store(&store, move |s| {
        s.update(|data| {
            find(data, &id)?.position = Position { x, y };
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn refresh_project(
    id: String,
    store: State<'_, Store>,
) -> Result<ProjectSummary, String> {
    let stored = run_store(&store, move |s| {
        s.read()
            .projects
            .into_iter()
            .find(|p| p.id == id)
            .ok_or_else(|| "プロジェクトが見つかりません".to_string())
    })
    .await?;
    summarize(stored).await
}

#[tauri::command]
pub async fn get_board(store: State<'_, Store>) -> Result<BoardState, String> {
    run_store(&store, |s| Ok(board::board_state(&s.read()))).await
}

#[tauri::command]
pub async fn add_stroke(
    color: String,
    width: f64,
    points: Vec<[f64; 2]>,
    store: State<'_, Store>,
) -> Result<Stroke, String> {
    run_store(&store, move |s| {
        s.update(|data| board::add_stroke(data, &color, width, points))
    })
    .await
}

#[tauri::command]
pub async fn remove_stroke(id: String, store: State<'_, Store>) -> Result<(), String> {
    run_store(&store, move |s| {
        s.update(|data| board::remove_stroke(data, &id))
    })
    .await
}

#[tauri::command]
pub async fn clear_strokes(store: State<'_, Store>) -> Result<(), String> {
    run_store(&store, |s| {
        s.update(|data| {
            data.strokes.clear();
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn save_viewport(
    x: f64,
    y: f64,
    zoom: f64,
    store: State<'_, Store>,
) -> Result<(), String> {
    run_store(&store, move |s| {
        s.update(|data| board::save_viewport(data, Viewport { x, y, zoom }))
    })
    .await
}

// ---- 段階3: エディタのファイル操作(検証は services::fs に集約) ----

/// プロジェクトIDから登録済みのフォルダを引く。ID が未登録なら、ファイルには触れない。
fn project_root(store: &Store, id: &str) -> Result<std::path::PathBuf, String> {
    store
        .read()
        .projects
        .into_iter()
        .find(|p| p.id == id)
        .map(|p| std::path::PathBuf::from(p.path))
        .ok_or_else(|| "プロジェクトが見つかりません".to_string())
}

#[tauri::command]
pub async fn list_dir(
    project_id: String,
    rel_path: String,
    store: State<'_, Store>,
) -> Result<Vec<FsEntry>, String> {
    run_store(&store, move |s| {
        fs::list_dir(&project_root(s, &project_id)?, &rel_path)
    })
    .await
}

#[tauri::command]
pub async fn read_file(
    project_id: String,
    rel_path: String,
    encoding: Option<TextEncoding>,
    store: State<'_, Store>,
) -> Result<FileContent, String> {
    run_store(&store, move |s| {
        fs::read_file(&project_root(s, &project_id)?, &rel_path, encoding)
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn write_file(
    project_id: String,
    rel_path: String,
    content: String,
    expected_modified: Option<String>,
    eol: Eol,
    has_bom: bool,
    encoding: TextEncoding,
    force: bool,
    store: State<'_, Store>,
) -> Result<SavedFile, String> {
    run_store(&store, move |s| {
        let req = fs::WriteRequest {
            content: &content,
            expected_modified: expected_modified.as_deref(),
            eol,
            has_bom,
            encoding,
            force,
        };
        fs::write_file(&project_root(s, &project_id)?, &rel_path, &req)
    })
    .await
}

// ---- 段階3b-1: 外部変更の検知とタブの復元 ----

#[tauri::command]
pub async fn stat_files(
    project_id: String,
    rel_paths: Vec<String>,
    store: State<'_, Store>,
) -> Result<Vec<FileStat>, String> {
    run_store(&store, move |s| {
        fs::stat_files(&project_root(s, &project_id)?, &rel_paths)
    })
    .await
}

#[tauri::command]
pub async fn get_editor_session(
    project_id: String,
    store: State<'_, Store>,
) -> Result<Option<EditorSession>, String> {
    run_store(&store, move |s| {
        s.read()
            .projects
            .into_iter()
            .find(|p| p.id == project_id)
            .map(|p| p.editor_session)
            .ok_or_else(|| "プロジェクトが見つかりません".to_string())
    })
    .await
}

#[tauri::command]
pub async fn save_editor_session(
    project_id: String,
    data: EditorSession,
    store: State<'_, Store>,
) -> Result<(), String> {
    // 不正なパスの除去と上限の切り詰めは保存前に行う(エラーにしない)
    let data = fs::sanitize_session(data);
    run_store(&store, move |s| {
        s.update(|all| {
            find(all, &project_id)?.editor_session = Some(data);
            Ok(())
        })
    })
    .await
}

// ---- 段階3b-2: ファイル操作・VSCodeで開く(検証は services::fs に集約) ----

#[tauri::command]
pub async fn create_file(
    project_id: String,
    rel_path: String,
    store: State<'_, Store>,
) -> Result<FsEntry, String> {
    run_store(&store, move |s| {
        fs::create_file(&project_root(s, &project_id)?, &rel_path)
    })
    .await
}

#[tauri::command]
pub async fn create_dir(
    project_id: String,
    rel_path: String,
    store: State<'_, Store>,
) -> Result<FsEntry, String> {
    run_store(&store, move |s| {
        fs::create_dir(&project_root(s, &project_id)?, &rel_path)
    })
    .await
}

#[tauri::command]
pub async fn rename_entry(
    project_id: String,
    from_rel_path: String,
    to_rel_path: String,
    store: State<'_, Store>,
) -> Result<FsEntry, String> {
    run_store(&store, move |s| {
        fs::rename_entry(&project_root(s, &project_id)?, &from_rel_path, &to_rel_path)
    })
    .await
}

#[tauri::command]
pub async fn delete_entry(
    project_id: String,
    rel_path: String,
    store: State<'_, Store>,
) -> Result<(), String> {
    run_store(&store, move |s| {
        fs::delete_entry(&project_root(s, &project_id)?, &rel_path)
    })
    .await
}

#[tauri::command]
pub async fn duplicate_entry(
    project_id: String,
    rel_path: String,
    store: State<'_, Store>,
) -> Result<FsEntry, String> {
    run_store(&store, move |s| {
        fs::duplicate_entry(&project_root(s, &project_id)?, &rel_path)
    })
    .await
}

#[tauri::command]
pub async fn open_in_vscode(
    project_id: String,
    rel_path: String,
    store: State<'_, Store>,
) -> Result<(), String> {
    run_store(&store, move |s| {
        fs::open_in_vscode(&project_root(s, &project_id)?, &rel_path)
    })
    .await
}

// ---- 段階N2: クイックオープン(Ctrl+P)用の全ファイル一覧 ----

#[tauri::command]
pub async fn list_files(project_id: String, store: State<'_, Store>) -> Result<FileList, String> {
    run_store(&store, move |s| {
        fs::list_files(&project_root(s, &project_id)?)
    })
    .await
}

// ---- 段階N3: プロジェクト内検索(Ctrl+Shift+F) ----

#[tauri::command]
pub async fn search_in_project(
    project_id: String,
    query: String,
    options: SearchOptions,
    store: State<'_, Store>,
) -> Result<SearchResult, String> {
    run_store(&store, move |s| {
        search::search_in_project(&project_root(s, &project_id)?, &query, options)
    })
    .await
}

// ---- 段階N9: エディタの設定(アプリ全体で共通) ----

/// 保存が無ければ None(既定値はフロントが持つ)。
#[tauri::command]
pub async fn get_settings(store: State<'_, Store>) -> Result<Option<EditorSettings>, String> {
    run_store(&store, |s| Ok(s.read().settings)).await
}

#[tauri::command]
pub async fn save_settings(
    settings: EditorSettings,
    store: State<'_, Store>,
) -> Result<(), String> {
    // 範囲外は保存前に丸める(エラーにしない)
    let clamped = settings::clamp(settings);
    run_store(&store, move |s| {
        s.update(|data| {
            data.settings = Some(clamped);
            Ok(())
        })
    })
    .await
}
