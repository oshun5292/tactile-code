//! projects.json の読み書き(契約書 §4)。
use crate::domain::StoreFile;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use time::OffsetDateTime;

/// 保存先を持つ共有ハンドル。Mutex で「読む→変える→書く」を直列にして、同時更新で壊れないようにする。
#[derive(Clone)]
pub struct Store {
    file: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl Store {
    pub fn new(file: PathBuf) -> Self {
        Self {
            file,
            lock: Arc::new(Mutex::new(())),
        }
    }

    /// 読み取り専用。
    pub fn read(&self) -> StoreFile {
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        load(&self.file)
    }

    /// 変更して保存する。f がエラーを返したら保存しない。
    pub fn update<R>(
        &self,
        f: impl FnOnce(&mut StoreFile) -> Result<R, String>,
    ) -> Result<R, String> {
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut data = load(&self.file);
        let r = f(&mut data)?;
        save(&self.file, &data)?;
        Ok(r)
    }
}

/// 読み込み。無ければ空。壊れていたら退避して空から始める(アプリを落とさない)。
pub fn load(file: &Path) -> StoreFile {
    let Ok(text) = std::fs::read_to_string(file) else {
        return StoreFile::default();
    };
    match serde_json::from_str::<StoreFile>(&text) {
        Ok(d) => d,
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
    let json = serde_json::to_string_pretty(data).map_err(|_| "保存に失敗しました".to_string())?;
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|_| "保存に失敗しました".to_string())?;
    std::fs::rename(&tmp, file).map_err(|_| "保存に失敗しました".to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Position, StoredProject};

    fn sample() -> StoreFile {
        StoreFile {
            schema_version: 1,
            projects: vec![StoredProject {
                id: "id1".into(),
                path: r"C:\work\a".into(),
                note: "メモ".into(),
                description_override: Some("説明".into()),
                position: Position { x: 1.5, y: 2.0 },
            }],
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
    fn update_skips_save_on_error() {
        let d = tempfile::tempdir().unwrap();
        let store = Store::new(d.path().join("projects.json"));
        let r: Result<(), String> = store.update(|_| Err("x".into()));
        assert!(r.is_err());
        assert!(!d.path().join("projects.json").exists());
    }
}
