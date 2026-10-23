//! プロジェクト内の文字列検索(契約書 docs/stage-n3-contract.md)。部分一致のみ(正規表現なし)。
//! ファイルの列挙は list_files と同じ(fs::walk_for_search)。除外・リンクの扱いを二重に持たない。
use crate::domain::{SearchMatch, SearchOptions, SearchResult};
use crate::services::fs::{BINARY_SNIFF, BOM, MAX_BYTES, walk_for_search};
use std::io::Read;
use std::path::Path;

/// 結果の上限(超えたら打ち切り)
const MAX_MATCHES: usize = 2_000;
const MAX_QUERY_CHARS: usize = 1_000;
const PREVIEW_CHARS: usize = 200;

/// 大文字小文字を無視するための畳み込み。1文字を必ず1文字に写す
/// (`İ` のように小文字化で複数文字になるものは先頭だけ使う)。こうすると位置が元の行とずれない。
fn fold(c: char) -> char {
    c.to_lowercase().next().unwrap_or(c)
}

/// 単語の一部とみなす文字(英数字と `_`)。日本語は含めない(分かち書きしないため、含めると単語単位が効かなくなる)。
fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

pub fn search_in_project(
    root: &Path,
    query: &str,
    opts: SearchOptions,
) -> Result<SearchResult, String> {
    search_limited(root, query, opts, MAX_MATCHES)
}

fn search_limited(
    root: &Path,
    query: &str,
    opts: SearchOptions,
    max_matches: usize,
) -> Result<SearchResult, String> {
    if query.chars().count() > MAX_QUERY_CHARS {
        return Err(format!("検索語が長すぎます({MAX_QUERY_CHARS}文字まで)"));
    }
    let mut result = SearchResult {
        matches: Vec::new(),
        truncated: false,
        files_searched: 0,
    };
    if query.is_empty() {
        return Ok(result);
    }
    let needle: Vec<char> = if opts.case_sensitive {
        query.chars().collect()
    } else {
        query.chars().map(fold).collect()
    };
    let (canon_root, list) = walk_for_search(root)?;
    for rel in &list.rel_paths {
        let Some(text) = read_searchable(&canon_root.join(rel)) else {
            continue; // 大きすぎる・バイナリ・UTF-8 でない・読めない → 飛ばす(数えない)
        };
        result.files_searched += 1;
        if search_text(rel, &text, &needle, opts, max_matches, &mut result.matches) {
            result.truncated = true;
            break;
        }
    }
    Ok(result)
}

/// 検索できるテキストだけを返す(2MB 以下・NUL なし・UTF-8)。BOM は読み飛ばす。
fn read_searchable(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    if file.metadata().ok()?.len() > MAX_BYTES {
        return None;
    }
    let mut buf = Vec::new();
    // 読む間に大きくなっても、上限+1 で止める
    file.take(MAX_BYTES + 1).read_to_end(&mut buf).ok()?;
    if buf.len() as u64 > MAX_BYTES {
        return None;
    }
    let body = buf.strip_prefix(&BOM).unwrap_or(&buf);
    if body[..body.len().min(BINARY_SNIFF)].contains(&0) {
        return None;
    }
    String::from_utf8(body.to_vec()).ok()
}

/// 1ファイル分。上限を超える一致が見つかったら true(打ち切り)を返す。
fn search_text(
    rel: &str,
    text: &str,
    needle: &[char],
    opts: SearchOptions,
    max_matches: usize,
    out: &mut Vec<SearchMatch>,
) -> bool {
    for (i, raw) in text.split('\n').enumerate() {
        let line = raw.strip_suffix('\r').unwrap_or(raw); // CRLF の \r を一致・表示に混ぜない
        let chars: Vec<char> = line.chars().collect();
        if chars.len() < needle.len() {
            continue;
        }
        let folded: Vec<char>;
        let hay: &[char] = if opts.case_sensitive {
            &chars
        } else {
            folded = chars.iter().copied().map(fold).collect();
            &folded
        };
        let mut col = 0;
        while col + needle.len() <= hay.len() {
            let end = col + needle.len();
            let hit = hay[col..end] == *needle
                && (!opts.whole_word
                    || (!(col > 0 && is_word(chars[col - 1]))
                        && !(end < chars.len() && is_word(chars[end]))));
            if !hit {
                col += 1;
                continue;
            }
            if out.len() >= max_matches {
                return true;
            }
            let (preview, start) = make_preview(&chars, col, needle.len());
            out.push(SearchMatch {
                rel_path: rel.to_string(),
                line: i + 1,
                column: col,
                length: needle.len(),
                preview,
                preview_column: col - start, // 強調位置をフロントが再検索せずに決められるように
            });
            col = end; // 重なる一致は数えない
        }
    }
    false
}

/// 前後の空白を除き、200文字まで。長いときは一致を含む範囲を切り出す
/// (一致が空白の中でも、一致自体は必ず含める)。
fn make_preview(chars: &[char], col: usize, len: usize) -> (String, usize) {
    let first = chars
        .iter()
        .position(|c| !c.is_whitespace())
        .unwrap_or(chars.len());
    let last = chars
        .iter()
        .rposition(|c| !c.is_whitespace())
        .map_or(0, |p| p + 1);
    let lo = first.min(col);
    let hi = last.max(col + len).min(chars.len());
    let (start, end) = if hi - lo <= PREVIEW_CHARS {
        (lo, hi)
    } else {
        // 一致を中央に寄せる。一致自体が長ければ先頭から
        let before = PREVIEW_CHARS.saturating_sub(len) / 2;
        let start = col.saturating_sub(before).max(lo);
        let end = (start + PREVIEW_CHARS).min(hi);
        // 末尾側が余ったら前へ詰める
        let start = end.saturating_sub(PREVIEW_CHARS).max(lo).min(col);
        (start, end)
    };
    (chars[start..end].iter().collect(), start)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(case_sensitive: bool, whole_word: bool) -> SearchOptions {
        SearchOptions {
            case_sensitive,
            whole_word,
        }
    }

    fn proj(files: &[(&str, &[u8])]) -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        for (rel, body) in files {
            let p = d.path().join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        }
        d
    }

    fn run(d: &tempfile::TempDir, q: &str, o: SearchOptions) -> SearchResult {
        search_in_project(d.path(), q, o).unwrap()
    }

    #[test]
    fn basic_match_positions_in_natural_order() {
        let d = proj(&[
            ("file10.txt", b"foo"),
            ("file2.txt", b"x\n  a foo foo\n"),
            ("sub/z.txt", b"nothing"),
        ]);
        let r = run(&d, "foo", opts(true, false));
        assert!(!r.truncated);
        assert_eq!(r.files_searched, 3);
        let got: Vec<_> = r
            .matches
            .iter()
            .map(|m| (m.rel_path.as_str(), m.line, m.column, m.length))
            .collect();
        // file2 < file10(自然順)、行順、同じ行は桁順
        assert_eq!(
            got,
            [
                ("file2.txt", 2, 4, 3),
                ("file2.txt", 2, 8, 3),
                ("file10.txt", 1, 0, 3)
            ]
        );
        // プレビューは前後の空白なし、column は元の行基準
        assert_eq!(r.matches[0].preview, "a foo foo");
    }

    #[test]
    fn case_sensitivity() {
        let d = proj(&[("a.txt", b"Foo FOO foo")]);
        assert_eq!(run(&d, "foo", opts(true, false)).matches.len(), 1);
        let r = run(&d, "foo", opts(false, false));
        assert_eq!(
            r.matches.iter().map(|m| m.column).collect::<Vec<_>>(),
            [0, 4, 8]
        );
    }

    #[test]
    fn whole_word() {
        let d = proj(&[("a.txt", b"foo foobar _foo foo_ (foo) foo")]);
        let r = run(&d, "foo", opts(true, true));
        assert_eq!(
            r.matches.iter().map(|m| m.column).collect::<Vec<_>>(),
            [0, 22, 27]
        );
        // 日本語は単語の一部とみなさない(文中の語でも単語単位で見つかる)
        let d = proj(&[("j.txt", "これはテストです".as_bytes())]);
        assert_eq!(run(&d, "テスト", opts(true, true)).matches.len(), 1);
    }

    #[test]
    fn japanese_and_unicode_columns() {
        let d = proj(&[("m.md", "😀あいう ＡＢＣ abc\n".as_bytes())]);
        let r = run(&d, "いう", opts(true, false));
        // 桁は UTF-16 でなく文字数(絵文字も1文字)
        assert_eq!((r.matches[0].column, r.matches[0].length), (2, 2));
        // 全角英字の大小無視、半角英字の大小無視
        let r = run(&d, "ａｂｃ", opts(false, false));
        assert_eq!((r.matches[0].column, r.matches[0].length), (5, 3));
        assert_eq!(run(&d, "ABC", opts(false, false)).matches[0].column, 9);
    }

    #[test]
    fn folding_keeps_columns_aligned() {
        // İ(U+0130)は小文字化で2文字になるが、位置はずらさない
        let d = proj(&[("a.txt", "İx foo".as_bytes())]);
        let r = run(&d, "FOO", opts(false, false));
        assert_eq!(r.matches[0].column, 3);
    }

    #[test]
    fn exclusions_and_skips() {
        let big = vec![b'a'; (MAX_BYTES + 1) as usize];
        let d = proj(&[
            ("ok.txt", b"needle"),
            ("node_modules/a.js", b"needle"),
            ("target/a.rs", b"needle"),
            (".git/config", b"needle"),
            (".hidden/h.txt", b"needle"),
            ("bin.dat", b"needle\0needle"),
            ("big.txt", &big),
            (
                "sjis.txt",
                &[0x82, 0xa0, b'n', b'e', b'e', b'd', b'l', b'e'],
            ),
        ]);
        std::fs::write(d.path().join(".gitignore"), "ignored/\n").unwrap();
        std::fs::create_dir_all(d.path().join("ignored")).unwrap();
        std::fs::write(d.path().join("ignored/i.txt"), "needle").unwrap();
        let r = run(&d, "needle", opts(true, false));
        let files: Vec<_> = r.matches.iter().map(|m| m.rel_path.as_str()).collect();
        // 隠しファイルは対象。除外・バイナリ・巨大・UTF-8でないものは飛ばす
        assert_eq!(files, [".hidden/h.txt", "ok.txt"]);
        // 数えるのは読めたもの(.gitignore・.hidden/h.txt・ok.txt)
        assert_eq!(r.files_searched, 3);
    }

    #[test]
    fn bom_and_crlf() {
        let d = proj(&[("a.txt", b"\xEF\xBB\xBFfoo\r\nbar foo\r\n\r\nfoo")]);
        let r = run(&d, "foo", opts(true, false));
        let got: Vec<_> = r.matches.iter().map(|m| (m.line, m.column)).collect();
        // BOM で桁がずれない・\r がプレビューに混ざらない・空行も行数に数える
        assert_eq!(got, [(1, 0), (2, 4), (4, 0)]);
        assert_eq!(r.matches[1].preview, "bar foo");
        // 行末の \r には一致しない
        assert!(run(&d, "foo\r", opts(true, false)).matches.is_empty());
    }

    #[test]
    fn empty_and_too_long_query() {
        let d = proj(&[("a.txt", b"x")]);
        let r = run(&d, "", opts(true, false));
        assert!(r.matches.is_empty() && !r.truncated && r.files_searched == 0);
        assert!(search_in_project(d.path(), &"a".repeat(1000), opts(true, false)).is_ok());
        assert!(search_in_project(d.path(), &"a".repeat(1001), opts(true, false)).is_err());
        assert!(search_in_project(&d.path().join("nope"), "x", opts(true, false)).is_err());
    }

    #[test]
    fn truncates_at_limit() {
        let d = proj(&[("a.txt", b"x\nx\nx\nx\nx\n"), ("b.txt", b"x\n")]);
        let r = search_limited(d.path(), "x", opts(true, false), 3).unwrap();
        assert_eq!(r.matches.len(), 3);
        assert!(r.truncated);
        // ちょうど上限なら打ち切りではない
        let d = proj(&[("a.txt", b"x\nx\nx\n")]);
        let r = search_limited(d.path(), "x", opts(true, false), 3).unwrap();
        assert_eq!(r.matches.len(), 3);
        assert!(!r.truncated);
    }

    #[test]
    fn matches_do_not_overlap() {
        let d = proj(&[("a.txt", b"aaaa")]);
        let r = run(&d, "aa", opts(true, false));
        assert_eq!(
            r.matches.iter().map(|m| m.column).collect::<Vec<_>>(),
            [0, 2]
        );
    }

    #[test]
    fn preview_column_points_at_match_inside_preview() {
        let d = proj(&[("a.txt", b"   x foo bar")]);
        let m = &run(&d, "foo", opts(true, false)).matches[0];
        let at: String = m
            .preview
            .chars()
            .skip(m.preview_column)
            .take(m.length)
            .collect();
        assert_eq!(at, "foo");
        let long = format!("{}NEEDLE{}", "あ".repeat(300), "い".repeat(300));
        let d = proj(&[("b.txt", long.as_bytes())]);
        let m = &run(&d, "NEEDLE", opts(true, false)).matches[0];
        let at: String = m
            .preview
            .chars()
            .skip(m.preview_column)
            .take(m.length)
            .collect();
        assert_eq!(at, "NEEDLE");
    }

    #[test]
    fn long_line_preview_contains_match() {
        let line = format!("{}NEEDLE{}", "a".repeat(500), "b".repeat(500));
        let d = proj(&[("a.txt", line.as_bytes())]);
        let r = run(&d, "NEEDLE", opts(true, false));
        let m = &r.matches[0];
        assert_eq!(m.column, 500); // 元の行基準のまま
        assert_eq!(m.preview.chars().count(), PREVIEW_CHARS);
        assert!(m.preview.contains("NEEDLE"));
        // 行頭付近・行末付近でも200文字で、一致を含む
        for text in [
            format!("NEEDLE{}", "b".repeat(500)),
            format!("{}NEEDLE", "a".repeat(500)),
        ] {
            let d = proj(&[("a.txt", text.as_bytes())]);
            let m = &run(&d, "NEEDLE", opts(true, false)).matches[0];
            assert_eq!(m.preview.chars().count(), PREVIEW_CHARS);
            assert!(m.preview.contains("NEEDLE"));
        }
        // 一致が空白だけでも、プレビューに含まれる
        let d = proj(&[("s.txt", b"a   b")]);
        assert_eq!(
            run(&d, "   ", opts(true, false)).matches[0].preview,
            "a   b"
        );
    }
}
