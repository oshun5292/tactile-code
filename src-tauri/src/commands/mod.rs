//! Tauri コマンドの入口(薄く保つ。処理は services / storage)。
use crate::domain::{BoardState, Edge, Position, ProjectSummary, StoredProject, Stroke, Viewport};
use crate::services::{board, paths, summary::build_summary};
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
            // 消えたカードにつながる線は宙に浮くので一緒に消す(手書きは残す)
            data.edges.retain(|e| e.source != id && e.target != id);
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
pub async fn add_edge(
    source: String,
    target: String,
    store: State<'_, Store>,
) -> Result<Edge, String> {
    run_store(&store, move |s| {
        s.update(|data| board::add_edge(data, &source, &target))
    })
    .await
}

#[tauri::command]
pub async fn remove_edge(id: String, store: State<'_, Store>) -> Result<(), String> {
    run_store(&store, move |s| {
        s.update(|data| board::remove_edge(data, &id))
    })
    .await
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
