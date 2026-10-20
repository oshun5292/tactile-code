//! パスの正規化と表示用の短縮。
use std::path::{Path, PathBuf};

/// 存在するフォルダだけを受け付け、絶対パスに正規化する。
pub fn normalize_dir(input: &str) -> Result<PathBuf, String> {
    let p = Path::new(input.trim());
    if !p.exists() {
        return Err("フォルダが見つかりません".to_string());
    }
    if !p.is_dir() {
        return Err("フォルダではありません(ファイルは登録できません)".to_string());
    }
    let canon = p
        .canonicalize()
        .map_err(|_| "パスを解決できませんでした".to_string())?;
    Ok(strip_verbatim(&canon))
}

/// Windows の canonicalize が付ける `\\?\` を外す(表示と比較を素直にするため)。
fn strip_verbatim(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        p.to_path_buf()
    }
}

/// 二重登録の判定用キー。Windows は大文字小文字を区別しない。
pub fn path_key(p: &str) -> String {
    let s = p.trim_end_matches(['\\', '/']).replace('\\', "/");
    if cfg!(windows) { s.to_lowercase() } else { s }
}

pub fn dir_name(p: &str) -> String {
    Path::new(p)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| p.to_string())
}

fn home_dir() -> Option<String> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .filter(|s| !s.is_empty())
}

pub fn display_path(path: &str) -> String {
    display_path_with_home(path, home_dir().as_deref())
}

/// ホーム配下なら "~/…"、区切りは / にそろえる。
pub fn display_path_with_home(path: &str, home: Option<&str>) -> String {
    let norm = path.replace('\\', "/");
    if let Some(h) = home {
        let h = h.replace('\\', "/");
        let h = h.trim_end_matches('/');
        let (np, nh) = if cfg!(windows) {
            (norm.to_lowercase(), h.to_lowercase())
        } else {
            (norm.clone(), h.to_string())
        };
        if np == nh {
            return "~".to_string();
        }
        if np.starts_with(&format!("{nh}/")) {
            return format!("~{}", &norm[h.len()..]);
        }
    }
    norm
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_under_home() {
        assert_eq!(
            display_path_with_home(r"C:\Users\a\Documents\x", Some(r"C:\Users\a")),
            if cfg!(windows) {
                "~/Documents/x"
            } else {
                "C:/Users/a/Documents/x"
            }
        );
        assert_eq!(
            display_path_with_home(r"D:\work\x", Some(r"C:\Users\a")),
            "D:/work/x"
        );
    }

    #[test]
    fn rejects_missing_and_file() {
        assert!(normalize_dir("/no/such/dir/xyz").is_err());
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("a.txt");
        std::fs::write(&f, "x").unwrap();
        assert!(normalize_dir(f.to_str().unwrap()).is_err());
        assert!(normalize_dir(d.path().to_str().unwrap()).is_ok());
    }
}
