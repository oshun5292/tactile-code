// 手書きの操作履歴(「戻す」用)。画面の状態(メモリ)だけで持ち、再起動すると消える。
// ここは純粋関数だけ。保存(api)との橋渡しは penActions.ts。

import type { Stroke } from "../../api/types";

export type HistoryOp =
  | { kind: "draw"; id: string } // 1本描いた(取り消し = その線を消す)
  | { kind: "erase"; strokes: Stroke[] } // 消しゴムで消した(複数本まとめて。取り消し = 復元)
  | { kind: "clear"; strokes: Stroke[] }; // 全消し(取り消し = 復元)

export const MAX_HISTORY = 100;

/** 履歴の末尾(= 最新)に積む。上限を超えたら古いものから捨てる。 */
export function pushOp(stack: readonly HistoryOp[], op: HistoryOp, max = MAX_HISTORY): HistoryOp[] {
  if ((op.kind === "erase" || op.kind === "clear") && op.strokes.length === 0) return stack.slice(); // 何も消していない操作は積まない
  const next = [...stack, op];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** 最新の操作を取り出す。空なら [null, 空]。 */
export function popOp(stack: readonly HistoryOp[]): [HistoryOp | null, HistoryOp[]] {
  if (stack.length === 0) return [null, []];
  return [stack[stack.length - 1], stack.slice(0, -1)];
}

/**
 * 線の id が変わったとき(保存で仮 id が本物に、復元で新しい id に)、履歴の「描いた」を付け替える。
 * これをしないと、復元した線の「描いた」を取り消せなくなる。
 */
export function remapId(stack: readonly HistoryOp[], from: string, to: string): HistoryOp[] {
  return stack.map((op) => (op.kind === "draw" && op.id === from ? { kind: "draw", id: to } : op));
}
