// エディタ画面の純粋な処理(副作用なし)。ストアや画面から切り離して、Vitest で確認する。
import type { Eol, FileContent, FsEntry } from "../../api/types";
import { languageForFilename } from "./cm/languages";

// ---------- パス ----------

/** 親フォルダ。ルート直下なら ""(ルート)。 */
export function parentPath(relPath: string): string {
  const i = relPath.lastIndexOf("/");
  return i === -1 ? "" : relPath.slice(0, i);
}

/** 祖先フォルダを浅い順に。"a/b/c.ts" → ["a", "a/b"]。 */
export function ancestorsOf(relPath: string): string[] {
  const parts = relPath.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

export function baseName(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf("/") + 1);
}

/** 拡張子(小文字、ドットなし)。無ければ ""。".gitignore" のような先頭だけのドットは拡張子ではない。 */
export function extensionOf(name: string): string {
  const base = baseName(name);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export const isMarkdownFile = (name: string) => ["md", "mdx"].includes(extensionOf(name));

// ---------- アイコン ----------

const ABBR: Record<string, string> = {
  TypeScript: "TS",
  JavaScript: "JS",
  Python: "PY",
  SQL: "SQ",
  YAML: "YM",
  JSON: "{}",
  CSS: "CS",
  HTML: "HT",
  Markdown: "MD",
  Rust: "RS",
  Shell: "SH",
  TOML: "TM",
};

/** ファイル名 → ツリーのアイコン(2文字の略称と、languageColors.ts の言語名)。 */
export function iconForFile(name: string): { abbr: string; language: string } {
  const language = languageForFilename(name).label;
  return { abbr: ABBR[language] ?? "·", language };
}

// ---------- 表示用 ----------

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 開けないファイルの理由(日本語)。 */
export function unopenableReason(file: Pick<FileContent, "kind" | "size">): string {
  switch (file.kind) {
    case "binary":
      return "文字ではないデータ(画像や実行ファイルなど)なので、エディタでは表示できません。";
    case "tooLarge":
      return `ファイルが大きすぎます(${formatBytes(file.size)}。開けるのは 2 MB までです)。`;
    case "unsupportedEncoding":
      return "UTF-8 以外の文字コードです。今のバージョンでは対応していません。";
    default:
      return "";
  }
}

// ---------- タブ ----------

export type MdMode = "edit" | "split" | "preview";
export type SaveState = "idle" | "saving" | "saved" | "failed";

export type Tab = {
  relPath: string;
  status: "loading" | "ready" | "error";
  error: string | null;
  kind: FileContent["kind"] | null;
  size: number;
  /** 最後に読んだ/保存した内容(未保存かどうかの基準)。text 以外は null */
  baseline: string | null;
  /** 編集中の内容。text 以外は null */
  draft: string | null;
  /** 読んだ/保存したときの更新日時(保存時の競合検出に使う) */
  modified: string | null;
  eol: Eol;
  hasBom: boolean;
  save: SaveState;
  saveError: string | null;
  mdMode: MdMode;
};

export function newTab(relPath: string, mdMode: MdMode = "split"): Tab {
  return {
    relPath,
    status: "loading",
    error: null,
    kind: null,
    size: 0,
    baseline: null,
    draft: null,
    modified: null,
    eol: "lf",
    hasBom: false,
    save: "idle",
    saveError: null,
    mdMode,
  };
}

/** 読み込み結果をタブに反映する(再読み込みでも使う。編集内容は破棄される)。 */
export function applyLoaded(tab: Tab, f: FileContent): Tab {
  return {
    ...tab,
    status: "ready",
    error: null,
    kind: f.kind,
    size: f.size,
    baseline: f.content,
    draft: f.content,
    modified: f.modified,
    eol: f.eol,
    hasBom: f.hasBom,
    save: "idle",
    saveError: null,
  };
}

export const isDirty = (t: Tab): boolean => t.draft !== null && t.draft !== t.baseline;

export type Session = {
  tabs: Tab[];
  active: string | null;
  /** 開いているフォルダの relPath */
  expanded: string[];
};

export const emptySession = (): Session => ({ tabs: [], active: null, expanded: [] });

export const dirtyTabs = (s: Session): Tab[] => s.tabs.filter(isDirty);

/** タブを開く(あれば、アクティブにするだけ)。新しいタブは右端に足す。 */
export function openTabIn(s: Session, relPath: string, mdMode: MdMode = "split"): Session {
  if (s.tabs.some((t) => t.relPath === relPath)) return { ...s, active: relPath };
  return { ...s, tabs: [...s.tabs, newTab(relPath, mdMode)], active: relPath };
}

/** タブを閉じる。アクティブなタブを閉じたら、右隣(なければ左隣)がアクティブになる。 */
export function closeTabIn(s: Session, relPath: string): Session {
  const i = s.tabs.findIndex((t) => t.relPath === relPath);
  if (i === -1) return s;
  const tabs = s.tabs.filter((t) => t.relPath !== relPath);
  let active = s.active;
  if (s.active === relPath) active = (tabs[i] ?? tabs[i - 1])?.relPath ?? null;
  return { ...s, tabs, active };
}

export function updateTab(s: Session, relPath: string, patch: Partial<Tab> | ((t: Tab) => Tab)): Session {
  return {
    ...s,
    tabs: s.tabs.map((t) => (t.relPath === relPath ? (typeof patch === "function" ? patch(t) : { ...t, ...patch }) : t)),
  };
}

/** 未保存のタブだけを捨てる(「保存せず閉じる」)。 */
export function discardDirtyTabs(s: Session): Session {
  return dirtyTabs(s).reduce((acc, t) => closeTabIn(acc, t.relPath), s);
}

/** 隣のタブ(左右キー用)。端では折り返す。 */
export function neighborTab(s: Session, delta: 1 | -1): string | null {
  if (s.tabs.length === 0) return null;
  const i = s.tabs.findIndex((t) => t.relPath === s.active);
  const next = (i + delta + s.tabs.length) % s.tabs.length;
  return s.tabs[next].relPath;
}

// ---------- ツリー ----------

export type TreeDir = { status: "loading" | "ready" | "error"; entries: FsEntry[]; error: string | null };

export function toggleExpanded(expanded: string[], relPath: string): string[] {
  return expanded.includes(relPath) ? expanded.filter((p) => p !== relPath) : [...expanded, relPath];
}

export type TreeRow =
  | { type: "entry"; entry: FsEntry; depth: number; open: boolean }
  | { type: "status"; key: string; depth: number; status: "loading" | "empty" | "error"; message: string };

/** ツリーの表示行を、上から順に平らに並べる(キーボード操作と描画の両方が使う)。 */
export function visibleRows(dirs: Record<string, TreeDir>, expanded: string[], dir = "", depth = 0): TreeRow[] {
  const d = dirs[dir];
  if (!d || d.status === "loading") {
    return [{ type: "status", key: `${dir}#loading`, depth, status: "loading", message: "読み込んでいます…" }];
  }
  if (d.status === "error") {
    return [{ type: "status", key: `${dir}#error`, depth, status: "error", message: d.error ?? "読み込めませんでした" }];
  }
  if (d.entries.length === 0) {
    return [{ type: "status", key: `${dir}#empty`, depth, status: "empty", message: "空のフォルダです" }];
  }
  const rows: TreeRow[] = [];
  for (const entry of d.entries) {
    const open = entry.kind === "dir" && expanded.includes(entry.relPath);
    rows.push({ type: "entry", entry, depth, open });
    if (open) rows.push(...visibleRows(dirs, expanded, entry.relPath, depth + 1));
  }
  return rows;
}
