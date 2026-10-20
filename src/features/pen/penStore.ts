import { create } from "zustand";
import type { HistoryOp } from "./penHistory";

// 色は samples/36 のペンと同じ。名前はスクリーンリーダー用。
export const PEN_COLORS = [
  { value: "#34302b", name: "茶墨" },
  { value: "#e2708a", name: "桃" },
  { value: "#5a9fe0", name: "水色" },
  { value: "#5fb36f", name: "若葉" },
] as const;

export const PEN_WIDTH = 3; // ボード座標での太さ(契約: 固定でよい)
export const ERASER_RADIUS_PX = 10; // 消しゴムの半径(画面px。ズームしても見た目は一定)

export type PenTool = "pen" | "eraser";

type PenState = {
  /** ペンか消しゴムのどちらかが有効(ボードのパン・ドラッグ無効化に使う) */
  on: boolean;
  tool: PenTool;
  color: string;
  /** 丸を自動で整える(既定 ON) */
  snap: boolean;
  setOn: (on: boolean) => void;
  setTool: (tool: PenTool) => void; // 道具を選んだら有効にする(ペンと消しゴムは排他)
  setColor: (color: string) => void; // 色を選んだらペンに切り替えてONにする(36の挙動)
  setSnap: (snap: boolean) => void;
};

export const usePen = create<PenState>((set) => ({
  on: false,
  tool: "pen",
  color: PEN_COLORS[0].value,
  snap: true,
  setOn: (on) => set({ on }),
  setTool: (tool) => set({ tool, on: true }),
  setColor: (color) => set({ color, tool: "pen", on: true }),
  setSnap: (snap) => set({ snap }),
}));

type HistoryState = { stack: HistoryOp[] };
/** 戻す用の履歴(メモリのみ)。更新は penActions 経由で行う。 */
export const usePenHistory = create<HistoryState>(() => ({ stack: [] }));
