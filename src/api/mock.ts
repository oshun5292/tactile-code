// ブラウザ(Tauri の外)用のモック。メモリ上だけで追加・削除・編集が動く。
// URL に ?mock=empty / error / loading / missing を付けると、各状態を確認できる(撮影用)。
import type { Api, GitInfo, ProjectSummary } from "./types";

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

const mode = typeof location !== "undefined" ? new URLSearchParams(location.search).get("mock") : null;
let db: ProjectSummary[] = mode === "empty" ? [] : sampleProjects();
if (mode === "missing") db[3] = { ...db[3], exists: false, git: null, lastUpdated: null };
let seq = 100;

const find = (id: string) => {
  const p = db.find((x) => x.id === id);
  if (!p) throw "プロジェクトが見つかりません";
  return p;
};

export const mockApi: Api = {
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
};
