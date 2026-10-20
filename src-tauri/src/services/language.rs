//! 言語の自動検知(契約書 §5)。バイト数で割合を出す。
use crate::domain::LangShare;
use ignore::WalkBuilder;
use std::collections::HashMap;
use std::path::Path;
use std::time::SystemTime;

/// (言語名, 拡張子)。並び順が「同率のときの優先順」を兼ねる。
const LANGS: &[(&str, &[&str])] = &[
    ("TypeScript", &["ts", "tsx"]),
    ("JavaScript", &["js", "jsx", "mjs", "cjs"]),
    ("Python", &["py"]),
    ("SQL", &["sql"]),
    ("Markdown", &["md", "mdx"]),
    ("Rust", &["rs"]),
    ("YAML", &["yml", "yaml"]),
    ("JSON", &["json"]),
    ("CSS", &["css", "scss"]),
    ("HTML", &["html", "htm"]),
    ("Jinja", &["jinja", "jinja2", "j2"]),
    ("Shell", &["sh", "ps1"]),
    ("TOML", &["toml"]),
];

const EXCLUDED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".venv",
    "venv",
    "__pycache__",
    ".next",
    ".cache",
    "vendor",
];

const EXCLUDED_FILES: &[&str] = &[
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "Cargo.lock",
];

const MAX_FILES: usize = 50_000;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_LANGS: usize = 6;
pub const OTHER: &str = "その他";

pub struct ScanResult {
    pub languages: Vec<LangShare>,
    /// フォルダ内の最新のファイル更新時刻(lastUpdated 用)
    pub latest_modified: Option<SystemTime>,
}

fn lang_index(file_name: &str) -> Option<usize> {
    let lower = file_name.to_lowercase();
    // 生成物は言語に数えない
    if lower.ends_with(".min.js") || lower.ends_with(".map") {
        return None;
    }
    let ext = lower.rsplit_once('.')?.1;
    LANGS.iter().position(|(_, exts)| exts.contains(&ext))
}

pub fn scan_project(root: &Path) -> ScanResult {
    let mut bytes: HashMap<usize, u64> = HashMap::new();
    let mut latest: Option<SystemTime> = None;
    let mut count = 0usize;

    let walker = WalkBuilder::new(root)
        .hidden(true) // 隠しファイル・フォルダは対象外
        .require_git(false) // git 管理外でも .gitignore を効かせる
        .git_global(false) // 利用者ごとの設定で結果が変わらないように
        .follow_links(false)
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            let is_dir = e.file_type().is_some_and(|t| t.is_dir());
            !(is_dir && EXCLUDED_DIRS.contains(&e.file_name().to_string_lossy().as_ref()))
        })
        .build();

    for entry in walker.flatten() {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if EXCLUDED_FILES.contains(&name.as_str()) {
            continue;
        }
        count += 1;
        if count > MAX_FILES {
            break;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if let Ok(m) = meta.modified()
            && latest.is_none_or(|l| m > l)
        {
            latest = Some(m);
        }
        if meta.len() > MAX_FILE_BYTES {
            continue;
        }
        if let Some(i) = lang_index(&name) {
            *bytes.entry(i).or_insert(0) += meta.len();
        }
    }

    ScanResult {
        languages: to_shares(bytes),
        latest_modified: latest,
    }
}

/// バイト数 → 割合(整数・合計100)。最大6件+その他。
fn to_shares(bytes: HashMap<usize, u64>) -> Vec<LangShare> {
    let mut v: Vec<(usize, u64)> = bytes.into_iter().filter(|(_, b)| *b > 0).collect();
    // 大きい順。同率は表の順
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let total: u64 = v.iter().map(|(_, b)| *b).sum();
    if total == 0 {
        return Vec::new();
    }
    let mut entries: Vec<(String, u64)> = v
        .iter()
        .take(MAX_LANGS)
        .map(|(i, b)| (LANGS[*i].0.to_string(), *b))
        .collect();
    if v.len() > MAX_LANGS {
        let rest: u64 = v[MAX_LANGS..].iter().map(|(_, b)| *b).sum();
        entries.push((OTHER.to_string(), rest));
    }
    let mut out: Vec<LangShare> = entries
        .into_iter()
        .map(|(name, b)| LangShare {
            name,
            percent: ((b * 100 + total / 2) / total) as u32,
        })
        .collect();
    // 丸め誤差は最大の言語に足す
    let sum: i64 = out.iter().map(|l| l.percent as i64).sum();
    let fixed = out[0].percent as i64 + (100 - sum);
    out[0].percent = fixed.max(0) as u32;
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(root: &Path, rel: &str, size: usize) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, vec![b'a'; size]).unwrap();
    }

    fn pct(r: &ScanResult, name: &str) -> Option<u32> {
        r.languages
            .iter()
            .find(|l| l.name == name)
            .map(|l| l.percent)
    }

    #[test]
    fn basic_ratio_and_sum_100() {
        let d = tempfile::tempdir().unwrap();
        write(d.path(), "a.py", 100);
        write(d.path(), "b.sql", 100);
        write(d.path(), "c.rs", 100);
        let r = scan_project(d.path());
        assert_eq!(r.languages.iter().map(|l| l.percent).sum::<u32>(), 100);
        // 3等分 → 33/33/33 + 端数1 を、先頭(表順で最初のPython)に足す
        assert_eq!(r.languages[0].name, "Python");
        assert_eq!(r.languages[0].percent, 34);
        assert!(r.latest_modified.is_some());
    }

    #[test]
    fn excluded_dirs_and_files_and_hidden() {
        let d = tempfile::tempdir().unwrap();
        write(d.path(), "src/main.rs", 50);
        write(d.path(), "node_modules/x/index.js", 5000);
        write(d.path(), "target/debug/x.rs", 5000);
        write(d.path(), ".hidden/a.py", 5000);
        write(d.path(), "package-lock.json", 5000);
        write(d.path(), "app.min.js", 5000);
        write(d.path(), "app.js.map", 5000);
        write(d.path(), "notes.txt", 5000);
        let r = scan_project(d.path());
        assert_eq!(r.languages.len(), 1);
        assert_eq!(pct(&r, "Rust"), Some(100));
    }

    #[test]
    fn respects_gitignore_without_git() {
        let d = tempfile::tempdir().unwrap();
        write(d.path(), "keep.py", 10);
        write(d.path(), "gen/big.rs", 1000);
        fs::write(d.path().join(".gitignore"), "gen/\n").unwrap();
        let r = scan_project(d.path());
        assert_eq!(pct(&r, "Python"), Some(100));
        assert_eq!(pct(&r, "Rust"), None);
    }

    #[test]
    fn huge_file_is_skipped() {
        let d = tempfile::tempdir().unwrap();
        write(d.path(), "small.py", 10);
        write(d.path(), "huge.json", (MAX_FILE_BYTES + 1) as usize);
        let r = scan_project(d.path());
        assert_eq!(pct(&r, "Python"), Some(100));
        assert_eq!(pct(&r, "JSON"), None);
    }

    #[test]
    fn tie_uses_table_order() {
        let d = tempfile::tempdir().unwrap();
        write(d.path(), "a.rs", 10);
        write(d.path(), "a.ts", 10);
        let r = scan_project(d.path());
        assert_eq!(r.languages[0].name, "TypeScript");
        assert_eq!(r.languages[1].name, "Rust");
    }

    #[test]
    fn more_than_six_becomes_other() {
        let d = tempfile::tempdir().unwrap();
        for (i, f) in [
            "a.ts", "a.js", "a.py", "a.sql", "a.md", "a.rs", "a.yml", "a.toml",
        ]
        .iter()
        .enumerate()
        {
            write(d.path(), f, 100 - i * 5);
        }
        let r = scan_project(d.path());
        assert_eq!(r.languages.len(), 7);
        assert_eq!(r.languages.last().unwrap().name, OTHER);
        assert_eq!(r.languages.iter().map(|l| l.percent).sum::<u32>(), 100);
    }

    #[test]
    fn empty_folder() {
        let d = tempfile::tempdir().unwrap();
        assert!(scan_project(d.path()).languages.is_empty());
    }
}
