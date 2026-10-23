//! projects.json の読み書き(契約書 §4)。
use crate::domain::{SCHEMA_VERSION, StoreFile};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use time::OffsetDateTime;

/// 保存先を持つ共有ハンドル。Mutex で「読む→変える→書く」を直列にして、同時更新で壊れないようにする。
/// 中身をメモリに保持するのは、save_viewport / add_stroke のような頻繁な呼び出しで
/// 毎回ファイルを読み直して解析する無駄(手書きが増えると重い)を避けるため。
#[derive(Clone)]
pub struct Store {
    file: PathBuf,
    cache: Arc<Mutex<Option<StoreFile>>>,
}

impl Store {
    pub fn new(file: PathBuf) -> Self {
        Self {
            file,
            cache: Arc::new(Mutex::new(None)),
        }
    }

    /// 読み取り専用。
    pub fn read(&self) -> StoreFile {
        let mut g = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        g.get_or_insert_with(|| load(&self.file)).clone()
    }

    /// 変更して保存する。f がエラーを返したら保存しない。
    pub fn update<R>(
        &self,
        f: impl FnOnce(&mut StoreFile) -> Result<R, String>,
    ) -> Result<R, String> {
        let mut g = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        let data = g.get_or_insert_with(|| load(&self.file));
        let result = f(data).and_then(|r| save(&self.file, data).map(|_| r));
        if result.is_err() {
            // 途中まで書き換わった可能性があるので、メモリの内容を捨てて次回ファイルから読み直す
            *g = None;
        }
        result
    }
}

/// 読み込み。無ければ空。壊れていたら退避して空から始める(アプリを落とさない)。
pub fn load(file: &Path) -> StoreFile {
    let Ok(text) = std::fs::read_to_string(file) else {
        return StoreFile::default();
    };
    match serde_json::from_str::<StoreFile>(&text) {
        Ok(mut d) => {
            // v1 のファイルは欠けた項目が既定値で埋まる。次の保存で v2 として書く
            d.schema_version = SCHEMA_VERSION;
            d
        }
        Err(_) => {
            let _ = back_up_broken(file);
            StoreFile::default()
        }
    }
}

fn back_up_broken(file: &Path) -> std::io::Result<PathBuf> {
    let now = OffsetDateTime::now_utc();
    let stamp = format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        now.year(),
        now.month() as u8,
        now.day(),
        now.hour(),
        now.minute(),
        now.second()
    );
    let name = file
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "projects.json".into());
    let dest = file.with_file_name(format!("{name}.broken-{stamp}"));
    std::fs::rename(file, &dest)?;
    Ok(dest)
}

/// 一時ファイルに書いてから置き換える。途中で落ちても元のファイルは壊れない。
pub fn save(file: &Path, data: &StoreFile) -> Result<(), String> {
    let dir = file.parent().ok_or("保存先が不正です")?;
    std::fs::create_dir_all(dir).map_err(|_| "保存フォルダを作れませんでした".to_string())?;
    let json = serde_json::to_string(data).map_err(|_| "保存に失敗しました".to_string())?;
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|_| "保存に失敗しました".to_string())?;
    std::fs::rename(&tmp, file).map_err(|_| "保存に失敗しました".to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Position, StoredProject, Stroke, Viewport};

    fn sample() -> StoreFile {
        StoreFile {
            schema_version: 2,
            projects: vec![StoredProject {
                id: "id1".into(),
                path: r"C:\work\a".into(),
                note: "メモ".into(),
                description_override: Some("説明".into()),
                position: Position { x: 1.5, y: 2.0 },
                editor_session: None,
            }],
            strokes: vec![Stroke {
                id: "s1".into(),
                color: "#34302b".into(),
                width: 3.0,
                points: vec![[0.0, 0.0], [10.0, 4.0]],
            }],
            viewport: Some(Viewport {
                x: -5.0,
                y: 6.5,
                zoom: 0.8,
            }),
        }
    }

    #[test]
    fn roundtrip() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("sub").join("projects.json");
        assert_eq!(load(&f), StoreFile::default());
        save(&f, &sample()).unwrap();
        assert_eq!(load(&f), sample());
        let text = std::fs::read_to_string(&f).unwrap();
        assert!(text.contains("schemaVersion") && text.contains("descriptionOverride"));
        assert!(
            text.contains("\"strokes\"")
                && text.contains("\"viewport\"")
                && !text.contains("edges")
        );
        assert!(!f.with_extension("json.tmp").exists());
    }

    #[test]
    fn broken_json_is_moved_aside() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("projects.json");
        std::fs::write(&f, "{ broken").unwrap();
        assert_eq!(load(&f), StoreFile::default());
        assert!(!f.exists());
        let moved: Vec<_> = std::fs::read_dir(d.path())
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("projects.json.broken-")
            })
            .collect();
        assert_eq!(moved.len(), 1);
    }

    #[test]
    fn v1_file_is_readable_and_saved_as_v2() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("projects.json");
        let v1 = r#"{"schemaVersion":1,"projects":[{"id":"p1","path":"C:/w/a","note":"n","position":{"x":3.0,"y":4.0}}]}"#;
        std::fs::write(&f, v1).unwrap();
        let store = Store::new(f.clone());
        let got = store.read();
        assert_eq!(got.schema_version, 2);
        assert_eq!(got.projects.len(), 1);
        assert_eq!(got.projects[0].note, "n");
        assert!(got.strokes.is_empty() && got.viewport.is_none());
        // 読んだだけでは書き換えない。次の保存で v2 になる
        assert!(std::fs::read_to_string(&f).unwrap().contains(":1,"));
        store
            .update(|data| {
                data.viewport = Some(Viewport {
                    x: 1.0,
                    y: 2.0,
                    zoom: 1.0,
                });
                Ok(())
            })
            .unwrap();
        let text = std::fs::read_to_string(&f).unwrap();
        assert!(text.contains("\"schemaVersion\":2"));
        assert_eq!(load(&f).projects[0].id, "p1");
    }

    #[test]
    fn file_with_legacy_edges_is_readable() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("projects.json");
        let old = r##"{"schemaVersion":2,"projects":[{"id":"p1","path":"C:/w/a","note":"n","position":{"x":3.0,"y":4.0}}],"edges":[{"id":"e1","source":"p1","target":"p1"}],"strokes":[{"id":"s1","color":"#34302b","width":3.0,"points":[[0.0,0.0],[1.0,1.0]]}]}"##;
        std::fs::write(&f, old).unwrap();
        let store = Store::new(f.clone());
        let got = store.read();
        assert_eq!(got.projects.len(), 1);
        assert_eq!(got.strokes.len(), 1);
        // 次の保存で edges は書かれなくなる
        store.update(|_| Ok(())).unwrap();
        let text = std::fs::read_to_string(&f).unwrap();
        assert!(!text.contains("edges"));
        assert_eq!(load(&f).strokes.len(), 1);
    }

    #[test]
    fn broken_v2_json_is_moved_aside_via_store() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("projects.json");
        // v2 の形だが壊れている(strokes が配列でない)
        std::fs::write(&f, r#"{"schemaVersion":2,"projects":[],"strokes":5}"#).unwrap();
        let store = Store::new(f.clone());
        assert_eq!(store.read(), StoreFile::default());
        assert!(!f.exists());
    }

    #[test]
    fn editor_session_roundtrip_and_old_file_compat() {
        use crate::domain::{EditorSession, MdMode, SessionTab};
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("projects.json");
        // editorSession の無い古いファイルは読める。読んだだけでは session は None
        let old = r#"{"schemaVersion":2,"projects":[{"id":"p1","path":"C:/w/a","note":"n","position":{"x":3.0,"y":4.0}}]}"#;
        std::fs::write(&f, old).unwrap();
        let store = Store::new(f.clone());
        assert!(store.read().projects[0].editor_session.is_none());
        // 保存して読み直せる(camelCase で書かれる)
        let sess = EditorSession {
            tabs: vec![SessionTab {
                rel_path: "a/b.md".into(),
                md_mode: MdMode::Read,
            }],
            active: Some("a/b.md".into()),
            expanded: vec!["a".into()],
        };
        store
            .update(|data| {
                data.projects[0].editor_session = Some(sess.clone());
                Ok(())
            })
            .unwrap();
        let text = std::fs::read_to_string(&f).unwrap();
        assert!(text.contains("\"editorSession\"") && text.contains("\"mdMode\":\"read\""));
        assert!(text.contains("\"schemaVersion\":2"));
        assert_eq!(load(&f).projects[0].editor_session, Some(sess));
        // セッションの無いプロジェクトでは、項目自体を書き出さない
        let g = d.path().join("other.json");
        save(&g, &sample()).unwrap();
        assert!(
            !std::fs::read_to_string(&g)
                .unwrap()
                .contains("editorSession")
        );
    }

    #[test]
    fn update_skips_save_on_error() {
        let d = tempfile::tempdir().unwrap();
        let store = Store::new(d.path().join("projects.json"));
        let r: Result<(), String> = store.update(|_| Err("x".into()));
        assert!(r.is_err());
        assert!(!d.path().join("projects.json").exists());
    }
}
