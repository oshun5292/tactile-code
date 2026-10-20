//! git 情報の取得(契約書 §6)。PR や CI は段階1では扱わない。
use crate::domain::{GitInfo, Remote};
use std::path::Path;
use std::process::{Command, Stdio};

fn run_git(path: &Path, args: &[&str]) -> Option<String> {
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
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
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
