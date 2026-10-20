// 契約書(docs/stage1-contract.md §2)の型。Rust 側の JSON(camelCase)と1対1で対応させる。

export type LangShare = { name: string; percent: number };

export type GitInfo = {
  branch: string | null;
  remote: { repo: string } | null;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  lastCommitAt: string | null;
};

export type ProjectSummary = {
  id: string;
  name: string;
  path: string;
  displayPath: string;
  exists: boolean;
  description: string | null;
  note: string;
  languages: LangShare[];
  mainLanguage: string | null;
  git: GitInfo | null;
  lastUpdated: string | null;
  position: { x: number; y: number };
};

// 段階2(docs/stage2-contract.md §2)。座標はすべてフロー座標。
export type Stroke = { id: string; color: string; width: number; points: [number, number][] };
export type Viewport = { x: number; y: number; zoom: number };
export type BoardState = { strokes: Stroke[]; viewport: Viewport | null };

/** フロントが使う窓口。Tauri 版とモック版が同じ形を満たす。 */
export interface Api {
  listProjects(): Promise<ProjectSummary[]>;
  addProject(path: string): Promise<ProjectSummary>;
  removeProject(id: string): Promise<void>;
  updateProjectNote(id: string, note: string): Promise<void>;
  updateProjectDescription(id: string, description: string | null): Promise<void>;
  moveProject(id: string, x: number, y: number): Promise<void>;
  refreshProject(id: string): Promise<ProjectSummary>;
  /** フォルダ選択ダイアログ。キャンセルなら null。 */
  pickFolder(): Promise<string | null>;

  getBoard(): Promise<BoardState>;
  addStroke(color: string, width: number, points: [number, number][]): Promise<Stroke>;
  removeStroke(id: string): Promise<void>;
  clearStrokes(): Promise<void>;
  saveViewport(x: number, y: number, zoom: number): Promise<void>;
}
