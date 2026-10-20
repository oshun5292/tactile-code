import { create } from "zustand";
import { api } from "../../api";
import type { ProjectSummary, Stroke, Viewport } from "../../api/types";
import { toMessage } from "../../shared/format";

type Status = "loading" | "ready" | "error";

type BoardState = {
  projects: ProjectSummary[];
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
      set({ projects, strokes: board.strokes, viewport: board.viewport, status: "ready" });
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
      set({ projects: get().projects.filter((p) => p.id !== id) });
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

  // 手書きの追加・消去・戻すは、操作の履歴を持つ src/features/pen/penActions.ts が行う

  // 連続で呼ばれる前提(呼び出し側で 500ms 待つ)。失敗しても操作の邪魔をしないよう、黙って無視する
  saveViewport: (vp) => {
    api.saveViewport(vp.x, vp.y, vp.zoom).catch(() => {});
  },

  dismissNotice: () => set({ notice: null }),
}));
