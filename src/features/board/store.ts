import { create } from "zustand";
import { api } from "../../api";
import type { ProjectSummary } from "../../api/types";
import { toMessage } from "../../shared/format";

type Status = "loading" | "ready" | "error";

type BoardState = {
  projects: ProjectSummary[];
  status: Status;
  error: string | null; // 読み込み失敗(画面全体のエラー)
  notice: string | null; // 操作の失敗(追加できなかった等)。画面上部に一時表示
  adding: boolean;
  load: () => Promise<void>;
  addFromDialog: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  setNote: (id: string, note: string) => Promise<void>;
  setDescription: (id: string, description: string | null) => Promise<void>;
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
  status: "loading",
  error: null,
  notice: null,
  adding: false,

  load: async () => {
    set({ status: "loading", error: null });
    try {
      set({ projects: await api.listProjects(), status: "ready" });
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

  dismissNotice: () => set({ notice: null }),
}));
