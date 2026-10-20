import { describe, expect, it } from "vitest";
import type { FileContent } from "../../api/types";
import { applyLoaded, isDirty, newTab } from "./editorLogic";
import { detectIndent, formatPosition, indentLabel, indentToCm, resolveIndent, sameCursor, sameIndent, withEol } from "./statusBarLogic";

const loaded = (content: string, eol: "lf" | "crlf" = "lf") =>
  applyLoaded(newTab("a.ts"), {
    relPath: "a.ts", kind: "text", content, size: content.length, modified: "t", eol, hasBom: false, encoding: "utf-8",
  } as FileContent);

describe("行・桁の表示", () => {
  it("選択なし", () => expect(formatPosition({ line: 3, column: 5, selectionLength: 0 })).toBe("行 3, 桁 5"));
  it("選択あり", () => expect(formatPosition({ line: 1, column: 1, selectionLength: 12 })).toBe("行 1, 桁 1 (12 文字を選択)"));
  it("同じ位置の判定", () => {
    expect(sameCursor({ line: 1, column: 2, selectionLength: 0 }, { line: 1, column: 2, selectionLength: 0 })).toBe(true);
    expect(sameCursor({ line: 1, column: 2, selectionLength: 0 }, { line: 1, column: 3, selectionLength: 0 })).toBe(false);
    expect(sameCursor(undefined, { line: 1, column: 1, selectionLength: 0 })).toBe(false);
  });
});

describe("インデントの自動判定", () => {
  it("2スペース", () => expect(detectIndent("a\n  b\n  c\n    d\n  e\n")).toEqual({ kind: "spaces", size: 2 }));
  it("4スペース(深い階層でも幅を誤らない)", () => {
    expect(detectIndent("def f():\n    if x:\n        y\n            z\n    w\n")).toEqual({ kind: "spaces", size: 4 });
  });
  it("タブ", () => expect(detectIndent("a\n\tb\n\t\tc\n\td\n")).toEqual({ kind: "tab" }));
  it("タブとスペースは多数決", () => {
    expect(detectIndent("a\n\tb\n\tc\n  d\n")).toEqual({ kind: "tab" });
    expect(detectIndent("a\n  b\n  c\n\td\n")).toEqual({ kind: "spaces", size: 2 });
  });
  it("同数・字下げ無し・空は null", () => {
    expect(detectIndent("a\n\tb\n  c\n")).toBeNull();
    expect(detectIndent("a\nb\n")).toBeNull();
    expect(detectIndent("")).toBeNull();
    expect(detectIndent(null)).toBeNull();
  });
  it("CRLF・空行・コメントの1スペースに惑わされない", () => {
    expect(detectIndent("/**\r\n * x\r\n */\r\nf\r\n\r\n    a\r\n    b\r\n")).toEqual({ kind: "spaces", size: 4 });
  });
});

describe("インデントの決定と表示", () => {
  it("手動 > 推定 > 言語の既定", () => {
    expect(resolveIndent({ kind: "tab" }, { kind: "spaces", size: 2 }, 4)).toEqual({ kind: "tab" });
    expect(resolveIndent(null, { kind: "spaces", size: 2 }, 4)).toEqual({ kind: "spaces", size: 2 });
    expect(resolveIndent(null, null, 4)).toEqual({ kind: "spaces", size: 4 });
  });
  it("表示とCodeMirror用の値", () => {
    expect(indentLabel({ kind: "spaces", size: 2 })).toBe("スペース: 2");
    expect(indentLabel({ kind: "tab" })).toBe("タブ");
    expect(indentToCm({ kind: "spaces", size: 8 })).toEqual({ unit: "        ", tabSize: 8 });
    expect(indentToCm({ kind: "tab" })).toEqual({ unit: "\t", tabSize: 4 });
    expect(sameIndent({ kind: "tab" }, { kind: "tab" })).toBe(true);
    expect(sameIndent({ kind: "spaces", size: 2 }, { kind: "spaces", size: 4 })).toBe(false);
  });
});

describe("改行コードの切り替え", () => {
  it("本文は変えず、未保存になる", () => {
    const t = loaded("a\nb");
    expect(isDirty(t)).toBe(false);
    const u = withEol(t, "crlf");
    expect(u.eol).toBe("crlf");
    expect(u.draft).toBe("a\nb");
    expect(isDirty(u)).toBe(true);
  });
  it("元に戻せば未保存でなくなる", () => expect(isDirty(withEol(withEol(loaded("a"), "crlf"), "lf"))).toBe(false));
  it("同じ値・テキスト以外は何もしない", () => {
    const t = loaded("a");
    expect(withEol(t, "lf")).toBe(t);
    const bin = { ...newTab("x.png"), kind: "binary" as const };
    expect(withEol(bin, "crlf")).toBe(bin);
  });
  it("保存済み表示を消す", () => expect(withEol({ ...loaded("a"), save: "saved" }, "crlf").save).toBe("idle"));
});
