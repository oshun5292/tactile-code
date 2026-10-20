// プロジェクトごとの git 状態(N11)。取得は重複させず、失敗しても画面は壊さない(印を出さないだけ)。
import { create } from "zustand";
import { api } from "../../api";
import { buildGitView, EMPTY_GIT_VIEW, type GitView } from "./gitLogic";

const SAVE_DEBOUNCE_MS = 500;

type GitState = {
  byProject: Record<string, GitView>;
  /** 取得して反映する。進行中なら、その完了後にもう一度だけ取り直す(直前の変更を取りこぼさないため)。 */
  refresh: (projectId: string) => Promise<void>;
  /** ファイル保存の直後に呼ぶ。続けて保存されても 500ms にまとめる。 */
  refreshSoon: (projectId: string) => void;
};

const inflight = new Map<string, Promise<void>>();
const queued = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useGit = create<GitState>((set, get) => {
  async function fetchOnce(pid: string) {
    try {
      const r = await api.getGitStatus(pid);
      set((st) => ({ byProject: { ...st.byProject, [pid]: r.isRepo ? buildGitView(r.files, r.truncated) : EMPTY_GIT_VIEW } }));
    } catch {
      // 失敗時は、直前の表示を残す(消すとちらつくため)。印が古いだけで壊れはしない
    }
  }

  return {
    byProject: {},
    refresh: (pid) => {
      const running = inflight.get(pid);
      if (running) {
        queued.add(pid);
        return running;
      }
      const p = (async () => {
        try {
          do {
            queued.delete(pid);
            await fetchOnce(pid);
          } while (queued.has(pid));
        } finally {
          inflight.delete(pid);
        }
      })();
      inflight.set(pid, p);
      return p;
    },
    refreshSoon: (pid) => {
      clearTimeout(timers.get(pid));
      timers.set(
        pid,
        setTimeout(() => {
          timers.delete(pid);
          void get().refresh(pid);
        }, SAVE_DEBOUNCE_MS),
      );
    },
  };
});

export const selectGitView = (projectId: string | null) => (st: GitState): GitView => (projectId && st.byProject[projectId]) || EMPTY_GIT_VIEW;
