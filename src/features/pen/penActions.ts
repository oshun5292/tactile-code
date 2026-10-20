// 手書きの「描く・消す・戻す」を、画面の状態(ボードのストア)・保存(api)・履歴につなぐ。
// 画面を先に変えて(楽観的更新)、保存に失敗したら元へ戻して知らせる。

import { api } from "../../api";
import type { Stroke } from "../../api/types";
import { toMessage } from "../../shared/format";
import { useBoard } from "../board/store";
import { popOp, pushOp, remapId, type HistoryOp } from "./penHistory";
import { usePenHistory } from "./penStore";

const strokes = () => useBoard.getState().strokes;
const setStrokes = (next: Stroke[]) => useBoard.setState({ strokes: next });
const notify = (notice: string) => useBoard.setState({ notice });
const push = (op: HistoryOp) => usePenHistory.setState((h) => ({ stack: pushOp(h.stack, op) }));
const remap = (from: string, to: string) => usePenHistory.setState((h) => ({ stack: remapId(h.stack, from, to) }));
const isTmp = (id: string) => id.startsWith("tmp-");

/** 1本描いた。仮 id で先に表示し、保存できたら本物の id に置き換える。 */
export async function commitStroke(color: string, width: number, points: [number, number][]): Promise<void> {
  const tmp: Stroke = { id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, color, width, points };
  setStrokes([...strokes(), tmp]);
  push({ kind: "draw", id: tmp.id });
  try {
    const saved = await api.addStroke(color, width, points);
    setStrokes(strokes().map((s) => (s.id === tmp.id ? saved : s)));
    remap(tmp.id, saved.id);
  } catch (e) {
    setStrokes(strokes().filter((s) => s.id !== tmp.id));
    usePenHistory.setState((h) => ({ stack: h.stack.filter((op) => !(op.kind === "draw" && op.id === tmp.id)) }));
    notify(`手書きを保存できませんでした: ${toMessage(e)}`);
  }
}

/** 消しゴムでなぞっている間: 触れた線を、すぐ画面から外す(保存は離したとき)。外した線を返す。 */
export function hideStrokes(ids: string[]): Stroke[] {
  const set = new Set(ids.filter((id) => !isTmp(id)));
  if (set.size === 0) return [];
  const gone = strokes().filter((s) => set.has(s.id));
  setStrokes(strokes().filter((s) => !set.has(s.id)));
  return gone;
}

/** 消しゴムを離した: 外した線を保存側でも消し、履歴に1回の操作として積む。失敗した線は画面へ戻す。 */
export async function commitErase(gone: Stroke[]): Promise<void> {
  if (gone.length === 0) return;
  const results = await Promise.allSettled(gone.map((s) => api.removeStroke(s.id)));
  const ok: Stroke[] = [];
  const failed: Stroke[] = [];
  results.forEach((r, i) => (r.status === "fulfilled" ? ok : failed).push(gone[i]));
  if (failed.length > 0) {
    setStrokes([...strokes(), ...failed]);
    notify(`消せない線がありました(${failed.length}本)`);
  }
  push({ kind: "erase", strokes: ok });
}

/** 「消す」(全消し)。確認ダイアログのあとに呼ぶ。1回の操作として履歴に積む。 */
export async function clearAll(): Promise<void> {
  const before = strokes().filter((s) => !isTmp(s.id));
  setStrokes([]);
  try {
    await api.clearStrokes();
    push({ kind: "clear", strokes: before });
  } catch (e) {
    setStrokes(before);
    notify(`消せませんでした: ${toMessage(e)}`);
  }
}

/** 消した線を、新しい id で復元する(順序は最後に追加)。 */
async function restore(list: Stroke[]): Promise<void> {
  const failed: string[] = [];
  for (const s of list) {
    try {
      const saved = await api.addStroke(s.color, s.width, s.points);
      setStrokes([...strokes(), saved]);
      remap(s.id, saved.id);
    } catch {
      failed.push(s.id);
    }
  }
  if (failed.length > 0) notify(`戻せない線がありました(${failed.length}本)`);
}

/** 最新の操作を1つ取り消す。 */
export async function undo(): Promise<void> {
  // 保存中(仮 id)の線を戻す操作は、保存が済んでから
  for (;;) {
    const [op, rest] = popOp(usePenHistory.getState().stack);
    if (!op) return;
    if (op.kind === "draw") {
      const target = strokes().find((s) => s.id === op.id);
      if (target && isTmp(target.id)) return;
      usePenHistory.setState({ stack: rest });
      if (!target) continue; // すでに無い線(別の操作で消えた)は飛ばして次へ
      setStrokes(strokes().filter((s) => s.id !== target.id));
      try {
        await api.removeStroke(target.id);
      } catch (e) {
        setStrokes([...strokes(), target]);
        notify(`戻せませんでした: ${toMessage(e)}`);
      }
      return;
    }
    usePenHistory.setState({ stack: rest });
    await restore(op.strokes);
    return;
  }
}
