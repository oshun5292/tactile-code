import { create } from "zustand";

// 色は samples/36 のペンと同じ。名前はスクリーンリーダー用。
export const PEN_COLORS = [
  { value: "#34302b", name: "茶墨" },
  { value: "#e2708a", name: "桃" },
  { value: "#5a9fe0", name: "水色" },
  { value: "#5fb36f", name: "若葉" },
] as const;

export const PEN_WIDTH = 3; // ボード座標での太さ(契約: 固定でよい)

type PenState = {
  on: boolean;
  color: string;
  setOn: (on: boolean) => void;
  setColor: (color: string) => void; // 色を選んだらペンもONにする(36の挙動)
};

export const usePen = create<PenState>((set) => ({
  on: false,
  color: PEN_COLORS[0].value,
  setOn: (on) => set({ on }),
  setColor: (color) => set({ color, on: true }),
}));
