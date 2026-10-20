import { describe, expect, it } from "vitest";
import { groupMatches, previewSegments, revealRange, scalarToUtf16, searchText, seedFromSelection } from "./searchLogic";

const opt = { caseSensitive: false, wholeWord: false };

describe("searchText", () => {
  it("行・桁・長さを返す(行は1始まり、桁は0始まり)", () => {
    const m = searchText("a.ts", "foo\n  bar foo\n", "foo", opt);
    expect(m.map((x) => [x.line, x.column, x.length])).toEqual([[1, 0, 3], [2, 6, 3]]);
  });
  it("大文字小文字の区別を切り替えられる", () => {
    expect(searchText("a", "Foo", "foo", opt)).toHaveLength(1);
    expect(searchText("a", "Foo", "foo", { ...opt, caseSensitive: true })).toHaveLength(0);
  });
  it("単語単位は前後が英数字・_ でない一致だけ", () => {
    const w = { ...opt, wholeWord: true };
    expect(searchText("a", "foo foobar _foo foo.", "foo", w).map((x) => x.column)).toEqual([0, 16]);
  });
  it("日本語と、CRLF の行にも使える", () => {
    const m = searchText("a.md", "設計メモ\r\n次の設計\r\n", "設計", opt);
    expect(m.map((x) => [x.line, x.column, x.preview])).toEqual([[1, 0, "設計メモ"], [2, 2, "次の設計"]]);
  });
  it("桁は絵文字を1文字と数える", () => {
    expect(searchText("a", "😀x", "x", opt)[0].column).toBe(1);
  });
  it("空のクエリは空、上限で打ち切る", () => {
    expect(searchText("a", "x", "", opt)).toEqual([]);
    expect(searchText("a", "x x x x", "x", opt, 2)).toHaveLength(2);
  });
  it("プレビューは前後の空白を除き、長い行は200文字までにして一致を含める", () => {
    expect(searchText("a", "   hello  ", "hello", opt)[0].preview).toBe("hello");
    const long = "a".repeat(500) + "NEEDLE" + "b".repeat(500);
    const p = searchText("a", long, "needle", opt)[0].preview;
    expect(p.length).toBeLessThanOrEqual(200);
    expect(p).toContain("NEEDLE");
  });
});

describe("previewSegments", () => {
  it("previewColumn と length で一致を分ける", () => {
    expect(previewSegments("a Foo b", 2, 3)).toEqual([
      { text: "a ", hit: false }, { text: "Foo", hit: true }, { text: " b", hit: false },
    ]);
  });
  it("先頭の空白を除いたプレビューでも、元の桁とずれずに強調できる", () => {
    const m = searchText("a", "      hello world", "world", opt)[0];
    expect(m.column).toBe(12);
    expect(m.previewColumn).toBe(6);
    expect(previewSegments(m.preview, m.previewColumn, m.length).find((s) => s.hit)?.text).toBe("world");
  });
  it("長い行を切り出しても強調位置が合う", () => {
    const m = searchText("a", "x".repeat(500) + "NEEDLE" + "y".repeat(500), "needle", opt)[0];
    expect(previewSegments(m.preview, m.previewColumn, m.length).find((s) => s.hit)?.text).toBe("NEEDLE");
  });
  it("絵文字の後ろでも合う", () => {
    const m = searchText("a", "😀😀 abc", "abc", opt)[0];
    expect(previewSegments(m.preview, m.previewColumn, m.length).find((s) => s.hit)?.text).toBe("abc");
  });
  it("範囲外は丸める", () => {
    expect(previewSegments("abc", 10, 3)).toEqual([{ text: "abc", hit: false }]);
  });
});

describe("groupMatches", () => {
  it("ファイルごとにまとめ、順序を保つ", () => {
    const mk = (relPath: string, line: number) => ({ relPath, line, column: 0, length: 1, preview: "", previewColumn: 0 });
    const g = groupMatches([mk("a", 1), mk("a", 3), mk("b", 2)]);
    expect(g.map((x) => [x.relPath, x.matches.length])).toEqual([["a", 2], ["b", 1]]);
  });
});

describe("scalarToUtf16 / revealRange / seedFromSelection", () => {
  it("絵文字を含む行で UTF-16 の添字に直す", () => {
    expect(scalarToUtf16("😀ab", 1)).toBe(2);
    expect(scalarToUtf16("ab", 10)).toBe(2);
  });
  it("選択範囲を行内に丸める", () => {
    const text = "😀abc";
    const doc = { lines: 1, line: () => ({ from: 10, to: 10 + text.length, text }) };
    expect(revealRange(doc, 1, 1, 2)).toEqual({ from: 12, to: 14 });
    expect(revealRange(doc, 9, 99, 5)).toEqual({ from: 15, to: 15 });
  });
  it("複数行・空の選択は検索語にしない", () => {
    expect(seedFromSelection(" foo ")).toBe("foo");
    expect(seedFromSelection("a\nb")).toBeNull();
    expect(seedFromSelection("  ")).toBeNull();
  });
});
