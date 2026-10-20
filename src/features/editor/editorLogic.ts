// エディタ画面の純粋な処理(副作用なし)。ストアや画面から切り離して、Vitest で確認する。
import { ENCODINGS, type EditorSessionData, type EncodingName, type Eol, type FileContent, type FileStat, type FsEntry, type SessionTab } from "../../api/types";
import { languageForFilename } from "./cm/languages";
import type { IndentSetting } from "./statusBarLogic";

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
      return "文字コードを判別できません。「エンコード付きで再度開く」で、文字コードを指定して開き直せます。";
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
  /** 読んだ/保存したときの改行コード。eol との差が「未保存」(本文が同じでも改行だけ変えて保存できるように) */
  baseEol: Eol;
  hasBom: boolean;
  /** 判定した(または指定した)文字コード。保存時にそのまま渡す */
  encoding: EncodingName;
  save: SaveState;
  saveError: string | null;
  mdMode: MdMode;
  /** 外部の変更の印。reloaded=自動で読み直した(短く表示)、changed=未保存があるので読み直していない、deleted=ファイルが消えた */
  external: ExternalMark | null;
  /** 状態バーで手動指定したインデント(このタブだけの一時設定。保存しない)。null=自動 */
  indent: IndentSetting | null;
};

export type ExternalMark = "reloaded" | "changed" | "deleted";

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
    baseEol: "lf",
    hasBom: false,
    encoding: "utf-8",
    save: "idle",
    saveError: null,
    mdMode,
    external: null,
    indent: null,
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
    baseEol: f.eol,
    hasBom: f.hasBom,
    // text 以外のとき encoding は意味を持たないので、前の値を引きずらず既定に戻す
    encoding: f.kind === "text" ? f.encoding : "utf-8",
    save: "idle",
    saveError: null,
    external: null,
  };
}

export const isDirty = (t: Tab): boolean => t.draft !== null && (t.draft !== t.baseline || t.eol !== t.baseEol);

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

export type CloseMode = "self" | "others" | "right" | "all";

/** 閉じるメニューの対象(並び順)。右クリックしたタブ anchor を基準にする。anchor が無ければ空。 */
export function tabsToClose(s: Session, anchor: string, mode: CloseMode): string[] {
  const i = s.tabs.findIndex((t) => t.relPath === anchor);
  if (i === -1) return [];
  const all = s.tabs.map((t) => t.relPath);
  switch (mode) {
    case "self":
      return [anchor];
    case "others":
      return all.filter((p) => p !== anchor);
    case "right":
      return all.slice(i + 1);
    case "all":
      return all;
  }
}

/**
 * 複数のタブをまとめて閉じる。アクティブが閉じられたら、元の位置に最も近い残りのタブ(右優先)がアクティブになる。
 * 1件ずつ closeTabIn を重ねると、途中のアクティブ移動が無駄になるため一度に計算する。
 */
export function closeTabsIn(s: Session, relPaths: readonly string[]): Session {
  const gone = new Set(relPaths);
  if (!s.tabs.some((t) => gone.has(t.relPath))) return s;
  const tabs = s.tabs.filter((t) => !gone.has(t.relPath));
  let active = s.active;
  if (active !== null && gone.has(active)) {
    const i = s.tabs.findIndex((t) => t.relPath === active);
    active = (s.tabs.slice(i + 1).find((t) => !gone.has(t.relPath)) ?? [...s.tabs.slice(0, i)].reverse().find((t) => !gone.has(t.relPath)))?.relPath ?? null;
  }
  return { ...s, tabs, active };
}

/**
 * タブを並べ替える。insertIndex は「移動前の並びで、何番目の隙間に入れるか」(0..tabs.length)。
 * 自分の直前・直後の隙間は動かないので、同じ Session を返す(無駄な保存を避ける)。
 */
export function moveTabIn(s: Session, relPath: string, insertIndex: number): Session {
  const from = s.tabs.findIndex((t) => t.relPath === relPath);
  if (from === -1) return s;
  const at = Math.max(0, Math.min(insertIndex, s.tabs.length));
  if (at === from || at === from + 1) return s;
  const tabs = [...s.tabs];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(at > from ? at - 1 : at, 0, moved);
  return { ...s, tabs };
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

// ---------- 外部変更の検知 ----------

export type ExternalAction = "none" | "reload" | "mark-changed" | "mark-deleted" | "clear";

/** 1件の stat 結果から、タブをどうするかを決める。読み込み中・失敗のタブは対象外。 */
export function judgeExternal(tab: Tab, stat: FileStat): ExternalAction {
  if (tab.status !== "ready" || tab.modified === null) return "none";
  if (!stat.exists) return "mark-deleted";
  if (stat.modified === null) return "none";
  if (stat.modified === tab.modified) return tab.external === "deleted" ? "clear" : "none";
  // 未保存の編集は勝手に上書きしない(保存時の競合ダイアログに任せる)
  return isDirty(tab) ? "mark-changed" : "reload";
}

/** statFiles に渡す対象。保存中のタブは、保存で modified が変わる途中なので除く。1回200件まで。 */
export function pollTargets(s: Session, max = 200): { relPath: string; modified: string | null }[] {
  return s.tabs
    .filter((t) => t.status === "ready" && t.save !== "saving")
    .slice(0, max)
    .map((t) => ({ relPath: t.relPath, modified: t.modified }));
}

// ---------- タブの復元 ----------

const TO_SAVED_MODE: Record<MdMode, SessionTab["mdMode"]> = { edit: "write", split: "split", preview: "read" };
const FROM_SAVED_MODE: Record<SessionTab["mdMode"], MdMode> = { write: "edit", split: "split", read: "preview" };

export const SESSION_LIMITS = { tabs: 200, expanded: 500 } as const;

/** 保存するデータを組み立てる(本文は入れない。パスと表示モードだけ)。 */
export function buildSessionData(s: Session): EditorSessionData {
  return {
    tabs: s.tabs.slice(0, SESSION_LIMITS.tabs).map((t) => ({ relPath: t.relPath, mdMode: TO_SAVED_MODE[t.mdMode] })),
    active: s.active,
    expanded: s.expanded.slice(0, SESSION_LIMITS.expanded),
  };
}

export type RestorePlan = { tabs: { relPath: string; mdMode: MdMode }[]; active: string | null; expanded: string[] };

/** 保存データと stat 結果から、復元するタブを決める。存在しないファイルは捨てる。 */
export function planRestore(data: EditorSessionData | null, stats: FileStat[]): RestorePlan {
  if (!data) return { tabs: [], active: null, expanded: [] };
  const alive = new Set(stats.filter((s) => s.exists).map((s) => s.relPath));
  const seen = new Set<string>();
  const tabs: RestorePlan["tabs"] = [];
  for (const t of data.tabs) {
    if (!alive.has(t.relPath) || seen.has(t.relPath)) continue;
    seen.add(t.relPath);
    tabs.push({ relPath: t.relPath, mdMode: FROM_SAVED_MODE[t.mdMode] ?? "split" });
  }
  const active = data.active && seen.has(data.active) ? data.active : (tabs[tabs.length - 1]?.relPath ?? null);
  return { tabs, active, expanded: [...new Set(data.expanded)] };
}

// ---------- 文字コード(3b-3) ----------

/** 画面に出す名前(大文字)。 */
export const encodingLabel = (e: EncodingName): string => e.toUpperCase();

export type EncodingChoice = { encoding: EncodingName; label: string; current: boolean };

/** メニューに並べる文字コード一覧。現在のものに印を付ける(current が null なら印なし)。 */
export function encodingChoices(current: EncodingName | null): EncodingChoice[] {
  return ENCODINGS.map((encoding) => ({ encoding, label: encodingLabel(encoding), current: encoding === current }));
}

const isUtf16 = (e: EncodingName) => e === "utf-16le" || e === "utf-16be";

/** 「エンコード付きで再度開く」が使えるか。本文が開けているタブと、文字コード不明のタブ。 */
export const canReopenWithEncoding = (t: Tab): boolean =>
  t.status === "ready" && (t.kind === "text" || t.kind === "unsupportedEncoding");

/** 「エンコード付きで保存」が使えるか。本文を持つタブだけ。 */
export const canSaveWithEncoding = (t: Tab): boolean => t.status === "ready" && t.kind === "text" && t.draft !== null && t.save !== "saving";

/**
 * 文字コードを変えて保存するときの BOM。UTF-16 は BOM 無しを許さないので true、
 * UTF-16 から別の文字コードへ移るときは BOM を持ち越さず false、それ以外は今のまま。
 */
export function bomForEncoding(from: EncodingName, to: EncodingName, hasBom: boolean): boolean {
  if (isUtf16(to)) return true;
  if (isUtf16(from)) return false;
  return hasBom;
}

/** 保存して文字コードを変える必要があるか(内容が同じでも、文字コードが違えば書き直す)。 */
export const needsWriteForEncoding = (t: Tab, encoding: EncodingName): boolean => t.encoding !== encoding;

// ---------- ファイル操作(3b-2) ----------

export const joinPath = (parent: string, name: string): string => (parent ? `${parent}/${name}` : name);

/** p が dir 自身、または dir の配下か。dir が "" (ルート)なら常に true。 */
export const isSameOrInside = (p: string, dir: string): boolean => dir === "" || p === dir || p.startsWith(`${dir}/`);

/** 名前変更・移動で、パス p がどこへ移るか。from の配下でなければそのまま。 */
export function remapPath(p: string, from: string, to: string): string {
  if (p === from) return to;
  return p.startsWith(`${from}/`) ? to + p.slice(from.length) : p;
}

// Windows で使えない文字と予約名。フロントで先に弾いて、すぐ理由を見せる(最終判断は Rust 側)。
const BAD_CHARS = /[\/:*?"<>|\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * 新しい名前の検査。問題があれば理由(日本語)、なければ null。
 * siblings は同じフォルダの既存の名前(自分自身の元の名前は除いて渡す)。大文字小文字は区別せず重複とみなす。
 */
export function validateEntryName(name: string, siblings: string[] = []): string | null {
  if (name.trim() === "") return "名前を入力してください。";
  if (name === "." || name === "..") return "「.」「..」は名前にできません。";
  if (name.includes("/") || name.includes("\\")) return "名前に「/」「\」は使えません(フォルダの中に作るには、先にそのフォルダを選んでください)。";
  if (BAD_CHARS.test(name)) return "名前に使えない文字があります(: * ? \" < > | など)。";
  if (/[. ]$/.test(name)) return "名前の末尾に「.」や空白は付けられません。";
  if (RESERVED.test(name)) return "Windows の予約された名前なので使えません。";
  const lower = name.toLowerCase();
  if (siblings.some((s) => s.toLowerCase() === lower)) return "同じ名前がすでにあります。";
  return null;
}

/** 新規作成の置き場所。選択中がフォルダならその中、ファイルならその親、何もなければルート。 */
export function creationParent(selected: Pick<FsEntry, "relPath" | "kind"> | null): string {
  if (!selected) return "";
  return selected.kind === "dir" ? selected.relPath : parentPath(selected.relPath);
}

/** 絶対パス。プロジェクトのパスが使う区切り(Windows なら \)に合わせる。 */
export function absolutePathOf(projectPath: string, relPath: string): string {
  if (!relPath) return projectPath;
  const sep = projectPath.includes("\\") ? "\\" : "/";
  return projectPath.replace(/[\/]+$/, "") + sep + relPath.split("/").join(sep);
}

/** 名前変更・移動を、タブ・アクティブ・展開状態へ反映する。未保存の編集内容(draft)はそのまま保つ。 */
export function renameInSession(s: Session, from: string, to: string): Session {
  const seen = new Set<string>();
  const tabs: Tab[] = [];
  for (const t of s.tabs) {
    const relPath = remapPath(t.relPath, from, to);
    if (seen.has(relPath)) continue;
    seen.add(relPath);
    tabs.push(relPath === t.relPath ? t : { ...t, relPath });
  }
  return {
    tabs,
    active: s.active === null ? null : remapPath(s.active, from, to),
    expanded: [...new Set(s.expanded.map((p) => remapPath(p, from, to)))],
  };
}

/** relPath(ファイルまたはフォルダ)に含まれるタブ。 */
export const tabsUnder = (s: Session, relPath: string): Tab[] => s.tabs.filter((t) => isSameOrInside(t.relPath, relPath));

/** 削除を反映する。該当タブをすべて閉じ、展開状態からも外す(未保存の確認は呼び出し側で済ませる)。 */
export function removeFromSession(s: Session, relPath: string): Session {
  const closed = tabsUnder(s, relPath).reduce((acc, t) => closeTabIn(acc, t.relPath), s);
  return { ...closed, expanded: closed.expanded.filter((p) => !isSameOrInside(p, relPath)) };
}

/** フォルダ一覧のキャッシュを、名前変更に合わせて付け替える(読み直すまでの間、ちらつかせない)。 */
export function remapDirsCache(dirs: Record<string, TreeDir>, from: string, to: string): Record<string, TreeDir> {
  const out: Record<string, TreeDir> = {};
  for (const [key, d] of Object.entries(dirs)) {
    out[remapPath(key, from, to)] = {
      ...d,
      entries: d.entries.map((e) => {
        const relPath = remapPath(e.relPath, from, to);
        return relPath === e.relPath ? e : { ...e, relPath, name: e.relPath === from ? baseName(to) : e.name };
      }),
    };
  }
  // 別のフォルダへ移動したときは、元の親から外して新しい親へ入れる。
  // 外さないと、読み直しまでの間、同じパスの行が2つ並び、React の key が重複して古い行が残ってしまう
  const oldParent = parentPath(from);
  const newParent = parentPath(to);
  if (oldParent !== newParent) {
    const moved = out[oldParent]?.entries.find((e) => e.relPath === to);
    if (out[oldParent]) out[oldParent] = { ...out[oldParent], entries: out[oldParent].entries.filter((e) => e.relPath !== to) };
    const dest = out[newParent];
    if (moved && dest && !dest.entries.some((e) => e.relPath === to)) out[newParent] = { ...dest, entries: [...dest.entries, moved] };
  }
  return out;
}

/** フォルダ一覧のキャッシュから、削除したパスの配下を捨てる。 */
export function dropFromDirsCache(dirs: Record<string, TreeDir>, relPath: string): Record<string, TreeDir> {
  const out: Record<string, TreeDir> = {};
  for (const [key, d] of Object.entries(dirs)) {
    if (key !== "" && isSameOrInside(key, relPath)) continue;
    out[key] = { ...d, entries: d.entries.filter((e) => !isSameOrInside(e.relPath, relPath)) };
  }
  return out;
}

// ---------- ドラッグ&ドロップ移動(N4) ----------

/** from を destDir("" ならルート)へ移したあとのパス。 */
export const movedPath = (from: string, destDir: string): string => joinPath(destDir, baseName(from));

/**
 * from を destDir へドロップできるか。自分自身・自分の子孫(フォルダを自分の中へ)・今の親(動かない)は不可。
 * from が "" (ルート)のときも不可。
 */
export function canDropInto(from: string, destDir: string): boolean {
  if (from === "") return false;
  if (isSameOrInside(destDir, from)) return false;
  return parentPath(from) !== destDir;
}

/** 移動先の一覧(entries の名前)に、同名のものがあるか。Windows に合わせて大文字小文字は区別しない。 */
export function hasSameName(entries: readonly Pick<FsEntry, "name">[], name: string): boolean {
  const lower = name.toLowerCase();
  return entries.some((e) => e.name.toLowerCase() === lower);
}
