import { create } from "zustand";
import { api } from "../../api";
import type { Edge, ProjectSummary, Stroke, Viewport } from "../../api/types";
import { toMessage } from "../../shared/format";

type Status = "loading" | "ready" | "error";

type BoardState = {
  projects: ProjectSummary[];
  edges: Edge[];
  strokes: Stroke[];
  viewport: Viewport | null; // 起動時に保存されていた表示位置(null なら初期ビューポート)
  status: Status;
  error: string | null; // 読み込み失敗(画面全体のエラー)
  notice: string | null; // 操作の失敗(追加できなかった等)。画面上部に一時表示
  adding: boolean;
  load: () => Promise<void>;
  addFromDialog: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  setNote: (id: string, note: string) => Promise<void>;
  setDescription: (id: string, description: string | null) => Promise<void>;
  moveProject: (id: string, x: number, y: number) => Promise<void>;
  connect: (source: string, target: string) => Promise<void>;
  disconnect: (ids: string[]) => Promise<void>;
  addStroke: (color: string, width: number, points: [number, number][]) => Promise<void>;
  undoStroke: () => Promise<void>;
  clearStrokes: () => Promise<void>;
  saveViewport: (vp: Viewport) => void;
  dismissNotice: () => void;
};

/** 楽観的更新: 先に画面を変え、保存に失敗したら元へ戻して知らせる。 */
async function optimistic(
  get: () => BoardState,
  set: (p: Partial<BoardState>) => void,
  id: string,
  patch: Partial<ProjectSummary>,
  save: () => Promise<void>,
) {
  const before = get().projects;
  set({ projects: before.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  try {
    await save();
  } catch (e) {
    set({ projects: before, notice: `保存できませんでした: ${toMessage(e)}` });
  }
}

export const useBoard = create<BoardState>((set, get) => ({
  projects: [],
  edges: [],
  strokes: [],
  viewport: null,
  status: "loading",
  error: null,
  notice: null,
  adding: false,

  load: async () => {
    set({ status: "loading", error: null });
    try {
      const [projects, board] = await Promise.all([api.listProjects(), api.getBoard()]);
      set({ projects, edges: board.edges, strokes: board.strokes, viewport: board.viewport, status: "ready" });
    } catch (e) {
      set({ status: "error", error: toMessage(e) });
    }
  },

  addFromDialog: async () => {
    if (get().adding) return;
    set({ adding: true, notice: null });
    try {
      const path = await api.pickFolder();
      if (path) {
        const added = await api.addProject(path);
        set({ projects: [...get().projects, added] });
      }
    } catch (e) {
      set({ notice: `追加できませんでした: ${toMessage(e)}` });
    } finally {
      set({ adding: false });
    }
  },

  remove: async (id) => {
    try {
      await api.removeProject(id);
      // バックエンドと同じく、そのカードにつながっていた線も消す(手書きは残す)
      set({
        projects: get().projects.filter((p) => p.id !== id),
        edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      });
    } catch (e) {
      set({ notice: `外せませんでした: ${toMessage(e)}` });
    }
  },

  setNote: (id, note) => optimistic(get, set, id, { note }, () => api.updateProjectNote(id, note)),

  setDescription: async (id, description) => {
    await optimistic(get, set, id, { description }, () => api.updateProjectDescription(id, description));
    // null に戻した場合、README 由来の説明はバックエンドが決めるので取り直す
    if (description === null && !get().notice) {
      try {
        const fresh = await api.refreshProject(id);
        set({ projects: get().projects.map((p) => (p.id === id ? fresh : p)) });
      } catch {
        /* 取り直せなくても、表示は空のままで困らない */
      }
    }
  },

  moveProject: async (id, x, y) => {
    // 位置は React Flow が先に動かしているので、ここでは保存と、store 側の値の更新だけ
    const before = get().projects;
    set({ projects: before.map((p) => (p.id === id ? { ...p, position: { x, y } } : p)) });
    try {
      await api.moveProject(id, x, y);
    } catch (e) {
      set({ projects: before, notice: `位置を保存できませんでした: ${toMessage(e)}` });
    }
  },

  connect: async (source, target) => {
    try {
      const edge = await api.addEdge(source, target);
      set({ edges: [...get().edges, edge] });
    } catch (e) {
      set({ notice: `つなげませんでした: ${toMessage(e)}` });
    }
  },

  disconnect: async (ids) => {
    const before = get().edges;
    set({ edges: before.filter((e) => !ids.includes(e.id)) });
    try {
      await Promise.all(ids.map((id) => api.removeEdge(id)));
    } catch (e) {
      set({ edges: before, notice: `線を外せませんでした: ${toMessage(e)}` });
    }
  },

  addStroke: async (color, width, points) => {
    // 描いた直後に消えて見えないよう、仮の id で先に表示し、保存できたら本物に置き換える
    const tmp: Stroke = { id: `tmp-${Date.now()}`, color, width, points };
    set({ strokes: [...get().strokes, tmp] });
    try {
      const saved = await api.addStroke(color, width, points);
      set({ strokes: get().strokes.map((s) => (s.id === tmp.id ? saved : s)) });
    } catch (e) {
      set({ strokes: get().strokes.filter((s) => s.id !== tmp.id), notice: `手書きを保存できませんでした: ${toMessage(e)}` });
    }
  },

  undoStroke: async () => {
    const last = get().strokes[get().strokes.length - 1];
    if (!last || last.id.startsWith("tmp-")) return; // 保存中の1本は、保存が済んでから
    set({ strokes: get().strokes.slice(0, -1) });
    try {
      await api.removeStroke(last.id);
    } catch (e) {
      set({ strokes: [...get().strokes, last], notice: `戻せませんでした: ${toMessage(e)}` });
    }
  },

  clearStrokes: async () => {
    const before = get().strokes;
    set({ strokes: [] });
    try {
      await api.clearStrokes();
    } catch (e) {
      set({ strokes: before, notice: `消せませんでした: ${toMessage(e)}` });
    }
  },

  // 連続で呼ばれる前提(呼び出し側で 500ms 待つ)。失敗しても操作の邪魔をしないよう、黙って無視する
  saveViewport: (vp) => {
    api.saveViewport(vp.x, vp.y, vp.zoom).catch(() => {});
  },

  dismissNotice: () => set({ notice: null }),
}));
