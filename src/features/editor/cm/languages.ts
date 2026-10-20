import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { jinja } from "@codemirror/lang-jinja";
import { yaml } from "@codemirror/lang-yaml";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";

export type LanguageInfo = {
  id: string;
  /** languageColors.ts のキーと同じ表記(言語バーの色に使える) */
  label: string;
  extension?: Extension;
  /** タブ幅(py/rs/sql=4、他=2) */
  tabSize: number;
};

// 拡張子 → 言語。extension は呼ばれたときに作る(使わない言語の初期化を避ける)
type Def = { id: string; label: string; tabSize: number; make: () => Extension };

const ts = (): Extension => javascript({ typescript: true });
const tsx = (): Extension => javascript({ typescript: true, jsx: true });
const js = (): Extension => javascript();
const jsx = (): Extension => javascript({ jsx: true });

// Jinja入りSQL: dbt の {{ ref('x') }} / {% if %} を色分けするため、jinja の下地に SQL を使う。
// 失敗した場合に備え、SQL のみへ退避する。
function sqlWithJinja(): Extension {
  try {
    return jinja({ base: sql() });
  } catch {
    return sql();
  }
}

const D = {
  ts: { id: "typescript", label: "TypeScript", tabSize: 2, make: ts },
  tsx: { id: "tsx", label: "TypeScript", tabSize: 2, make: tsx },
  js: { id: "javascript", label: "JavaScript", tabSize: 2, make: js },
  jsx: { id: "jsx", label: "JavaScript", tabSize: 2, make: jsx },
  py: { id: "python", label: "Python", tabSize: 4, make: () => python() },
  sql: { id: "sql", label: "SQL", tabSize: 4, make: sqlWithJinja },
  yaml: { id: "yaml", label: "YAML", tabSize: 2, make: () => yaml() },
  json: { id: "json", label: "JSON", tabSize: 2, make: () => json() },
  css: { id: "css", label: "CSS", tabSize: 2, make: () => css() },
  html: { id: "html", label: "HTML", tabSize: 2, make: () => html() },
  md: { id: "markdown", label: "Markdown", tabSize: 2, make: () => markdown() },
  rs: { id: "rust", label: "Rust", tabSize: 4, make: () => rust() },
  sh: { id: "shell", label: "Shell", tabSize: 2, make: () => StreamLanguage.define(shell) },
  toml: { id: "toml", label: "TOML", tabSize: 2, make: () => StreamLanguage.define(toml) },
} satisfies Record<string, Def>;

const BY_EXT: Record<string, Def> = {
  ts: D.ts, mts: D.ts, cts: D.ts, tsx: D.tsx,
  js: D.js, mjs: D.js, cjs: D.js, jsx: D.jsx,
  py: D.py, pyi: D.py,
  sql: D.sql,
  yaml: D.yaml, yml: D.yaml,
  json: D.json, jsonc: D.json,
  css: D.css,
  html: D.html, htm: D.html,
  md: D.md, mdx: D.md, markdown: D.md,
  rs: D.rs,
  sh: D.sh, bash: D.sh, zsh: D.sh,
  toml: D.toml,
};

// 拡張子のないファイル名
const BY_NAME: Record<string, Def> = {
  dockerfile: D.sh,
  ".bashrc": D.sh,
  ".zshrc": D.sh,
  ".gitignore": D.sh,
  ".env": D.sh,
};

const PLAIN = { id: "plaintext", label: "その他", tabSize: 2 };

/** ファイル名(パスでも可)から言語を決める。純粋関数(同じ入力なら同じ種類を返す)。 */
export function languageForFilename(name: string): LanguageInfo {
  const base = (name.split(/[\/]/).pop() ?? "").toLowerCase();
  const byName = BY_NAME[base];
  if (byName) return toInfo(byName);
  const dot = base.lastIndexOf(".");
  // 先頭だけがドットのファイル(.gitignore 等)は拡張子なし扱い。.d.ts は最後の ".ts" で TypeScript になる
  if (dot > 0) {
    const def = BY_EXT[base.slice(dot + 1)];
    if (def) return toInfo(def);
  }
  return { ...PLAIN };
}

function toInfo(d: Def): LanguageInfo {
  return {
    id: d.id,
    label: d.label,
    tabSize: d.tabSize,
    get extension() {
      return d.make();
    },
  };
}
