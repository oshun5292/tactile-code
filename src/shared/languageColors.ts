// 言語 → 色の対応表はここだけに置く。実際の色の値は styles/tokens.css の CSS 変数。
export type LangColor = { bg: string; d: string };

const c = (name: string): LangColor => ({ bg: `var(--${name})`, d: `var(--${name}-d)` });

const COLORS: Record<string, LangColor> = {
  TypeScript: c("sky"),
  Python: c("mint"),
  SQL: c("lav"),
  Markdown: c("butter"),
  Rust: c("peach"),
  JavaScript: c("amber"),
  CSS: c("rose"),
  HTML: c("coral"),
  YAML: c("teal"),
  JSON: c("sand"),
  Jinja: c("lime"),
  Shell: c("slate"),
  TOML: c("clay"),
  その他: c("stone"),
};

export function languageColor(name: string | null | undefined): LangColor {
  return (name && COLORS[name]) || COLORS["その他"];
}
