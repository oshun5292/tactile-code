import { create } from "zustand";
import { api } from "../../api";
import { toMessage } from "../../shared/format";
import {
  ancestorsOf,
  applyLoaded,
  closeTabIn,
  dirtyTabs,
  discardDirtyTabs,
  emptySession,
  openTabIn,
  toggleExpanded,
  updateTab,
  type MdMode,
  type Session,
  type Tab,
  type TreeDir,
} from "./editorLogic";

/** 未保存のタブがあるときの確認。何をしようとして止まったかを覚えておく。 */
export type Prompt =
  | { kind: "closeTab"; relPath: string }
  | { kind: "back" }
  | { kind: "openProject"; projectId: string };
export type PromptChoice = "save" | "discard" | "cancel";

type EditorState = {
  view: "board" | "editor";
  editorProjectId: string | null;
  /** プロジェクトごとのタブ・開閉の状態(メモリのみ。再起動での復元は 3b) */
  sessions: Record<string, Session>;
  /** プロジェクトごとのフォルダの一覧(relPath → 中身) */
  dirs: Record<string, Record<string, TreeDir>>;
  prompt: Prompt | null;
  conflict: { projectId: string; relPath: string } | null;
  /** 増えるたびに、本文のエディタへフォーカスを移す(タブを開いた・切り替えたとき) */
  focusTick: number;

  openEditor: (projectId: string, opts?: { file?: string; mdMode?: MdMode }) => Promise<void>;
  requestOpenProject: (projectId: string) => void;
  requestBack: () => void;
  requestCloseTab: (relPath: string) => void;
  resolvePrompt: (choice: PromptChoice) => Promise<void>;

  toggleDir: (projectId: string, relPath: string) => void;
  reloadTree: (projectId: string) => Promise<void>;
  openFile: (projectId: string, relPath: string, mdMode?: MdMode) => Promise<void>;
  activateTab: (projectId: string, relPath: string) => void;
  setMdMode: (projectId: string, relPath: string, mode: MdMode) => void;
  edit: (projectId: string, relPath: string, next: string) => void;
  save: (projectId: string, relPath: string, force?: boolean) => Promise<boolean>;
  reloadTab: (projectId: string, relPath: string) => Promise<void>;
  resolveConflict: (choice: "overwrite" | "reload" | "cancel") => Promise<void>;
};

export const useEditor = create<EditorState>((set, get) => {
  const sessionOf = (pid: string): Session => get().sessions[pid] ?? emptySession();
  const patchSession = (pid: string, fn: (s: Session) => Session) =>
    set((st) => ({ sessions: { ...st.sessions, [pid]: fn(st.sessions[pid] ?? emptySession()) } }));
  const patchTab = (pid: string, relPath: string, patch: Partial<Tab> | ((t: Tab) => Tab)) =>
    patchSession(pid, (s) => updateTab(s, relPath, patch));
  const patchDir = (pid: string, relPath: string, dir: TreeDir) =>
    set((st) => ({ dirs: { ...st.dirs, [pid]: { ...st.dirs[pid], [relPath]: dir } } }));

  /** フォルダの中身を読む。読み直しのときは、読み終わるまで今の表示を残す。 */
  async function loadDir(pid: string, relPath: string) {
    const cur = get().dirs[pid]?.[relPath];
    if (!cur) patchDir(pid, relPath, { status: "loading", entries: [], error: null });
    try {
      const entries = await api.listDir(pid, relPath);
      patchDir(pid, relPath, { status: "ready", entries, error: null });
    } catch (e) {
      patchDir(pid, relPath, { status: "error", entries: [], error: toMessage(e) });
    }
  }

  async function loadTab(pid: string, relPath: string) {
    try {
      const f = await api.readFile(pid, relPath);
      patchTab(pid, relPath, (t) => applyLoaded(t, f));
    } catch (e) {
      patchTab(pid, relPath, { status: "error", error: toMessage(e) });
    }
  }

  const bumpFocus = () => set((st) => ({ focusTick: st.focusTick + 1 }));

  /** 未保存のタブをすべて保存する。ひとつでも失敗したら false。 */
  async function saveAllDirty(pid: string): Promise<boolean> {
    for (const t of dirtyTabs(sessionOf(pid))) {
      if (!(await get().save(pid, t.relPath))) return false;
    }
    return true;
  }

  return {
    view: "board",
    editorProjectId: null,
    sessions: {},
    dirs: {},
    prompt: null,
    conflict: null,
    focusTick: 0,

    openEditor: async (projectId, opts) => {
      const isNew = !get().sessions[projectId];
      set({ view: "editor", editorProjectId: projectId, prompt: null });
      if (isNew) patchSession(projectId, () => emptySession());
      if (opts?.file) {
        // 開発用の URL パラメータ。ファイルのある場所までフォルダを開いておく
        const parents = ancestorsOf(opts.file);
        patchSession(projectId, (s) => ({ ...s, expanded: [...new Set([...s.expanded, ...parents])] }));
        for (const p of parents) void loadDir(projectId, p);
        void get().openFile(projectId, opts.file, opts.mdMode);
      }
      await get().reloadTree(projectId);
      // はじめて開いたプロジェクトは、README を開いておく(空の画面を避ける)
      if (isNew && !opts?.file) {
        const readme = get().dirs[projectId]?.[""]?.entries.find((e) => e.kind === "file" && /^readme\.md$/i.test(e.name));
        if (readme) await get().openFile(projectId, readme.relPath);
      }
    },

    requestOpenProject: (projectId) => {
      const cur = get().editorProjectId;
      if (cur && cur !== projectId && dirtyTabs(sessionOf(cur)).length > 0) {
        set({ prompt: { kind: "openProject", projectId } });
        return;
      }
      void get().openEditor(projectId);
    },

    requestBack: () => {
      const pid = get().editorProjectId;
      if (pid && dirtyTabs(sessionOf(pid)).length > 0) set({ prompt: { kind: "back" } });
      else set({ view: "board" });
    },

    requestCloseTab: (relPath) => {
      const pid = get().editorProjectId;
      if (!pid) return;
      const tab = sessionOf(pid).tabs.find((t) => t.relPath === relPath);
      if (tab && dirtyTabs(sessionOf(pid)).some((t) => t.relPath === relPath)) {
        set({ prompt: { kind: "closeTab", relPath } });
      } else {
        patchSession(pid, (s) => closeTabIn(s, relPath));
        bumpFocus();
      }
    },

    resolvePrompt: async (choice) => {
      const p = get().prompt;
      const pid = get().editorProjectId;
      if (!p || !pid) return;
      if (choice === "cancel") {
        set({ prompt: null });
        return;
      }
      if (p.kind === "closeTab") {
        if (choice === "save" && !(await get().save(pid, p.relPath))) {
          set({ prompt: null }); // 失敗の理由は、保存状態の表示(または競合ダイアログ)に出る
          return;
        }
        patchSession(pid, (s) => closeTabIn(s, p.relPath));
        set({ prompt: null });
        bumpFocus();
        return;
      }
      // ボードへ戻る / 別のプロジェクトを開く
      if (choice === "save") {
        if (!(await saveAllDirty(pid))) {
          set({ prompt: null });
          return;
        }
      } else {
        patchSession(pid, discardDirtyTabs);
      }
      set({ prompt: null });
      if (p.kind === "back") set({ view: "board" });
      else await get().openEditor(p.projectId);
    },

    toggleDir: (projectId, relPath) => {
      const willOpen = !sessionOf(projectId).expanded.includes(relPath);
      patchSession(projectId, (s) => ({ ...s, expanded: toggleExpanded(s.expanded, relPath) }));
      const d = get().dirs[projectId]?.[relPath];
      if (willOpen && (!d || d.status === "error")) void loadDir(projectId, relPath);
    },

    reloadTree: async (projectId) => {
      const open = sessionOf(projectId).expanded;
      await Promise.all(["", ...open].map((p) => loadDir(projectId, p)));
    },

    openFile: async (projectId, relPath, mdMode) => {
      const had = sessionOf(projectId).tabs.find((t) => t.relPath === relPath);
      patchSession(projectId, (s) => openTabIn(s, relPath, mdMode));
      bumpFocus();
      if (!had || had.status === "error") {
        if (had) patchTab(projectId, relPath, { status: "loading", error: null });
        await loadTab(projectId, relPath);
      }
    },

    activateTab: (projectId, relPath) => {
      patchSession(projectId, (s) => ({ ...s, active: relPath }));
      bumpFocus();
    },

    setMdMode: (projectId, relPath, mode) => patchTab(projectId, relPath, { mdMode: mode }),

    edit: (projectId, relPath, next) =>
      patchTab(projectId, relPath, (t) => ({
        ...t,
        draft: next,
        // 編集したら「保存済み」「失敗」の表示は消す(保存中だけは、そのまま)
        save: t.save === "saving" ? "saving" : "idle",
        saveError: null,
      })),

    save: async (projectId, relPath, force = false) => {
      const tab = sessionOf(projectId).tabs.find((t) => t.relPath === relPath);
      if (!tab || tab.kind !== "text" || tab.draft === null || tab.save === "saving") return false;
      if (tab.draft === tab.baseline && !force) return true; // 変更なし
      const content = tab.draft;
      patchTab(projectId, relPath, { save: "saving", saveError: null });
      try {
        const res = await api.writeFile(projectId, relPath, content, tab.modified, tab.eol, tab.hasBom, force);
        patchTab(projectId, relPath, (t) => ({
          ...t,
          baseline: content,
          modified: res.modified,
          size: res.size,
          // 保存中にさらに打ち込んでいたら、まだ未保存のまま
          save: t.draft === content ? "saved" : "idle",
          saveError: null,
        }));
        return true;
      } catch (e) {
        const msg = toMessage(e);
        if (msg.startsWith("競合:")) {
          patchTab(projectId, relPath, { save: "idle", saveError: null });
          set({ conflict: { projectId, relPath } });
        } else {
          patchTab(projectId, relPath, { save: "failed", saveError: msg });
        }
        return false;
      }
    },

    reloadTab: async (projectId, relPath) => {
      patchTab(projectId, relPath, { status: "loading", error: null });
      await loadTab(projectId, relPath);
    },

    resolveConflict: async (choice) => {
      const c = get().conflict;
      if (!c) return;
      set({ conflict: null });
      if (choice === "overwrite") await get().save(c.projectId, c.relPath, true);
      else if (choice === "reload") await get().reloadTab(c.projectId, c.relPath);
    },
  };
});

/** いまのプロジェクトのタブ状態(なければ空)。 */
export const selectSession = (projectId: string | null) => (st: EditorState): Session =>
  (projectId && st.sessions[projectId]) || EMPTY;
const EMPTY = emptySession();
