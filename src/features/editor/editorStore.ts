import { create } from "zustand";
import { api } from "../../api";
import type { EncodingName, FsEntry } from "../../api/types";
import { toMessage } from "../../shared/format";
import type { ToastData } from "../../shared/ui/Toast";
import {
  ancestorsOf,
  applyLoaded,
  bomForEncoding,
  buildSessionData,
  canReopenWithEncoding,
  closeTabIn,
  dirtyTabs,
  discardDirtyTabs,
  dropFromDirsCache,
  emptySession,
  isDirty,
  hasSameName,
  isMarkdownFile,
  judgeExternal,
  movedPath,
  needsWriteForEncoding,
  newTab,
  openTabIn,
  planRestore,
  pollTargets,
  remapDirsCache,
  removeFromSession,
  renameInSession,
  tabsUnder,
  toggleExpanded,
  updateTab,
  type MdMode,
  type Session,
  type Tab,
  type TreeDir,
} from "./editorLogic";
import type { RevealTarget } from "./cm/CodeEditor";

/** 未保存のタブがあるときの確認。何をしようとして止まったかを覚えておく。 */
export type Prompt =
  | { kind: "closeTab"; relPath: string }
  | { kind: "back" }
  | { kind: "openProject"; projectId: string }
  // 未保存の変更を捨てて、指定の文字コードで読み直す確認
  | { kind: "reopen"; relPath: string; encoding: EncodingName };
export type PromptChoice = "save" | "discard" | "cancel";

/** ウィンドウを閉じようとして止まっている確認。選択結果で resolve(true=閉じる) する。 */
export type QuitRequest = { resolve: (ok: boolean) => void };

/** 削除の確認待ち。未保存の編集が失われるタブ数も持つ(ダイアログで先に伝えるため)。 */
export type DeleteRequest = { projectId: string; relPath: string; kind: "dir" | "file"; dirtyCount: number };

const SESSION_SAVE_DELAY_MS = 500;
const RELOADED_MARK_MS = 4000;

/** 復元が済んだプロジェクト(これ以降の変更だけをセッションとして自動保存する) */
const restoredProjects = new Set<string>();
let noticeSeq = 0;
let revealSeq = 0;

type EditorState = {
  view: "board" | "editor";
  editorProjectId: string | null;
  /** プロジェクトごとのタブ・開閉の状態(メモリのみ。再起動での復元は 3b) */
  sessions: Record<string, Session>;
  /** プロジェクトごとのフォルダの一覧(relPath → 中身) */
  dirs: Record<string, Record<string, TreeDir>>;
  prompt: Prompt | null;
  // encoding は「文字コードを変えて保存」で競合したとき、上書きでも同じ文字コードを使うため
  conflict: { projectId: string; relPath: string; encoding?: EncodingName } | null;
  quit: QuitRequest | null;
  /** 増えるたびに、本文のエディタへフォーカスを移す(タブを開いた・切り替えたとき) */
  focusTick: number;
  deleteRequest: DeleteRequest | null;
  /** 検索結果から開いた位置。適用し終えたら消す(tick は同じ位置への再クリックでも変わる) */
  reveal: (RevealTarget & { projectId: string; relPath: string }) | null;
  /** 画面下のお知らせ(失敗の理由など) */
  notice: ToastData | null;

  notify: (kind: ToastData["kind"], text: string) => void;
  dismissNotice: () => void;
  /** 新規作成。成功なら null、失敗なら理由(行内の入力欄に出す)。ファイルなら作成後に開く。 */
  createEntry: (projectId: string, kind: "file" | "dir", relPath: string) => Promise<string | null>;
  /** 名前変更・移動。成功なら null、失敗なら理由。 */
  renameEntry: (projectId: string, from: string, to: string) => Promise<string | null>;
  /** ドラッグ移動。同名があれば上書きせずお知らせを出す。失敗・拒否は false。 */
  moveEntry: (projectId: string, from: string, destDir: string) => Promise<boolean>;
  /** 同じフォルダへ複製。成功なら新しいエントリ、失敗ならお知らせを出して null。 */
  duplicateEntry: (projectId: string, relPath: string) => Promise<FsEntry | null>;
  requestDelete: (projectId: string, relPath: string, kind: "dir" | "file") => void;
  resolveDelete: (confirm: boolean) => Promise<void>;
  openInVscode: (projectId: string, relPath: string) => Promise<void>;

  openEditor: (projectId: string, opts?: { file?: string; mdMode?: MdMode }) => Promise<void>;
  requestOpenProject: (projectId: string) => void;
  requestBack: () => void;
  requestCloseTab: (relPath: string) => void;
  resolvePrompt: (choice: PromptChoice) => Promise<void>;
  /** ウィンドウを閉じてよいか。未保存が無ければ即 true、あれば確認ダイアログの結果。 */
  confirmQuit: () => Promise<boolean>;
  resolveQuit: (choice: PromptChoice) => Promise<void>;
  /** 開いているタブの外部変更を調べる(フォーカス時・定期) */
  checkExternal: (projectId: string) => Promise<void>;

  toggleDir: (projectId: string, relPath: string) => void;
  reloadTree: (projectId: string) => Promise<void>;
  openFile: (projectId: string, relPath: string, mdMode?: MdMode) => Promise<void>;
  /** ファイルを開き、指定の行・桁を選択して表示する(検索結果のクリック用) */
  openAt: (projectId: string, relPath: string, line: number, column: number, length: number) => Promise<void>;
  clearReveal: (tick: number) => void;
  activateTab: (projectId: string, relPath: string) => void;
  setMdMode: (projectId: string, relPath: string, mode: MdMode) => void;
  edit: (projectId: string, relPath: string, next: string) => void;
  /** encoding を渡すと、その文字コードで保存する(内容が同じでも書く)。成功したらタブの文字コードを更新。 */
  save: (projectId: string, relPath: string, force?: boolean, encoding?: EncodingName) => Promise<boolean>;
  /** 指定の文字コードで読み直す。未保存の変更があれば、破棄の確認を挟む。 */
  requestReopenWithEncoding: (projectId: string, relPath: string, encoding: EncodingName) => void;
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

  async function loadTab(pid: string, relPath: string, encoding?: EncodingName) {
    try {
      const f = await api.readFile(pid, relPath, encoding);
      patchTab(pid, relPath, (t) => applyLoaded(t, f));
    } catch (e) {
      patchTab(pid, relPath, { status: "error", error: toMessage(e) });
    }
  }

  let polling = false;

  /**
   * 前回のタブ・展開フォルダを戻す。存在するファイルだけ開く。タブを戻せたら true。
   * 戻し終えるまで自動保存しない(空の状態で保存済みデータを上書きしないため)。
   */
  async function restoreSession(pid: string): Promise<boolean> {
    let restored = false;
    try {
      const saved = await api.getEditorSession(pid);
      const stats = saved && saved.tabs.length > 0 ? await api.statFiles(pid, saved.tabs.map((t) => t.relPath).slice(0, 200)) : [];
      const plan = planRestore(saved, stats);
      if (plan.tabs.length > 0 || plan.expanded.length > 0) {
        patchSession(pid, () => ({
          tabs: plan.tabs.map((t) => newTab(t.relPath, t.mdMode)),
          active: plan.active,
          expanded: plan.expanded,
        }));
        for (const t of plan.tabs) void loadTab(pid, t.relPath);
        restored = plan.tabs.length > 0;
      }
    } catch {
      // 復元に失敗しても、普通に開けるようにする
    }
    restoredProjects.add(pid);
    return restored;
  }

  /** 復元した展開フォルダのうち、読めなかったもの(消えた等)は開いた状態から外す。 */
  function pruneMissingDirs(pid: string) {
    const dirs = get().dirs[pid] ?? {};
    patchSession(pid, (s) => ({ ...s, expanded: s.expanded.filter((p) => dirs[p]?.status !== "error") }));
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
    quit: null,
    focusTick: 0,
    deleteRequest: null,
    reveal: null,
    notice: null,

    notify: (kind, text) => set({ notice: { id: ++noticeSeq, kind, text } }),
    dismissNotice: () => set({ notice: null }),

    createEntry: async (projectId, kind, relPath) => {
      try {
        if (kind === "file") await api.createFile(projectId, relPath);
        else await api.createDir(projectId, relPath);
      } catch (e) {
        return toMessage(e);
      }
      // 作った場所が見えるよう、親フォルダを開いてから読み直す
      const parents = ancestorsOf(relPath);
      patchSession(projectId, (s) => ({ ...s, expanded: [...new Set([...s.expanded, ...parents])] }));
      await get().reloadTree(projectId);
      if (kind === "file") await get().openFile(projectId, relPath);
      return null;
    },

    renameEntry: async (projectId, from, to) => {
      try {
        await api.renameEntry(projectId, from, to);
      } catch (e) {
        return toMessage(e);
      }
      // タブ・展開状態・一覧のキャッシュを新しいパスへ付け替える(未保存の編集は保つ)。移動先の親も開く
      patchSession(projectId, (s) => {
        const r = renameInSession(s, from, to);
        return { ...r, expanded: [...new Set([...r.expanded, ...ancestorsOf(to)])] };
      });
      set((st) => ({ dirs: { ...st.dirs, [projectId]: remapDirsCache(st.dirs[projectId] ?? {}, from, to) } }));
      await get().reloadTree(projectId);
      return null;
    },

    moveEntry: async (projectId, from, destDir) => {
      const to = movedPath(from, destDir);
      // 読み込み済みの移動先に同名があれば、API を呼ばずに断る(Rust 側でも上書きしないが、先に分かりやすく伝える)
      const dest = get().dirs[projectId]?.[destDir];
      if (dest && hasSameName(dest.entries, to.slice(to.lastIndexOf("/") + 1))) {
        get().notify("error", "同じ名前のものがあります");
        return false;
      }
      const reason = await get().renameEntry(projectId, from, to);
      if (reason) {
        get().notify("error", reason.startsWith("既存") ? "同じ名前のものがあります" : `移動できませんでした: ${reason}`);
        return false;
      }
      return true;
    },

    duplicateEntry: async (projectId, relPath) => {
      let entry: FsEntry;
      try {
        entry = await api.duplicateEntry(projectId, relPath);
      } catch (e) {
        get().notify("error", `複製できませんでした: ${toMessage(e)}`);
        return null;
      }
      // 新しい行が見えるよう、親フォルダを開いてから読み直す
      patchSession(projectId, (s) => ({ ...s, expanded: [...new Set([...s.expanded, ...ancestorsOf(entry.relPath)])] }));
      await get().reloadTree(projectId);
      return entry;
    },

    requestDelete: (projectId, relPath, kind) => {
      const dirtyCount = dirtyTabs({ ...emptySession(), tabs: tabsUnder(sessionOf(projectId), relPath) }).length;
      set({ deleteRequest: { projectId, relPath, kind, dirtyCount } });
    },

    resolveDelete: async (confirm) => {
      const req = get().deleteRequest;
      if (!req) return;
      set({ deleteRequest: null });
      if (!confirm) return;
      try {
        await api.deleteEntry(req.projectId, req.relPath);
      } catch (e) {
        get().notify("error", `削除できませんでした: ${toMessage(e)}`);
        return;
      }
      patchSession(req.projectId, (s) => removeFromSession(s, req.relPath));
      set((st) => ({ dirs: { ...st.dirs, [req.projectId]: dropFromDirsCache(st.dirs[req.projectId] ?? {}, req.relPath) } }));
      bumpFocus();
      await get().reloadTree(req.projectId);
    },

    openInVscode: async (projectId, relPath) => {
      try {
        await api.openInVscode(projectId, relPath);
      } catch (e) {
        get().notify("error", toMessage(e));
      }
    },

    openEditor: async (projectId, opts) => {
      const isNew = !get().sessions[projectId];
      set({ view: "editor", editorProjectId: projectId, prompt: null });
      let restored = false;
      if (isNew) {
        patchSession(projectId, () => emptySession());
        restored = await restoreSession(projectId);
      }
      if (opts?.file) {
        // 開発用の URL パラメータ。ファイルのある場所までフォルダを開いておく
        const parents = ancestorsOf(opts.file);
        patchSession(projectId, (s) => ({ ...s, expanded: [...new Set([...s.expanded, ...parents])] }));
        for (const p of parents) void loadDir(projectId, p);
        void get().openFile(projectId, opts.file, opts.mdMode);
      }
      await get().reloadTree(projectId);
      if (restored) pruneMissingDirs(projectId);
      // はじめて開いたプロジェクトは、README を開いておく(空の画面を避ける)
      if (isNew && !opts?.file && !restored) {
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
      if (p.kind === "reopen") {
        // 確認で「破棄」を選んだ。編集内容は捨てて、指定の文字コードで読み直す
        set({ prompt: null });
        patchTab(pid, p.relPath, { status: "loading", error: null });
        await loadTab(pid, p.relPath, p.encoding);
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

    confirmQuit: async () => {
      const anyDirty = Object.values(get().sessions).some((s) => dirtyTabs(s).length > 0);
      if (!anyDirty) return true;
      if (get().quit) return false; // すでに確認中
      return new Promise<boolean>((resolve) => set({ quit: { resolve } }));
    },

    resolveQuit: async (choice) => {
      const q = get().quit;
      if (!q) return;
      set({ quit: null });
      if (choice === "cancel") return q.resolve(false);
      if (choice === "discard") return q.resolve(true);
      // 全プロジェクトの未保存を保存する。ひとつでも失敗したら閉じない
      for (const pid of Object.keys(get().sessions)) {
        if (!(await saveAllDirty(pid))) return q.resolve(false);
      }
      q.resolve(true);
    },

    checkExternal: async (projectId) => {
      if (polling) return;
      const targets = pollTargets(sessionOf(projectId));
      if (targets.length === 0) return;
      polling = true;
      try {
        const stats = await api.statFiles(projectId, targets.map((t) => t.relPath));
        for (const stat of stats) {
          const sent = targets.find((t) => t.relPath === stat.relPath);
          const tab = sessionOf(projectId).tabs.find((t) => t.relPath === stat.relPath);
          // 問い合わせ中に保存・再読み込みで modified が変わったタブは、自分の更新を誤検知しないよう見送る
          if (!sent || !tab || tab.modified !== sent.modified || tab.save === "saving") continue;
          const action = judgeExternal(tab, stat);
          if (action === "mark-changed") patchTab(projectId, tab.relPath, { external: "changed" });
          else if (action === "mark-deleted") patchTab(projectId, tab.relPath, { external: "deleted" });
          else if (action === "clear") patchTab(projectId, tab.relPath, { external: null });
          else if (action === "reload") {
            await loadTab(projectId, tab.relPath);
            patchTab(projectId, tab.relPath, (t) => (t.status === "ready" ? { ...t, external: "reloaded" } : t));
            setTimeout(
              () => patchTab(projectId, tab.relPath, (t) => (t.external === "reloaded" ? { ...t, external: null } : t)),
              RELOADED_MARK_MS,
            );
          }
        }
      } catch {
        // 一時的な失敗は次の周期で取り返す
      } finally {
        polling = false;
      }
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

    openAt: async (projectId, relPath, line, column, length) => {
      const had = sessionOf(projectId).tabs.find((t) => t.relPath === relPath);
      // 「読む」モードでは編集欄が無い。勝手に「書く」へ切り替えず、開くだけにする
      const readOnlyView = had !== undefined && isMarkdownFile(relPath) && had.mdMode === "preview";
      if (!readOnlyView) set({ reveal: { projectId, relPath, line, column, length, tick: ++revealSeq } });
      await get().openFile(projectId, relPath);
    },
    clearReveal: (tick) => set((st) => (st.reveal?.tick === tick ? { reveal: null } : {})),

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

    requestReopenWithEncoding: (projectId, relPath, encoding) => {
      const tab = sessionOf(projectId).tabs.find((t) => t.relPath === relPath);
      if (!tab || !canReopenWithEncoding(tab)) return;
      if (isDirty(tab)) {
        set({ prompt: { kind: "reopen", relPath, encoding } });
        return;
      }
      patchTab(projectId, relPath, { status: "loading", error: null });
      void loadTab(projectId, relPath, encoding);
    },

    save: async (projectId, relPath, force = false, encoding) => {
      const tab = sessionOf(projectId).tabs.find((t) => t.relPath === relPath);
      if (!tab || tab.kind !== "text" || tab.draft === null || tab.save === "saving") return false;
      const target = encoding ?? tab.encoding;
      if (tab.draft === tab.baseline && !force && !needsWriteForEncoding(tab, target)) return true; // 変更なし
      const hasBom = bomForEncoding(tab.encoding, target, tab.hasBom);
      const content = tab.draft;
      patchTab(projectId, relPath, { save: "saving", saveError: null });
      try {
        const res = await api.writeFile(projectId, relPath, content, tab.modified, tab.eol, hasBom, target, force);
        patchTab(projectId, relPath, (t) => ({
          ...t,
          baseline: content,
          modified: res.modified,
          size: res.size,
          encoding: target,
          hasBom,
          // 保存中にさらに打ち込んでいたら、まだ未保存のまま
          save: t.draft === content ? "saved" : "idle",
          saveError: null,
          external: null,
        }));
        return true;
      } catch (e) {
        const msg = toMessage(e);
        if (msg.startsWith("競合:")) {
          patchTab(projectId, relPath, { save: "idle", saveError: null });
          set({ conflict: { projectId, relPath, encoding } });
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
      if (choice === "overwrite") await get().save(c.projectId, c.relPath, true, c.encoding);
      else if (choice === "reload") await get().reloadTab(c.projectId, c.relPath);
    },
  };
});

// タブ・アクティブ・展開フォルダが変わったら、少し待ってまとめて保存する(再起動での復元用)。
const lastSaved = new Map<string, string>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
useEditor.subscribe((st, prev) => {
  for (const [pid, s] of Object.entries(st.sessions)) {
    if (s === prev.sessions[pid] || !restoredProjects.has(pid)) continue;
    const key = JSON.stringify(buildSessionData(s));
    if (lastSaved.get(pid) === key) continue; // 本文の編集などでは保存しない
    clearTimeout(saveTimers.get(pid));
    saveTimers.set(
      pid,
      setTimeout(() => {
        lastSaved.set(pid, key);
        api.saveEditorSession(pid, JSON.parse(key)).catch(() => lastSaved.delete(pid));
      }, SESSION_SAVE_DELAY_MS),
    );
  }
});

/** いまのプロジェクトのタブ状態(なければ空)。 */
export const selectSession = (projectId: string | null) => (st: EditorState): Session =>
  (projectId && st.sessions[projectId]) || EMPTY;
const EMPTY = emptySession();
