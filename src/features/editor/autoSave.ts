// 自動保存の制御(N10)。ストアの変化と、ウィンドウのフォーカス・日本語変換の状態を見て保存する。
// 判定そのものは autoSaveLogic.ts の純粋関数に任せる。
import { editedSince, isAutoSaveBlockedByDialog, isAutoSaveTarget, type FailedMark } from "./autoSaveLogic";
import { useEditor } from "./editorStore";
import { useSettings } from "./settingsStore";

const key = (pid: string, relPath: string) => `${pid}\u0000${relPath}`;

/** 自動保存を始める。戻り値で止める(エディタ画面のアンマウント時)。 */
export function startAutoSave(): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  // 自動保存が失敗(競合含む)したときの内容。次に編集されるまで同じ内容は再試行しない
  const failed = new Map<string, FailedMark>();
  let composing = false;

  const clearTimer = (k: string) => {
    const t = timers.get(k);
    if (t) clearTimeout(t);
    timers.delete(k);
  };

  async function trySave(pid: string, relPath: string) {
    const st = useEditor.getState();
    if (isAutoSaveBlockedByDialog(st)) return;
    const tab = st.sessions[pid]?.tabs.find((t) => t.relPath === relPath);
    const k = key(pid, relPath);
    if (!tab || !isAutoSaveTarget(tab, failed.get(k))) return;
    if (await st.save(pid, relPath)) {
      failed.delete(k);
    } else {
      const cur = useEditor.getState().sessions[pid]?.tabs.find((t) => t.relPath === relPath);
      if (cur) failed.set(k, { draft: cur.draft, eol: cur.eol });
    }
  }

  function schedule(pid: string, relPath: string) {
    const k = key(pid, relPath);
    clearTimer(k);
    const { autoSave, autoSaveDelayMs } = useSettings.getState().settings;
    if (autoSave !== "afterDelay") return;
    timers.set(
      k,
      setTimeout(() => {
        timers.delete(k);
        // 変換中・ダイアログ中は保存せず、もう一度待つ(確定後 / 閉じた後に保存される)
        const st = useEditor.getState();
        const tab = st.sessions[pid]?.tabs.find((t) => t.relPath === relPath);
        if (composing || isAutoSaveBlockedByDialog(st) || tab?.save === "saving") {
          if (tab && (tab.save === "saving" || isAutoSaveTarget(tab, failed.get(k)))) schedule(pid, relPath);
          return;
        }
        void trySave(pid, relPath);
      }, autoSaveDelayMs),
    );
  }

  function saveAllDirtyOf(pid: string) {
    const s = useEditor.getState().sessions[pid];
    if (!s) return;
    for (const t of s.tabs) void trySave(pid, t.relPath);
  }

  // 編集(最後の入力から数える)とタブ切り替えを検出する
  const unsubEditor = useEditor.subscribe((st, prev) => {
    for (const [pid, s] of Object.entries(st.sessions)) {
      const ps = prev.sessions[pid];
      if (s === ps) continue;
      for (const tab of s.tabs) {
        const before = ps?.tabs.find((t) => t.relPath === tab.relPath);
        if (before === tab) continue;
        if (editedSince(before, tab)) {
          failed.delete(key(pid, tab.relPath)); // 編集されたので、また試してよい
          if (before) schedule(pid, tab.relPath); // 読み込み直後(before なし)の初期化は編集ではない
        }
      }
      for (const [k] of timers) {
        if (!k.startsWith(`${pid}\u0000`)) continue;
        const rel = k.slice(pid.length + 1);
        if (!s.tabs.some((t) => t.relPath === rel)) clearTimer(k); // 閉じたタブ
      }
      // タブ・ファイルの切り替え: 離れたタブを保存する
      if (ps && ps.active !== s.active && ps.active && useSettings.getState().settings.autoSave === "onFocusChange") {
        void trySave(pid, ps.active);
      }
    }
  });

  // 設定の変更: afterDelay になったら未保存タブの待ちを始め、それ以外なら待ちを捨てる
  const unsubSettings = useSettings.subscribe((st, prev) => {
    if (st.settings.autoSave === prev.settings.autoSave && st.settings.autoSaveDelayMs === prev.settings.autoSaveDelayMs) return;
    for (const k of [...timers.keys()]) clearTimer(k);
    if (st.settings.autoSave !== "afterDelay") return;
    for (const [pid, s] of Object.entries(useEditor.getState().sessions)) {
      for (const t of s.tabs) if (isAutoSaveTarget(t)) schedule(pid, t.relPath);
    }
  });

  const onBlur = () => {
    if (useSettings.getState().settings.autoSave !== "onFocusChange") return;
    const pid = useEditor.getState().editorProjectId;
    if (pid) saveAllDirtyOf(pid);
  };
  const onCompStart = () => (composing = true);
  const onCompEnd = () => (composing = false);
  window.addEventListener("blur", onBlur);
  window.addEventListener("compositionstart", onCompStart, true);
  window.addEventListener("compositionend", onCompEnd, true);

  return () => {
    unsubEditor();
    unsubSettings();
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("compositionstart", onCompStart, true);
    window.removeEventListener("compositionend", onCompEnd, true);
    for (const k of [...timers.keys()]) clearTimer(k);
  };
}
