import { describe, expect, it } from "vitest";
import { languageForFilename } from "./languages";

const id = (n: string) => languageForFilename(n).id;

describe("languageForFilename", () => {
  it("拡張子から言語を決める", () => {
    expect(id("a.ts")).toBe("typescript");
    expect(id("a.tsx")).toBe("tsx");
    expect(id("a.js")).toBe("javascript");
    expect(id("a.jsx")).toBe("jsx");
    expect(id("a.py")).toBe("python");
    expect(id("a.sql")).toBe("sql");
    expect(id("a.yml")).toBe("yaml");
    expect(id("a.yaml")).toBe("yaml");
    expect(id("a.json")).toBe("json");
    expect(id("a.css")).toBe("css");
    expect(id("a.html")).toBe("html");
    expect(id("a.md")).toBe("markdown");
    expect(id("a.rs")).toBe("rust");
    expect(id("a.sh")).toBe("shell");
    expect(id("Cargo.toml")).toBe("toml");
  });
  it("大文字小文字を区別しない", () => {
    expect(id("README.MD")).toBe("markdown");
    expect(id("Main.PY")).toBe("python");
  });
  it("複数ドットは最後の拡張子を見る", () => {
    expect(id("types.d.ts")).toBe("typescript");
    expect(id("a.test.tsx")).toBe("tsx");
    expect(id("archive.tar.gz")).toBe("plaintext");
  });
  it("拡張子なし・未知はプレーンテキスト", () => {
    expect(id("LICENSE")).toBe("plaintext");
    expect(id("a.xyz")).toBe("plaintext");
    expect(id("")).toBe("plaintext");
    expect(languageForFilename("LICENSE").extension).toBeUndefined();
    expect(languageForFilename("LICENSE").label).toBe("その他");
  });
  it("Dockerfile とドットファイル", () => {
    expect(id("Dockerfile")).toBe("shell");
    expect(id("docker/Dockerfile")).toBe("shell");
    expect(id(".gitignore")).toBe("shell");
  });
  it("パス区切りを含んでも動く", () => {
    expect(id("models/staging/stg_orders.sql")).toBe("sql");
    expect(id("src\a.rs")).toBe("rust");
  });
  it("言語の extension とタブ幅", () => {
    expect(languageForFilename("a.py").extension).toBeDefined();
    expect(languageForFilename("a.sql").extension).toBeDefined();
    expect(languageForFilename("a.py").tabSize).toBe(4);
    expect(languageForFilename("a.ts").tabSize).toBe(2);
  });
  it("マークダウンは GFM(表・取り消し線)入りの extension を作れる", () => {
    expect(languageForFilename("note.md").extension).toBeDefined();
  });
});
