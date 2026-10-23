import { describe, expect, it } from "vitest";
import { fuzzyMatch, highlightSegments, rankFiles } from "./quickOpenLogic";

describe("fuzzyMatch", () => {
  it("順番に含まれていれば一致し、位置を返す", () => {
    const r = fuzzyMatch("sct", "src/main.ts");
    expect(r?.positions.map((i) => "src/main.ts"[i]).join("")).toBe("sct");
  });
  it("順番が違う・無い文字があれば null", () => {
    expect(fuzzyMatch("tsr", "src/a.ts")).toBeNull();
    expect(fuzzyMatch("xyz", "src/a.ts")).toBeNull();
    expect(fuzzyMatch("abcdef", "abc")).toBeNull();
  });
  it("大文字小文字を区別しない", () => {
    expect(fuzzyMatch("readme", "docs/README.md")).not.toBeNull();
    expect(fuzzyMatch("README", "readme.md")).not.toBeNull();
  });
  it("空の入力は常に一致(スコア0)", () => {
    expect(fuzzyMatch("", "a.ts")).toEqual({ score: 0, positions: [] });
  });
  it("日本語のファイル名にも一致する", () => {
    const r = fuzzyMatch("設計", "docs/設計メモ.md");
    expect(r?.positions).toEqual([5, 6]);
  });
  it("ファイル名への一致が、ディレクトリ名への一致より上", () => {
    expect(fuzzyMatch("app", "x/app/y/z.ts")!.score).toBeLessThan(fuzzyMatch("app", "x/y/z/app.ts")!.score);
  });
  it("連続一致が、散らばった一致より上", () => {
    expect(fuzzyMatch("main", "src/main.ts")!.score).toBeGreaterThan(fuzzyMatch("main", "src/m_a_i_n.ts")!.score);
  });
  it("同じ並びなら短いパスが上", () => {
    expect(fuzzyMatch("a.ts", "a.ts")!.score).toBeGreaterThan(fuzzyMatch("a.ts", "deep/er/a.ts")!.score);
  });
  it("ファイル名の先頭への一致を優先して位置を選ぶ", () => {
    const r = fuzzyMatch("ed", "editor/x/ed.ts")!;
    expect(r.positions).toEqual([9, 10]); // ディレクトリ名 editor より、ファイル名 ed.ts を優先
    const r2 = fuzzyMatch("ed", "a/b/editor.ts")!;
    expect(r2.positions).toEqual([4, 5]);
  });
});

describe("rankFiles", () => {
  const paths = ["README.md", "src/main.ts", "src/editor.ts", "docs/readme-ja.md"];
  it("空の入力は、最近のファイル(存在するものだけ)を先頭に、残りは元の順", () => {
    const r = rankFiles("", paths, ["src/editor.ts", "gone.ts", "src/editor.ts"]);
    expect(r.map((x) => x.relPath)).toEqual(["src/editor.ts", "README.md", "src/main.ts", "docs/readme-ja.md"]);
    expect(r[0].positions).toEqual([]);
  });
  it("入力があれば一致だけをスコア順に", () => {
    const r = rankFiles("readme", paths, []);
    expect(r.map((x) => x.relPath)).toEqual(["README.md", "docs/readme-ja.md"]);
  });
  it("一致なしは空", () => {
    expect(rankFiles("zzz", paths, [])).toEqual([]);
  });
});

describe("highlightSegments", () => {
  it("一致/非一致の連なりに分ける", () => {
    expect(highlightSegments("abcd", [0, 1, 3])).toEqual([
      { text: "ab", hit: true },
      { text: "c", hit: false },
      { text: "d", hit: true },
    ]);
  });
  it("位置が空なら全体が非一致", () => {
    expect(highlightSegments("abc", [])).toEqual([{ text: "abc", hit: false }]);
  });
});
