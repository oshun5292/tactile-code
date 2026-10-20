// 表示設定の純粋関数(N9)。画面や API に依存しないので、単体テストできる。
import type { AutoSaveMode, EditorSettings } from "../../api/types";

export const FONT_MIN = 10;
export const FONT_MAX = 28;
/** 現在の見た目(theme.ts の既定 13px)と同じ値。Ctrl+0 でここへ戻る */
export const FONT_DEFAULT = 13;

export const DEFAULT_SETTINGS: EditorSettings = {
  fontSize: FONT_DEFAULT,
  wordWrap: false,
  autoSave: "off",
  autoSaveDelayMs: 1000,
};

const AUTO_SAVE_MODES: AutoSaveMode[] = ["off", "afterDelay", "onFocusChange"];

/** 文字サイズを範囲内の整数にする(NaN は既定値)。 */
export function clampFontSize(n: number): number {
  if (!Number.isFinite(n)) return FONT_DEFAULT;
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(n)));
}

/** 1段階=1px の拡大・縮小。 */
export function stepFontSize(current: number, delta: 1 | -1): number {
  return clampFontSize(current + delta);
}

/** 保存済みの値(古い・壊れている可能性がある)から、安全な設定を作る。足りない項目は既定値。 */
export function normalizeSettings(raw: Partial<EditorSettings> | null | undefined): EditorSettings {
  const d = DEFAULT_SETTINGS;
  if (!raw) return { ...d };
  return {
    fontSize: typeof raw.fontSize === "number" ? clampFontSize(raw.fontSize) : d.fontSize,
    wordWrap: typeof raw.wordWrap === "boolean" ? raw.wordWrap : d.wordWrap,
    autoSave: AUTO_SAVE_MODES.includes(raw.autoSave as AutoSaveMode) ? (raw.autoSave as AutoSaveMode) : d.autoSave,
    autoSaveDelayMs:
      typeof raw.autoSaveDelayMs === "number" && Number.isFinite(raw.autoSaveDelayMs)
        ? Math.min(10000, Math.max(200, Math.round(raw.autoSaveDelayMs)))
        : d.autoSaveDelayMs,
  };
}

const MAX_NUM = 1_000_000_000; // 桁あふれを避ける上限(実際の行数への丸めは文書側で行う)

/**
 * 「行へ移動」の入力を解析する。"12" は12行目、"12:5" は12行5桁(どちらも1始まり)。
 * 全角数字・全角コロン・前後の空白を許す(日本語入力のままでも打てるように)。
 * 0 や負は1に丸める。解析できなければ null。
 */
export function parseGoto(input: string): { line: number; column: number } | null {
  const t = input
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ":");
  const m = /^(\d+)(?:\s*:\s*(\d*))?$/.exec(t);
  if (!m) return null;
  const line = Math.min(MAX_NUM, Math.max(1, Number(m[1])));
  const column = m[2] ? Math.min(MAX_NUM, Math.max(1, Number(m[2]))) : 1;
  return { line, column };
}
