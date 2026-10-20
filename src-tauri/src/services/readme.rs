//! README から説明文(見出し以外の最初の1行)を取り出す。
use std::path::Path;

const MAX_CHARS: usize = 120;

pub fn extract_description(root: &Path) -> Option<String> {
    let entries = std::fs::read_dir(root).ok()?;
    let readme = entries.flatten().find(|e| {
        let n = e.file_name().to_string_lossy().to_lowercase();
        n == "readme.md" || n == "readme" || n == "readme.txt" || n == "readme.markdown"
    })?;
    let text = std::fs::read_to_string(readme.path()).ok()?;
    first_text_line(&text)
}

pub fn first_text_line(text: &str) -> Option<String> {
    let mut in_fence = false;
    for line in text.lines() {
        let t = line.trim().trim_start_matches('\u{feff}');
        if t.starts_with("```") || t.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        let skip = in_fence
            || t.is_empty()
            || t.starts_with('#')
            || t.starts_with("![")
            || t.starts_with("[![")
            || t.starts_with('<')
            || t.starts_with("---")
            || t.starts_with("===")
            || t.starts_with('|');
        if skip {
            continue;
        }
        let t = t.trim_start_matches('>').trim();
        if t.is_empty() {
            continue;
        }
        return Some(t.chars().take(MAX_CHARS).collect());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_headings_and_badges() {
        let md = "# Title\n\n[![CI](x)](y)\n\n日本語の説明です。\n次の行";
        assert_eq!(first_text_line(md).as_deref(), Some("日本語の説明です。"));
        assert_eq!(first_text_line("# only\n"), None);
    }
}
