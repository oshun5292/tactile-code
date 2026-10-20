// 「すべて保存」の和音(Ctrl+K → S)と自動保存の判定(N10)。画面や API に依存しない純粋関数。
import { isDirty, type Tab } from "./editorLogic";

/** Ctrl+K を押してから S を押すまでに許す時間(VSCode のコードより短めの固定値) */
export const CHORD_WINDOW_MS = 1500;

export type ChordKey = { key: string; ctrl: boolean; meta: boolean; alt: boolean; shift: boolean };
export type ChordResult = {
  /** 次の「Ctrl+K を押した時刻」。待っていなければ null */
  pendingAt: number | null;
  /** 和音が完成した(すべて保存を実行する) */
  fire: boolean;
  /** このキーを画面の他の処理(文字入力など)へ渡さない */
  consume: boolean;
};

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph"]);

/** 和音の待ち時間内か。 */
export function isChordActive(pendingAt: number | null, now: number): boolean {
  return pendingAt !== null && now - pendingAt <= CHORD_WINDOW_MS;
}

/**
 * Ctrl+K → S の状態遷移。Ctrl+K で待ち状態になり、時間内の S で完成。
 * 修飾キーだけの押下は待ちを保つ(Ctrl を押したまま S を押す人のため)。それ以外のキーは待ちを解く。
 */
export function stepChord(pendingAt: number | null, now: number, k: ChordKey): ChordResult {
  const mod = k.ctrl || k.meta;
  if (mod && !k.alt && !k.shift && k.key.toLowerCase() === "k") return { pendingAt: now, fire: false, consume: true };
  const active = isChordActive(pendingAt, now);
  if (!active) return { pendingAt: null, fire: false, consume: false };
  if (MODIFIER_KEYS.has(k.key)) return { pendingAt, fire: false, consume: false };
  if (!k.alt && !k.shift && k.key.toLowerCase() === "s") return { pendingAt: null, fire: true, consume: true };
  return { pendingAt: null, fire: false, consume: false };
}

/** 自動保存を試みて保存できなかった時点の内容。同じ内容のままなら、繰り返し再試行しない。 */
export type FailedMark = { draft: string | null; eol: Tab["eol"] };

/**
 * 自動保存してよいタブか。未保存(改行コードだけの変更も含む)で、保存中・失敗済み・
 * 外部変更ありでなく、前回の自動保存失敗から内容が変わっているものだけ。
 */
export function isAutoSaveTarget(tab: Tab, failed?: FailedMark): boolean {
  if (tab.kind !== "text" || tab.status !== "ready" || !isDirty(tab)) return false;
  if (tab.save === "saving" || tab.save === "failed") return false;
  if (tab.external === "changed" || tab.external === "deleted") return false;
  if (failed && failed.draft === tab.draft && failed.eol === tab.eol) return false;
  return true;
}

/** 確認ダイアログ(閉じる・競合・終了・削除)が出ている間は自動保存しない。 */
export function isAutoSaveBlockedByDialog(s: { prompt: unknown; conflict: unknown; quit: unknown; deleteRequest: unknown }): boolean {
  return s.prompt !== null || s.conflict !== null || s.quit !== null || s.deleteRequest !== null;
}

/** 前のタブ状態から本文・改行コードが変わったか(編集の検出。保存状態だけの変化は含めない)。 */
export function editedSince(prev: Tab | undefined, cur: Tab): boolean {
  return !prev || prev.draft !== cur.draft || prev.eol !== cur.eol;
}

/** 設定メニューの選択肢 */
export const AUTO_SAVE_DELAY_CHOICES = [500, 1000, 2000, 5000] as const;
