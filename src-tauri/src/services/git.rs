//! git 情報の取得(契約書 §6)。PR や CI は段階1では扱わない。
use crate::domain::{GitFileState, GitFileStatus, GitInfo, GitStatus, Remote};
use std::path::Path;
use std::process::{Command, Stdio};

/// 出力を加工せずに返す(`-z` の先頭の空白や NUL を壊さないため)。
fn run_git_raw(path: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(path)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // コンソール窓が一瞬出ないように CREATE_NO_WINDOW
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn run_git(path: &Path, args: &[&str]) -> Option<String> {
    run_git_raw(path, args).map(|s| s.trim().to_string())
}

/// git 管理外、または git が無ければ None。
pub fn read_git_info(path: &Path) -> Option<GitInfo> {
    // 親フォルダのリポジトリを拾わないよう、直下に .git があるものだけ対象にする
    if !path.join(".git").exists() {
        return None;
    }
    // git が使えるか(無ければ None)
    run_git(path, &["rev-parse", "--git-dir"])?;

    let branch = run_git(path, &["rev-parse", "--abbrev-ref", "HEAD"])
        .filter(|b| b != "HEAD")
        // コミット前のリポジトリでは rev-parse が失敗するので別の方法で取る
        .or_else(|| run_git(path, &["symbolic-ref", "--short", "-q", "HEAD"]))
        .filter(|b| !b.is_empty());

    let remote = run_git(path, &["remote", "get-url", "origin"])
        .and_then(|u| parse_github_repo(&u))
        .map(|repo| Remote { repo });

    let counts = run_git(
        path,
        &["rev-list", "--left-right", "--count", "@{u}...HEAD"],
    );
    let (behind, ahead, has_upstream) = match counts.as_deref().and_then(parse_counts) {
        Some((b, a)) => (b, a, true),
        None => (0, 0, false),
    };

    let last_commit_at = run_git(path, &["log", "-1", "--format=%cI"]).filter(|s| !s.is_empty());

    Some(GitInfo {
        branch,
        remote,
        ahead,
        behind,
        has_upstream,
        last_commit_at,
    })
}

/// "左(上流にだけある=behind) 右(HEADにだけある=ahead)"
fn parse_counts(s: &str) -> Option<(u32, u32)> {
    let mut it = s.split_whitespace();
    let behind = it.next()?.parse().ok()?;
    let ahead = it.next()?.parse().ok()?;
    Some((behind, ahead))
}

/// GitHub の origin URL から "owner/name" を取り出す。それ以外は None。
pub fn parse_github_repo(url: &str) -> Option<String> {
    let url = url.trim();
    let path = if let Some(rest) = url.strip_prefix("git@github.com:") {
        rest
    } else {
        let (_, rest) = url.split_once("://")?;
        let (authority, path) = rest.split_once('/')?;
        let host = authority.rsplit('@').next()?;
        let host = host.split(':').next()?;
        if !host.eq_ignore_ascii_case("github.com") {
            return None;
        }
        path
    };
    let path = path.trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let (owner, name) = path.split_once('/')?;
    let valid = |s: &str| {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    };
    if valid(owner) && valid(name) {
        Some(format!("{owner}/{name}"))
    } else {
        None
    }
}

// ---- 段階N11: ツリーに出す git 状態 ----

/// 返す件数の上限(巨大な変更で画面と通信を重くしない)。
const MAX_STATUS_FILES: usize = 5_000;

/// git 管理外・git 無しは `is_repo: false`(エラーにしない)。
pub fn get_git_status(root: &Path) -> GitStatus {
    let none = GitStatus {
        is_repo: false,
        files: vec![],
        truncated: false,
    };
    // 親フォルダのリポジトリを拾わないよう、直下に .git があるものだけ対象にする
    if !root.join(".git").exists() {
        return none;
    }
    // -z: 日本語・空白のパスを、core.quotepath に依存せず正しく受け取る
    match run_git_raw(
        root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    ) {
        Some(out) => {
            let (files, truncated) = parse_porcelain_z(&out, MAX_STATUS_FILES);
            GitStatus {
                is_repo: true,
                files,
                truncated,
            }
        }
        None => none,
    }
}

/// XY の2文字を状態に分類する。無視(`!!`)などは None。
fn classify(x: char, y: char) -> Option<GitFileState> {
    use GitFileState::*;
    if (x, y) == ('!', '!') {
        return None;
    }
    if (x, y) == ('?', '?') {
        return Some(Untracked);
    }
    if x == 'U' || y == 'U' || (x, y) == ('A', 'A') || (x, y) == ('D', 'D') {
        return Some(Conflicted);
    }
    if x == 'R' || y == 'R' {
        return Some(Renamed);
    }
    if x == 'A' || y == 'A' || x == 'C' || y == 'C' {
        return Some(Added);
    }
    if x == 'D' || y == 'D' {
        return Some(Deleted);
    }
    if x == 'M' || y == 'M' || x == 'T' || y == 'T' {
        return Some(Modified);
    }
    None
}

/// プロジェクトの内側の相対パスだけ通す(絶対パス・`..`・ドライブ指定は捨てる)。
fn safe_rel_path(p: &str) -> Option<String> {
    let p = p.replace('\\', "/");
    let p = p.trim_end_matches('/');
    let bad = p.is_empty()
        || p.starts_with('/')
        || p.contains(':')
        || p.split('/').any(|c| c.is_empty() || c == "." || c == "..");
    if bad { None } else { Some(p.to_string()) }
}

/// `status --porcelain=v1 -z` の出力を解釈する。上限を超えたら打ち切って true を返す。
fn parse_porcelain_z(out: &str, limit: usize) -> (Vec<GitFileStatus>, bool) {
    let mut files = Vec::new();
    let mut it = out.split('\0');
    while let Some(entry) = it.next() {
        let mut chars = entry.chars();
        let (Some(x), Some(y), Some(' ')) = (chars.next(), chars.next(), chars.next()) else {
            continue;
        };
        let path = chars.as_str();
        // リネーム・コピーは「新パス\0旧パス」の順。旧パスは読み捨てる
        if matches!(x, 'R' | 'C') || matches!(y, 'R' | 'C') {
            it.next();
        }
        let (Some(state), Some(rel_path)) = (classify(x, y), safe_rel_path(path)) else {
            continue;
        };
        if files.len() >= limit {
            return (files, true);
        }
        files.push(GitFileStatus { rel_path, state });
    }
    (files, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_urls() {
        let ok = Some("oshun5292/tactile-code".to_string());
        assert_eq!(
            parse_github_repo("https://github.com/oshun5292/tactile-code.git"),
            ok
        );
        assert_eq!(
            parse_github_repo("https://github.com/oshun5292/tactile-code"),
            ok
        );
        assert_eq!(
            parse_github_repo("https://github.com/oshun5292/tactile-code/"),
            ok
        );
        assert_eq!(
            parse_github_repo("git@github.com:oshun5292/tactile-code.git"),
            ok
        );
        assert_eq!(
            parse_github_repo("git@github.com:oshun5292/tactile-code"),
            ok
        );
        assert_eq!(
            parse_github_repo("ssh://git@github.com/oshun5292/tactile-code.git"),
            ok
        );
        assert_eq!(
            parse_github_repo("https://user:tok@github.com/oshun5292/tactile-code.git"),
            ok
        );
    }

    #[test]
    fn parse_non_github_or_invalid() {
        assert_eq!(parse_github_repo("https://gitlab.com/a/b.git"), None);
        assert_eq!(parse_github_repo("git@gitlab.com:a/b.git"), None);
        assert_eq!(parse_github_repo("https://github.com/onlyowner"), None);
        assert_eq!(parse_github_repo("https://github.com/a/b/c"), None);
        assert_eq!(parse_github_repo(""), None);
        assert_eq!(parse_github_repo("not a url"), None);
    }

    #[test]
    fn counts() {
        assert_eq!(parse_counts("2\t5"), Some((2, 5)));
        assert_eq!(parse_counts("x"), None);
    }

    fn git_ok() -> bool {
        run_git(Path::new("."), &["--version"]).is_some()
    }

    fn st(x: char, y: char) -> Option<GitFileState> {
        classify(x, y)
    }

    #[test]
    fn classify_all_kinds() {
        use GitFileState::*;
        assert_eq!(st('?', '?'), Some(Untracked));
        assert_eq!(st('!', '!'), None);
        assert_eq!(st('A', ' '), Some(Added));
        assert_eq!(st('A', 'M'), Some(Added));
        assert_eq!(st(' ', 'A'), Some(Added));
        assert_eq!(st(' ', 'D'), Some(Deleted));
        assert_eq!(st('D', ' '), Some(Deleted));
        assert_eq!(st('M', 'D'), Some(Deleted));
        assert_eq!(st('R', ' '), Some(Renamed));
        assert_eq!(st('R', 'M'), Some(Renamed));
        for (x, y) in [('U', 'U'), ('A', 'A'), ('D', 'D'), ('A', 'U'), ('D', 'U')] {
            assert_eq!(st(x, y), Some(Conflicted), "{x}{y}");
        }
        for (x, y) in [('M', ' '), (' ', 'M'), ('M', 'M'), ('T', ' ')] {
            assert_eq!(st(x, y), Some(Modified), "{x}{y}");
        }
    }

    #[test]
    fn parse_porcelain_basic_and_rename() {
        use GitFileState::*;
        let out = " M src/a.rs\0A  new file.txt\0?? 日本語/メモ.md\0R  new.rs\0old.rs\0 D gone.rs\0UU c.rs\0";
        let (files, truncated) = parse_porcelain_z(out, 100);
        assert!(!truncated);
        let got: Vec<(&str, GitFileState)> = files
            .iter()
            .map(|f| (f.rel_path.as_str(), f.state))
            .collect();
        assert_eq!(
            got,
            [
                ("src/a.rs", Modified),
                ("new file.txt", Added),
                ("日本語/メモ.md", Untracked),
                // 旧パス(old.rs)は結果に出ない
                ("new.rs", Renamed),
                ("gone.rs", Deleted),
                ("c.rs", Conflicted),
            ]
        );
    }

    #[test]
    fn parse_porcelain_rejects_unsafe_paths() {
        let out = "?? ../x\0?? /abs\0?? C:/x\0?? a/../b\0?? dir/\0?? ok.txt\0";
        let (files, _) = parse_porcelain_z(out, 100);
        let paths: Vec<&str> = files.iter().map(|f| f.rel_path.as_str()).collect();
        // 末尾の / は取り除く(入れ子のリポジトリは dir/ で出る)
        assert_eq!(paths, ["dir", "ok.txt"]);
    }

    #[test]
    fn parse_porcelain_limit_and_empty() {
        let out = "?? a\0?? b\0?? c\0";
        let (files, truncated) = parse_porcelain_z(out, 2);
        assert_eq!(files.len(), 2);
        assert!(truncated);
        let (files, truncated) = parse_porcelain_z(out, 3);
        assert_eq!(files.len(), 3);
        assert!(!truncated, "ちょうど上限なら打ち切りではない");
        assert_eq!(parse_porcelain_z("", 10), (vec![], false));
    }

    /// ユーザーのグローバル設定に依存しないで git を実行する(テスト用)。
    fn tgit(p: &Path, args: &[&str]) -> bool {
        let null = if cfg!(windows) { "NUL" } else { "/dev/null" };
        Command::new("git")
            .arg("-C")
            .arg(p)
            .args([
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@example.com",
                "-c",
                "commit.gpgsign=false",
                "-c",
                "core.autocrlf=false",
            ])
            .args(args)
            .env("GIT_CONFIG_GLOBAL", null)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    fn state_of(st: &GitStatus, rel: &str) -> Option<GitFileState> {
        st.files.iter().find(|f| f.rel_path == rel).map(|f| f.state)
    }

    #[test]
    fn git_status_in_temp_repo() {
        if !git_ok() {
            eprintln!("git が無いのでスキップ");
            return;
        }
        use GitFileState::*;
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        // git 管理外
        let none = get_git_status(p);
        assert!(!none.is_repo && none.files.is_empty() && !none.truncated);

        assert!(tgit(p, &["init", "-q", "-b", "main"]));
        for f in ["keep.txt", "edit.txt", "gone.txt", "old name.txt"] {
            std::fs::write(p.join(f), "line one\nline two\nline three\n").unwrap();
        }
        assert!(tgit(p, &["add", "."]));
        assert!(tgit(p, &["commit", "-q", "-m", "init"]));
        // クリーンな状態
        let clean = get_git_status(p);
        assert!(clean.is_repo && clean.files.is_empty());

        std::fs::write(p.join("edit.txt"), "changed\n").unwrap();
        std::fs::remove_file(p.join("gone.txt")).unwrap();
        std::fs::write(p.join("新規 ファイル.md"), "x").unwrap();
        std::fs::create_dir_all(p.join("日本語 dir")).unwrap();
        std::fs::write(p.join("日本語 dir/メモ.txt"), "x").unwrap();
        std::fs::write(p.join("added.txt"), "x").unwrap();
        assert!(tgit(p, &["add", "added.txt"]));
        assert!(tgit(p, &["mv", "old name.txt", "new name.txt"]));

        let s = get_git_status(p);
        assert!(s.is_repo && !s.truncated);
        assert_eq!(state_of(&s, "edit.txt"), Some(Modified));
        assert_eq!(state_of(&s, "gone.txt"), Some(Deleted));
        assert_eq!(state_of(&s, "新規 ファイル.md"), Some(Untracked));
        assert_eq!(state_of(&s, "日本語 dir/メモ.txt"), Some(Untracked));
        assert_eq!(state_of(&s, "added.txt"), Some(Added));
        assert_eq!(state_of(&s, "new name.txt"), Some(Renamed));
        assert_eq!(state_of(&s, "old name.txt"), None);
        assert_eq!(state_of(&s, "keep.txt"), None);
    }

    #[test]
    fn git_status_conflict_in_temp_repo() {
        if !git_ok() {
            eprintln!("git が無いのでスキップ");
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        assert!(tgit(p, &["init", "-q", "-b", "main"]));
        std::fs::write(p.join("c.txt"), "base\n").unwrap();
        assert!(tgit(p, &["add", "."]));
        assert!(tgit(p, &["commit", "-q", "-m", "base"]));
        assert!(tgit(p, &["checkout", "-q", "-b", "side"]));
        std::fs::write(p.join("c.txt"), "side\n").unwrap();
        assert!(tgit(p, &["commit", "-q", "-am", "side"]));
        assert!(tgit(p, &["checkout", "-q", "main"]));
        std::fs::write(p.join("c.txt"), "main\n").unwrap();
        assert!(tgit(p, &["commit", "-q", "-am", "main"]));
        // 競合するのでマージは失敗する(それが狙い)
        assert!(!tgit(p, &["merge", "side"]));
        let s = get_git_status(p);
        assert_eq!(state_of(&s, "c.txt"), Some(GitFileState::Conflicted));
    }

    #[test]
    fn git_status_ignores_parent_repo() {
        if !git_ok() {
            eprintln!("git が無いのでスキップ");
            return;
        }
        let d = tempfile::tempdir().unwrap();
        assert!(tgit(d.path(), &["init", "-q", "-b", "main"]));
        let sub = d.path().join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("a.txt"), "x").unwrap();
        // 親だけがリポジトリのとき、サブフォルダは対象外
        assert!(!get_git_status(&sub).is_repo);
    }

    #[test]
    fn git_info_in_temp_repo() {
        if !git_ok() {
            eprintln!("git が無いのでスキップ");
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        assert!(read_git_info(p).is_none(), "git管理外は None");

        let g = |args: &[&str]| run_git(p, args).is_some();
        assert!(g(&["init", "-q", "-b", "main"]));
        std::fs::write(p.join("a.txt"), "x").unwrap();
        assert!(g(&["add", "."]));
        assert!(g(&[
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@example.com",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-q",
            "-m",
            "init"
        ]));
        assert!(g(&[
            "remote",
            "add",
            "origin",
            "https://github.com/o/n.git"
        ]));

        let info = read_git_info(p).expect("git情報");
        assert_eq!(info.branch.as_deref(), Some("main"));
        assert_eq!(info.remote, Some(Remote { repo: "o/n".into() }));
        assert!(!info.has_upstream);
        assert_eq!((info.ahead, info.behind), (0, 0));
        assert!(info.last_commit_at.is_some());
    }
}
