import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, FONT_DEFAULT, FONT_MAX, FONT_MIN, clampFontSize, normalizeSettings, parseGoto, stepFontSize } from "./settingsLogic";

describe("clampFontSize / stepFontSize", () => {
  it("範囲内に丸める", () => {
    expect(clampFontSize(5)).toBe(FONT_MIN);
    expect(clampFontSize(99)).toBe(FONT_MAX);
    expect(clampFontSize(13.6)).toBe(14);
    expect(clampFontSize(NaN)).toBe(FONT_DEFAULT);
  });
  it("1段階=1px で、端で止まる", () => {
    expect(stepFontSize(13, 1)).toBe(14);
    expect(stepFontSize(13, -1)).toBe(12);
    expect(stepFontSize(FONT_MAX, 1)).toBe(FONT_MAX);
    expect(stepFontSize(FONT_MIN, -1)).toBe(FONT_MIN);
  });
});

describe("normalizeSettings", () => {
  it("null や欠けた項目は既定値", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ wordWrap: true })).toEqual({ ...DEFAULT_SETTINGS, wordWrap: true });
  });
  it("範囲外・不正な値は安全な値にする", () => {
    const s = normalizeSettings({ fontSize: 100, autoSave: "bogus" as never, autoSaveDelayMs: 5 });
    expect(s.fontSize).toBe(FONT_MAX);
    expect(s.autoSave).toBe("off");
    expect(s.autoSaveDelayMs).toBe(200);
  });
});

describe("parseGoto", () => {
  it("行だけ", () => expect(parseGoto("12")).toEqual({ line: 12, column: 1 }));
  it("行:桁", () => expect(parseGoto("12:5")).toEqual({ line: 12, column: 5 }));
  it("前後と区切りの空白を許す", () => expect(parseGoto(" 12 : 5 ")).toEqual({ line: 12, column: 5 }));
  it("全角の数字とコロン", () => expect(parseGoto("１２：５")).toEqual({ line: 12, column: 5 }));
  it("桁が空なら1桁目", () => expect(parseGoto("7:")).toEqual({ line: 7, column: 1 }));
  it("0 は1に丸める", () => expect(parseGoto("0:0")).toEqual({ line: 1, column: 1 }));
  it("巨大な数は上限で止める", () => expect(parseGoto("99999999999999999999")?.line).toBe(1_000_000_000));
  it("解析できない入力は null", () => {
    expect(parseGoto("")).toBeNull();
    expect(parseGoto("abc")).toBeNull();
    expect(parseGoto("-3")).toBeNull();
    expect(parseGoto("1:2:3")).toBeNull();
    expect(parseGoto("1.5")).toBeNull();
  });
});
