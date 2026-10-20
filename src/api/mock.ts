// ブラウザ(Tauri の外)用のモック。メモリ上だけで追加・削除・編集が動く。
// URL に ?mock=empty / error / loading / missing を付けると、各状態を確認できる(撮影用)。
import { MOCK_FILES } from "./mockFiles";
import type { Api, BoardState, Eol, FileKind, FsEntry, GitInfo, ProjectSummary, Stroke } from "./types";

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
type MockFile = { kind: FileKind; content: string | null; size: number; eol: Eol; hasBom: boolean; modified: string };
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
  // フォルダが先、名前は大文字小文字を区別せず自然順
  const byName = (a: FsEntry, b: FsEntry) => collator.compare(a.name, b.name);
  return [...[...dirs.values()].sort(byName), ...out.sort(byName)];
}

export const mockApi: Api = {
  async listDir(projectId, relPath) {
    await sleep(120);
    find(projectId);
    return listMockDir(projectId, relPath);
  },
  async readFile(projectId, relPath) {
    await sleep(120);
    find(projectId);
    const f = filesOf(projectId).get(relPath);
    if (!f) throw "ファイルが見つかりません";
    return { relPath, kind: f.kind, content: f.content, size: f.size, modified: f.modified, eol: f.eol, hasBom: f.hasBom };
  },
  async writeFile(projectId, relPath, content, expectedModified, eol, hasBom, force) {
    await sleep(200);
    find(projectId);
    const f = filesOf(projectId).get(relPath);
    if (!f) throw "ファイルが見つかりません";
    if (f.kind !== "text") throw "このファイルは書き込めません";
    if (!force && conflictPending) {
      conflictPending = false;
      throw "競合: ほかのアプリでファイルが変更されています";
    }
    if (!force && expectedModified !== null && expectedModified !== f.modified) {
      throw "競合: ほかのアプリでファイルが変更されています";
    }
    const modified = new Date().toISOString();
    Object.assign(f, { content, size: new TextEncoder().encode(content).length, eol, hasBom, modified });
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
