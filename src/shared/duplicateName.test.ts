import { describe, expect, it } from "vitest";
import { duplicateName } from "./duplicateName";

describe("duplicateName", () => {
  it("拡張子の前に copy を入れる", () => {
    expect(duplicateName("foo.ts", ["foo.ts"])).toBe("foo copy.ts");
  });
  it("空いている最初の連番を選ぶ", () => {
    expect(duplicateName("foo.ts", ["foo.ts", "foo copy.ts"])).toBe("foo copy 2.ts");
    expect(duplicateName("foo.ts", ["foo.ts", "foo copy.ts", "foo copy 2.ts"])).toBe("foo copy 3.ts");
    expect(duplicateName("foo.ts", ["foo.ts", "foo copy 2.ts"])).toBe("foo copy.ts");
  });
  it("拡張子なし・フォルダ", () => {
    expect(duplicateName("Makefile", ["Makefile"])).toBe("Makefile copy");
    expect(duplicateName("src", ["src", "src copy"])).toBe("src copy 2");
  });
  it("ドット始まりは拡張子ではない", () => {
    expect(duplicateName(".env", [".env"])).toBe(".env copy");
    expect(duplicateName(".env.local", [])).toBe(".env copy.local");
  });
  it("複数ドットは最後のドットから", () => {
    expect(duplicateName("a.tar.gz", [])).toBe("a.tar copy.gz");
  });
  it("大文字小文字違いも衝突とみなす・日本語と空白", () => {
    expect(duplicateName("Foo.ts", ["FOO COPY.ts"])).toBe("Foo copy 2.ts");
    expect(duplicateName("メモ 1.md", [])).toBe("メモ 1 copy.md");
  });
});
