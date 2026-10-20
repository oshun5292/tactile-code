// ブラウザ(Tauri の外)用のモック。メモリ上だけで追加・削除・編集が動く。
// URL に ?mock=empty / error / loading / missing を付けると、各状態を確認できる(撮影用)。
import { MAX_SEARCH_RESULTS, searchText } from "../features/editor/searchLogic";
import { duplicateName } from "../shared/duplicateName";
import { MOCK_FILES } from "./mockFiles";
import type { Api, BoardState, EditorSessionData, EditorSettings, EncodingName, Eol, FileKind, FsEntry, GitInfo, ProjectSummary, SearchMatch, Stroke } from "./types";

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const git = (g: Partial<GitInfo> & { lastCommitAt: string | null }): GitInfo => ({
  branch: "main",
  remote: null,
  ahead: 0,
  behind: 0,
  hasUpstream: true,
  ...g,
});

function sampleProjects(): ProjectSummary[] {
  return [
    {
      id: "mock-1",
      name: "todo-app",
      path: "C:\\Users\\demo\\dev\\todo-app",
      displayPath: "~/dev/todo-app",
      exists: true,
      description: "React + TypeScript の小さなタスク管理",
      note: "完了トグルを実装中。次は期限の表示",
      languages: [
        { name: "TypeScript", percent: 82 },
        { name: "CSS", percent: 11 },
        { name: "HTML", percent: 7 },
      ],
      mainLanguage: "TypeScript",
      git: git({ branch: "feat/toggle-done", remote: { repo: "ashun/todo-app" }, ahead: 2, lastCommitAt: daysAgo(2) }),
      lastUpdated: daysAgo(2),
      position: { x: 0, y: 0 },
    },
    {
      id: "mock-2",
      name: "sales-analysis",
      path: "C:\\Users\\demo\\dev\\sales-analysis",
      displayPath: "~/dev/sales-analysis",
      exists: true,
      description: "月別の売上推移と前年比を出す",
      note: "前年比で欠けている月を確認中",
      languages: [
        { name: "Python", percent: 91 },
        { name: "SQL", percent: 9 },
      ],
      mainLanguage: "Python",
      git: git({ remote: { repo: "ashun/sales-analysis" }, lastCommitAt: daysAgo(4) }),
      lastUpdated: daysAgo(4),
      position: { x: 450, y: 6 },
    },
    {
      id: "mock-3",
      name: "dbt-snowflake",
      path: "C:\\Users\\demo\\dev\\dbt-snowflake",
      displayPath: "~/dev/dbt-snowflake",
      exists: true,
      description: "staging から marts まで、モデルを整理する",
      note: "staging は完了。marts はこれから",
      languages: [
        { name: "SQL", percent: 74 },
        { name: "YAML", percent: 18 },
        { name: "Jinja", percent: 8 },
      ],
      mainLanguage: "SQL",
      git: git({ remote: { repo: "ashun/dbt-snowflake" }, behind: 1, lastCommitAt: daysAgo(8) }),
      lastUpdated: daysAgo(8),
      position: { x: 900, y: -10 },
    },
    {
      id: "mock-4",
      name: "life-plan",
      path: "C:\\Users\\demo\\notes\\life-plan",
      displayPath: "~/notes/life-plan",
      exists: true,
      description: "3年後にどうなっていたいかを、言葉にしていく",
      note: "2027年の目標を書き終えた",
      languages: [{ name: "Markdown", percent: 100 }],
      mainLanguage: "Markdown",
      git: git({ remote: { repo: "ashun/private-notes" }, lastCommitAt: daysAgo(1) }),
      lastUpdated: daysAgo(1),
      position: { x: 40, y: 340 },
    },
    {
      id: "mock-5",
      name: "memo_editor",
      path: "C:\\Users\\demo\\Documents\\00_active\\memo_editor",
      displayPath: "~/Documents/00_active/memo_editor",
      exists: true,
      description: "メモ型AIエディタ(Tauri)。いま作っているもの",
      note: "見た目を決めている最中",
      languages: [
        { name: "Rust", percent: 46 },
        { name: "TypeScript", percent: 44 },
        { name: "CSS", percent: 10 },
      ],
      mainLanguage: "Rust",
      git: git({ lastCommitAt: daysAgo(0) }),
      lastUpdated: daysAgo(0),
      position: { x: 500, y: 360 },
    },
  ];
}

// 見た目確認用の手書き(丸囲み・下線・矢印風)。座標はフロー座標で、カードの位置に合わせてある。
function ellipse(cx: number, cy: number, rx: number, ry: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 30; i++) {
    const a = -2.0 + (i / 30) * Math.PI * 2.14;
    const k = 1 + Math.sin(i * 0.9) * 0.025 + (i / 30) * 0.05;
    pts.push([Math.round(cx + Math.cos(a) * rx * k), Math.round(cy + Math.sin(a) * ry * k)]);
  }
  return pts;
}
function wave(x0: number, x1: number, y: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 10; i++) pts.push([Math.round(x0 + ((x1 - x0) * i) / 10), Math.round(y + Math.sin(i * 1.3) * 1.8)]);
  return pts;
}
function arrow(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const pts: [number, number][] = [];
  const qx = (x0 + x1) / 2 + (y1 - y0) * 0.25;
  const qy = (y0 + y1) / 2 - (x1 - x0) * 0.25;
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const u = 1 - t;
    pts.push([Math.round(u * u * x0 + 2 * u * t * qx + t * t * x1), Math.round(u * u * y0 + 2 * u * t * qy + t * t * y1)]);
  }
  const a = Math.atan2(y1 - pts[10][1], x1 - pts[10][0]);
  pts.push([Math.round(x1 - Math.cos(a - 0.5) * 14), Math.round(y1 - Math.sin(a - 0.5) * 14)]);
  pts.push([x1, y1]);
  pts.push([Math.round(x1 - Math.cos(a + 0.5) * 14), Math.round(y1 - Math.sin(a + 0.5) * 14)]);
  return pts;
}

function sampleBoard(): BoardState {
  return {
    strokes: [
      { id: "mock-s1", color: "#e2708a", width: 3, points: ellipse(560, 91, 148, 25) },
      { id: "mock-s2", color: "#5a9fe0", width: 3, points: wave(925, 1160, 206) },
      { id: "mock-s3", color: "#5fb36f", width: 3, points: arrow(930, 318, 720, 360) },
    ],
    viewport: null,
  };
}

const mode = typeof location !== "undefined" ? new URLSearchParams(location.search).get("mock") : null;
let db: ProjectSummary[] = mode === "empty" ? [] : sampleProjects();
if (mode === "missing") db[3] = { ...db[3], exists: false, git: null, lastUpdated: null };
let board: BoardState = mode === "empty" ? { strokes: [], viewport: null } : sampleBoard();
let seq = 100;

const find = (id: string) => {
  const p = db.find((x) => x.id === id);
  if (!p) throw "プロジェクトが見つかりません";
  return p;
};

// --- ファイル(メモリ上)。書き込むと modified が更新される ---
type MockFile = {
  kind: FileKind;
  content: string | null;
  size: number;
  eol: Eol;
  hasBom: boolean;
  encoding: EncodingName;
  /** 文字コード不明(unsupportedEncoding)のファイルを shift_jis で開いたときに見える本文 */
  asShiftJis?: string;
  modified: string;
};
const fsDb = new Map<string, Map<string, MockFile>>();
let conflictPending = mode === "conflict"; // ?mock=conflict のとき、最初の保存を1回だけ競合にする

function filesOf(projectId: string): Map<string, MockFile> {
  let files = fsDb.get(projectId);
  if (!files) {
    files = new Map();
    const seeds = MOCK_FILES[projectId] ?? { "README.md": { content: "# 新しいプロジェクト\n" } };
    const base = Date.now() - 3 * DAY;
    Object.entries(seeds).forEach(([path, s], i) => {
      const kind = s.kind ?? "text";
      const content = kind === "text" ? (s.content ?? "") : null;
      files!.set(path, {
        kind,
        content,
        size: content !== null ? new TextEncoder().encode(content).length : (s.size ?? 0),
        eol: s.eol ?? "lf",
        hasBom: s.hasBom ?? false,
        encoding: s.encoding ?? "utf-8",
        asShiftJis: s.asShiftJis,
        modified: new Date(base + i * 60_000).toISOString(),
      });
    });
    fsDb.set(projectId, files);
  }
  return files;
}

const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

function listMockDir(projectId: string, relPath: string): FsEntry[] {
  const prefix = relPath === "" ? "" : `${relPath}/`;
  const dirs = new Map<string, FsEntry>();
  const out: FsEntry[] = [];
  for (const [path, f] of filesOf(projectId)) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      out.push({ name: rest, relPath: path, kind: "file", size: f.size, modified: f.modified });
    } else {
      const name = rest.slice(0, slash);
      if (!dirs.has(name)) dirs.set(name, { name, relPath: prefix + name, kind: "dir", size: 0, modified: null });
    }
  }
  for (const d of dirSetOf(projectId)) {
    if (!d.startsWith(prefix)) continue;
    const name = d.slice(prefix.length).split("/")[0];
    if (name && !dirs.has(name)) dirs.set(name, { name, relPath: prefix + name, kind: "dir", size: 0, modified: null });
  }
  // フォルダが先、名前は大文字小文字を区別せず自然順
  const byName = (a: FsEntry, b: FsEntry) => collator.compare(a.name, b.name);
  return [...[...dirs.values()].sort(byName), ...out.sort(byName)];
}


// 空のフォルダや、ファイルを全部消したあとのフォルダを覚えておく(ファイルのパスだけではフォルダが消えてしまうため)
const dirDb = new Map<string, Set<string>>();
function dirSetOf(projectId: string): Set<string> {
  let d = dirDb.get(projectId);
  if (!d) {
    d = new Set();
    dirDb.set(projectId, d);
  }
  return d;
}

const lowerEq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const insideOf = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`);

/** ファイルの祖先をすべて明示フォルダにしておく(これで、中身が空になってもフォルダは残る)。 */
function materializeDirs(projectId: string) {
  const dirs = dirSetOf(projectId);
  for (const path of filesOf(projectId).keys()) {
    for (let d = parentOf(path); d; d = parentOf(d)) dirs.add(d);
  }
}

function isDir(projectId: string, relPath: string): boolean {
  if (relPath === "") return true;
  if (dirSetOf(projectId).has(relPath)) return true;
  for (const path of filesOf(projectId).keys()) if (path.startsWith(`${relPath}/`)) return true;
  return false;
}

/** 同じ場所(親)に、大文字小文字だけ違うものも含めて、すでにあるか。 */
function findExisting(projectId: string, relPath: string): string | null {
  const parent = parentOf(relPath);
  const name = relPath.slice(parent ? parent.length + 1 : 0);
  const hit = listMockDir(projectId, parent).find((e) => lowerEq(e.name, name));
  return hit ? hit.relPath : null;
}

// Rust 側の検査に合わせた、最低限の名前チェック(本番の最終判断は Rust 側)
function checkNewName(relPath: string) {
  const name = relPath.slice(relPath.lastIndexOf("/") + 1);
  if (!name || name === "." || name === ".." || /[\\:*?"<>|]/.test(name) || /[. ]$/.test(name)) throw "不正な名前です";
  if (relPath.split("/").some((seg) => seg.toLowerCase() === ".git")) throw ".git は操作できません";
}

function checkParent(projectId: string, relPath: string) {
  if (!isDir(projectId, parentOf(relPath))) throw "親フォルダが見つかりません";
}

const FS_DELAY = 80;

const sessionDb = new Map<string, EditorSessionData>();

// 動作確認用: コンソールから「外部で書き換えた/消した」状態を作る。content が null なら削除。
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__mockExternal = (projectId: string, relPath: string, content: string | null) => {
    const files = filesOf(projectId);
    if (content === null) return files.delete(relPath);
    const f = files.get(relPath);
    if (!f) return false;
    Object.assign(f, { content, size: new TextEncoder().encode(content).length, modified: new Date().toISOString() });
    return true;
  };
}

// 設定はアプリ全体で1つ(メモリのみ)。保存が無い状態は null
let settingsDb: EditorSettings | null = null;

export const mockApi: Api = {
  async createFile(projectId, relPath) {
    await sleep(FS_DELAY);
    find(projectId);
    checkNewName(relPath);
    checkParent(projectId, relPath);
    if (findExisting(projectId, relPath)) throw `既存: ${relPath}`;
    materializeDirs(projectId);
    const modified = new Date().toISOString();
    filesOf(projectId).set(relPath, { kind: "text", content: "", size: 0, eol: "lf", hasBom: false, encoding: "utf-8", modified });
    return { name: relPath.slice(relPath.lastIndexOf("/") + 1), relPath, kind: "file", size: 0, modified };
  },
  async createDir(projectId, relPath) {
    await sleep(FS_DELAY);
    find(projectId);
    checkNewName(relPath);
    checkParent(projectId, relPath);
    if (findExisting(projectId, relPath)) throw `既存: ${relPath}`;
    materializeDirs(projectId);
    dirSetOf(projectId).add(relPath);
    return { name: relPath.slice(relPath.lastIndexOf("/") + 1), relPath, kind: "dir", size: 0, modified: null };
  },
  async renameEntry(projectId, from, to) {
    await sleep(FS_DELAY);
    find(projectId);
    if (from === "") throw "プロジェクトのフォルダ自体は変更できません";
    checkNewName(to);
    if (from.split("/").includes(".git")) throw ".git は操作できません";
    const files = filesOf(projectId);
    const fromIsDir = !files.has(from) && isDir(projectId, from);
    if (!fromIsDir && !files.has(from)) throw "元のファイルが見つかりません";
    if (fromIsDir && insideOf(to, from) && to !== from) throw "フォルダを自分の中へは移せません";
    checkParent(projectId, to);
    const hit = findExisting(projectId, to);
    // 大文字小文字だけの違い(自分自身)は許す
    if (hit && !(lowerEq(hit, from) && hit === from)) throw `既存: ${to}`;
    materializeDirs(projectId);
    const dirs = dirSetOf(projectId);
    for (const [path, f] of [...files]) {
      if (!insideOf(path, from)) continue;
      files.delete(path);
      files.set(to + path.slice(from.length), f);
    }
    for (const d of [...dirs]) {
      if (!insideOf(d, from)) continue;
      dirs.delete(d);
      dirs.add(to + d.slice(from.length));
    }
    const f = files.get(to);
    return { name: to.slice(to.lastIndexOf("/") + 1), relPath: to, kind: fromIsDir ? "dir" : "file", size: f?.size ?? 0, modified: f?.modified ?? null };
  },
  async duplicateEntry(projectId, relPath) {
    await sleep(FS_DELAY);
    find(projectId);
    if (relPath === "") throw "プロジェクトのフォルダ自体は複製できません";
    if (relPath.split("/").includes(".git")) throw ".git は操作できません";
    const files = filesOf(projectId);
    const srcIsDir = !files.has(relPath) && isDir(projectId, relPath);
    if (!srcIsDir && !files.has(relPath)) throw "元のファイルが見つかりません";
    materializeDirs(projectId);
    const parent = parentOf(relPath);
    const name = relPath.slice(parent ? parent.length + 1 : 0);
    // 同じフォルダの中で最初に空いている名前にする(上書きしない)
    const newName = duplicateName(name, listMockDir(projectId, parent).map((e) => e.name));
    const to = parent ? `${parent}/${newName}` : newName;
    const dirs = dirSetOf(projectId);
    for (const [path, f] of [...files]) {
      if (insideOf(path, relPath)) files.set(to + path.slice(relPath.length), { ...f });
    }
    if (srcIsDir) {
      dirs.add(to);
      for (const d of [...dirs]) if (insideOf(d, relPath)) dirs.add(to + d.slice(relPath.length));
    }
    const f = files.get(to);
    return { name: newName, relPath: to, kind: srcIsDir ? "dir" : "file", size: f?.size ?? 0, modified: f?.modified ?? null };
  },
  async deleteEntry(projectId, relPath) {
    await sleep(FS_DELAY);
    find(projectId);
    if (relPath === "") throw "プロジェクトのフォルダ自体は削除できません";
    if (relPath.split("/").includes(".git")) throw ".git は操作できません";
    const files = filesOf(projectId);
    if (!files.has(relPath) && !isDir(projectId, relPath)) throw "見つかりません";
    materializeDirs(projectId); // 親フォルダが空になっても残す
    for (const path of [...files.keys()]) if (insideOf(path, relPath)) files.delete(path);
    const dirs = dirSetOf(projectId);
    for (const d of [...dirs]) if (insideOf(d, relPath)) dirs.delete(d);
  },
  async openInVscode(projectId, relPath) {
    await sleep(FS_DELAY);
    find(projectId);
    // ?mock=novscode のとき、見つからない場合の表示を確認できる
    if (mode === "novscode") throw "VSCode: VSCode(code コマンド)が見つかりません";
    console.info("[mock] VSCodeで開く:", relPath || "(プロジェクトのフォルダ)");
  },
  async statFiles(projectId, relPaths) {
    find(projectId);
    const files = filesOf(projectId);
    return relPaths.slice(0, 200).map((relPath) => {
      const f = files.get(relPath);
      return { relPath, exists: !!f, modified: f ? f.modified : null };
    });
  },
  async getSettings() {
    return settingsDb ? { ...settingsDb } : null;
  },
  async saveSettings(settings) {
    // 本物(Rust側)と同じく範囲外は丸める。不正な autoSave はエラー
    if (!["off", "afterDelay", "onFocusChange"].includes(settings.autoSave)) throw "自動保存の指定が正しくありません";
    const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));
    settingsDb = {
      ...settings,
      fontSize: clamp(settings.fontSize, 10, 28),
      autoSaveDelayMs: clamp(settings.autoSaveDelayMs, 200, 10000),
    };
  },
  async getEditorSession(projectId) {
    find(projectId);
    const d = sessionDb.get(projectId);
    return d ? structuredClone(d) : null;
  },
  async saveEditorSession(projectId, data) {
    find(projectId);
    sessionDb.set(projectId, {
      tabs: data.tabs.slice(0, 200).map((t) => ({ ...t, relPath: t.relPath.slice(0, 1000) })),
      active: data.active,
      expanded: data.expanded.slice(0, 500).map((p) => p.slice(0, 1000)),
    });
  },
  async onCloseRequested(_handler) {
    // beforeunload は同期でしか止められず、handler(非同期)は使えない。
    // 代わりに、画面に出ている未保存の印(.tab[data-dirty])を見て、ブラウザ標準の警告を出す。
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!document.querySelector(".tab[data-dirty]")) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  },
  async listFiles(projectId) {
    await sleep(150);
    find(projectId);
    // ?mock=listfail で失敗表示、?mock=truncated で打ち切り注記を確認できる
    if (mode === "listfail") throw "一覧を読めません(モックの失敗)";
    const relPaths = [...filesOf(projectId).keys()].sort((a, b) => collator.compare(a, b));
    return { relPaths, truncated: mode === "truncated" };
  },
  async searchInProject(projectId, query, options) {
    await sleep(200);
    find(projectId);
    // ?mock=searchfail で失敗表示、?mock=searchmany で打ち切り表示を確認できる
    if (mode === "searchfail") throw "検索に失敗しました(モックの失敗)";
    if (query.length > 1000) throw "検索語が長すぎます(1,000 文字まで)";
    const files = [...filesOf(projectId).entries()]
      .filter((e): e is [string, typeof e[1] & { content: string }] => e[1].kind === "text" && e[1].content !== null)
      .sort(([a], [b]) => collator.compare(a, b));
    const matches: SearchMatch[] = [];
    for (const [relPath, f] of files) {
      if (matches.length >= MAX_SEARCH_RESULTS) break;
      matches.push(...searchText(relPath, f.content, query, options, MAX_SEARCH_RESULTS - matches.length));
    }
    return { matches, truncated: mode === "searchmany" || matches.length >= MAX_SEARCH_RESULTS, filesSearched: files.length };
  },
  async listDir(projectId, relPath) {
    await sleep(120);
    find(projectId);
    return listMockDir(projectId, relPath);
  },
  async readFile(projectId, relPath, encoding) {
    await sleep(120);
    find(projectId);
    const f = filesOf(projectId).get(relPath);
    if (!f) throw "ファイルが見つかりません";
    const base = { relPath, size: f.size, modified: f.modified, eol: f.eol, hasBom: f.hasBom };
    // 判別できないファイル: shift_jis を指定したときだけ読める(モックの固定の挙動)
    if (f.kind === "unsupportedEncoding") {
      if (encoding === "shift_jis" && f.asShiftJis !== undefined) {
        return { ...base, kind: "text", content: f.asShiftJis, encoding: "shift_jis" };
      }
      return { ...base, kind: f.kind, content: null, encoding: "utf-8" };
    }
    return { ...base, kind: f.kind, content: f.content, encoding: encoding ?? f.encoding };
  },
  async writeFile(projectId, relPath, content, expectedModified, eol, hasBom, encoding, force) {
    await sleep(200);
    find(projectId);
    const f = filesOf(projectId).get(relPath);
    if (!f) throw "ファイルが見つかりません";
    const converted = f.kind === "unsupportedEncoding" && f.asShiftJis !== undefined; // 指定して開いたあとの保存
    if (f.kind !== "text" && !converted) throw "このファイルは書き込めません";
    // UTF-8 / UTF-16 以外は、絵文字などの範囲外の文字を表せない(実機の「変換:」エラーの再現)
    if (!encoding.startsWith("utf-") && [...content].length !== content.length) {
      throw `変換: 一部の文字が ${encoding} で表せません`;
    }
    if (!force && conflictPending) {
      conflictPending = false;
      throw "競合: ほかのアプリでファイルが変更されています";
    }
    if (!force && expectedModified !== null && expectedModified !== f.modified) {
      throw "競合: ほかのアプリでファイルが変更されています";
    }
    const modified = new Date().toISOString();
    Object.assign(f, { kind: "text", content, size: new TextEncoder().encode(content).length, eol, hasBom, encoding, modified });
    return { modified, size: f.size };
  },
  async listProjects() {
    await sleep(mode === "loading" ? 60_000 : 250);
    if (mode === "error") throw "保存ファイルを読み込めませんでした(モック)";
    return structuredClone(db);
  },
  async addProject(path) {
    await sleep(300);
    if (db.some((p) => p.path === path)) throw "すでに登録されています";
    const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
    const n = db.length;
    const p: ProjectSummary = {
      id: `mock-${++seq}`,
      name,
      path,
      displayPath: `~/dev/${name}`,
      exists: true,
      description: null,
      note: "",
      languages: [
        { name: "Python", percent: 70 },
        { name: "Markdown", percent: 30 },
      ],
      mainLanguage: "Python",
      git: null,
      lastUpdated: new Date().toISOString(),
      position: { x: (n % 3) * 450, y: Math.floor(n / 3) * 340 },
    };
    db = [...db, p];
    return structuredClone(p);
  },
  async removeProject(id) {
    db = db.filter((p) => p.id !== id);
  },
  async updateProjectNote(id, note) {
    find(id).note = note.slice(0, 200);
  },
  async updateProjectDescription(id, description) {
    find(id).description = description;
  },
  async moveProject(id, x, y) {
    find(id).position = { x, y };
  },
  async refreshProject(id) {
    return structuredClone(find(id));
  },
  async pickFolder() {
    seq += 1;
    return `C:\\Users\\demo\\dev\\new-project-${seq}`;
  },
  async getBoard() {
    await sleep(mode === "loading" ? 60_000 : 100);
    return structuredClone(board);
  },
  async addStroke(color, width, points) {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw "色の形式が正しくありません";
    if (width < 1 || width > 12) throw "太さが範囲外です";
    if (points.length < 2 || points.length > 5000) throw "点の数が正しくありません";
    if (board.strokes.length >= 2000) throw "手書きが多すぎます";
    const stroke: Stroke = { id: `mock-s${++seq}`, color, width, points };
    board.strokes = [...board.strokes, stroke];
    return structuredClone(stroke);
  },
  async removeStroke(id) {
    board.strokes = board.strokes.filter((s) => s.id !== id);
  },
  async clearStrokes() {
    board.strokes = [];
  },
  async saveViewport(x, y, zoom) {
    board.viewport = { x, y, zoom };
  },
};
