import { describe, expect, it } from "vitest";
import type { FileContent, FsEntry } from "../../api/types";
import {
  absolutePathOf,
  ancestorsOf,
  applyLoaded,
  baseName,
  bomForEncoding,
  canReopenWithEncoding,
  canSaveWithEncoding,
  encodingChoices,
  encodingLabel,
  needsWriteForEncoding,
  newTab,
  closeTabIn,
  creationParent,
  dirtyTabs,
  dropFromDirsCache,
  discardDirtyTabs,
  emptySession,
  extensionOf,
  formatBytes,
  iconForFile,
  isDirty,
  isMarkdownFile,
  isSameOrInside,
  joinPath,
  judgeExternal,
  neighborTab,
  openTabIn,
  parentPath,
  planRestore,
  pollTargets,
  remapDirsCache,
  remapPath,
  removeFromSession,
  renameInSession,
  tabsUnder,
  validateEntryName,
  buildSessionData,
  toggleExpanded,
  unopenableReason,
  updateTab,
  visibleRows,
  type TreeDir,
} from "./editorLogic";

const file = (relPath: string, content = "a"): FileContent => ({
  relPath,
  kind: "text",
  content,
  size: 1,
  modified: "2026-10-20T00:00:00.000000000+09:00",
  eol: "lf",
  hasBom: false,
  encoding: "utf-8",
});

describe("パス", () => {
  it("親フォルダ", () => {
    expect(parentPath("src/a/b.ts")).toBe("src/a");
    expect(parentPath("src")).toBe("");
    expect(parentPath("")).toBe("");
  });
  it("祖先フォルダ", () => {
    expect(ancestorsOf("a/b/c.ts")).toEqual(["a", "a/b"]);
    expect(ancestorsOf("c.ts")).toEqual([]);
  });
  it("ファイル名と拡張子", () => {
    expect(baseName("src/a/b.ts")).toBe("b.ts");
    expect(extensionOf("src/Main.RS")).toBe("rs");
    expect(extensionOf("a.test.tsx")).toBe("tsx");
    expect(extensionOf(".gitignore")).toBe("");
    expect(extensionOf("Dockerfile")).toBe("");
  });
  it("マークダウン判定", () => {
    expect(isMarkdownFile("a/README.md")).toBe(true);
    expect(isMarkdownFile("x.mdx")).toBe(true);
    expect(isMarkdownFile("x.txt")).toBe(false);
  });
});

describe("アイコン", () => {
  it("拡張子ごとに略称と言語", () => {
    expect(iconForFile("a.tsx")).toEqual({ abbr: "TS", language: "TypeScript" });
    expect(iconForFile("a.py")).toEqual({ abbr: "PY", language: "Python" });
    expect(iconForFile("stg.sql")).toEqual({ abbr: "SQ", language: "SQL" });
    expect(iconForFile("a.rs")).toEqual({ abbr: "RS", language: "Rust" });
    expect(iconForFile("README.md")).toEqual({ abbr: "MD", language: "Markdown" });
  });
  it("未知の拡張子は「その他」", () => {
    expect(iconForFile("a.xyz")).toEqual({ abbr: "·", language: "その他" });
  });
});

describe("表示用", () => {
  it("サイズ", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(48_300_000)).toBe("46.1 MB");
  });
  it("開けない理由", () => {
    expect(unopenableReason({ kind: "binary", size: 1 })).toContain("文字ではない");
    expect(unopenableReason({ kind: "tooLarge", size: 3_000_000 })).toContain("2 MB");
    expect(unopenableReason({ kind: "unsupportedEncoding", size: 1 })).toContain("判別できません");
    expect(unopenableReason({ kind: "text", size: 1 })).toBe("");
  });
});

describe("タブ", () => {
  it("開く: 新しいタブは右に足してアクティブ。同じファイルは増えない", () => {
    let s = openTabIn(emptySession(), "a.md");
    s = openTabIn(s, "b.ts");
    s = openTabIn(s, "a.md");
    expect(s.tabs.map((t) => t.relPath)).toEqual(["a.md", "b.ts"]);
    expect(s.active).toBe("a.md");
  });
  it("閉じる: アクティブを閉じたら右隣、右が無ければ左隣、最後は null", () => {
    let s = emptySession();
    for (const p of ["a", "b", "c"]) s = openTabIn(s, p);
    s = { ...s, active: "b" };
    s = closeTabIn(s, "b");
    expect(s.active).toBe("c");
    s = closeTabIn(s, "c");
    expect(s.active).toBe("a");
    s = closeTabIn(s, "a");
    expect(s.active).toBeNull();
    expect(s.tabs).toEqual([]);
  });
  it("閉じる: アクティブでないタブを閉じても、アクティブは変わらない", () => {
    let s = openTabIn(openTabIn(emptySession(), "a"), "b");
    s = closeTabIn(s, "a");
    expect(s.active).toBe("b");
  });
  it("未保存の判定: 読んだ直後は未保存でない。編集すると未保存、元に戻すと未保存でなくなる", () => {
    let s = openTabIn(emptySession(), "a.md");
    s = updateTab(s, "a.md", (t) => applyLoaded(t, file("a.md", "hello")));
    expect(isDirty(s.tabs[0])).toBe(false);
    s = updateTab(s, "a.md", { draft: "hello!" });
    expect(isDirty(s.tabs[0])).toBe(true);
    expect(dirtyTabs(s)).toHaveLength(1);
    s = updateTab(s, "a.md", { draft: "hello" });
    expect(isDirty(s.tabs[0])).toBe(false);
  });
  it("開けないファイル(text 以外)は未保存にならない", () => {
    let s = openTabIn(emptySession(), "x.png");
    s = updateTab(s, "x.png", (t) => applyLoaded(t, { ...file("x.png"), kind: "binary", content: null }));
    expect(isDirty(s.tabs[0])).toBe(false);
  });
  it("再読み込み(applyLoaded)で編集内容は捨てられ、日時が入れ替わる", () => {
    let s = openTabIn(emptySession(), "a.md");
    s = updateTab(s, "a.md", (t) => applyLoaded(t, file("a.md", "v1")));
    s = updateTab(s, "a.md", { draft: "edited" });
    s = updateTab(s, "a.md", (t) => applyLoaded(t, { ...file("a.md", "v2"), modified: "new" }));
    expect(s.tabs[0].draft).toBe("v2");
    expect(s.tabs[0].modified).toBe("new");
    expect(isDirty(s.tabs[0])).toBe(false);
  });
  it("保存せず閉じる: 未保存のタブだけが消える", () => {
    let s = emptySession();
    for (const p of ["a", "b"]) {
      s = openTabIn(s, p);
      s = updateTab(s, p, (t) => applyLoaded(t, file(p, "x")));
    }
    s = updateTab(s, "a", { draft: "changed" });
    s = discardDirtyTabs(s);
    expect(s.tabs.map((t) => t.relPath)).toEqual(["b"]);
    expect(s.active).toBe("b");
  });
  it("左右の隣(折り返す)", () => {
    let s = emptySession();
    for (const p of ["a", "b", "c"]) s = openTabIn(s, p);
    expect(neighborTab(s, 1)).toBe("a"); // 最後の c から右へ
    expect(neighborTab(s, -1)).toBe("b");
    expect(neighborTab(emptySession(), 1)).toBeNull();
  });
});

describe("ツリー", () => {
  const e = (name: string, kind: "dir" | "file", parent = ""): FsEntry => ({
    name,
    relPath: parent ? `${parent}/${name}` : name,
    kind,
    size: 0,
    modified: null,
  });
  const ready = (entries: FsEntry[]): TreeDir => ({ status: "ready", entries, error: null });

  it("開閉の切り替え", () => {
    expect(toggleExpanded([], "src")).toEqual(["src"]);
    expect(toggleExpanded(["src", "docs"], "src")).toEqual(["docs"]);
  });
  it("読み込み前のルートは「読み込み中」の行", () => {
    const rows = visibleRows({}, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "status", status: "loading" });
  });
  it("開いたフォルダの中身が、その場に入る", () => {
    const dirs = {
      "": ready([e("src", "dir"), e("README.md", "file")]),
      src: ready([e("a.ts", "file", "src")]),
    };
    expect(visibleRows(dirs, []).map((r) => (r.type === "entry" ? r.entry.relPath : r.key))).toEqual(["src", "README.md"]);
    const open = visibleRows(dirs, ["src"]);
    expect(open.map((r) => (r.type === "entry" ? r.entry.relPath : r.key))).toEqual(["src", "src/a.ts", "README.md"]);
    expect(open[1]).toMatchObject({ depth: 1 });
  });
  it("空フォルダ・読み込み中・エラーの行", () => {
    const dirs: Record<string, TreeDir> = {
      "": ready([e("a", "dir"), e("b", "dir"), e("c", "dir")]),
      a: ready([]),
      b: { status: "loading", entries: [], error: null },
      c: { status: "error", entries: [], error: "権限がありません" },
    };
    const rows = visibleRows(dirs, ["a", "b", "c"]);
    const statuses = rows.filter((r) => r.type === "status").map((r) => (r.type === "status" ? r.status : ""));
    expect(statuses).toEqual(["empty", "loading", "error"]);
  });
});

describe("外部変更の判定", () => {
  const ready = (modified: string, draft?: string) => {
    const t = applyLoaded(openTabIn(emptySession(), "a.ts").tabs[0], { ...file("a.ts"), modified });
    return draft === undefined ? t : { ...t, draft };
  };
  const stat = (modified: string | null, exists = true) => ({ relPath: "a.ts", exists, modified });

  it("同じ更新日時なら何もしない", () => {
    expect(judgeExternal(ready("t1"), stat("t1"))).toBe("none");
  });
  it("未保存が無ければ読み直す", () => {
    expect(judgeExternal(ready("t1"), stat("t2"))).toBe("reload");
  });
  it("未保存があれば上書きせず印だけ", () => {
    expect(judgeExternal(ready("t1", "edited"), stat("t2"))).toBe("mark-changed");
  });
  it("消えたら印(タブは閉じない)", () => {
    expect(judgeExternal(ready("t1"), stat(null, false))).toBe("mark-deleted");
  });
  it("削除の印は、同じ更新日時で戻ったら外す", () => {
    expect(judgeExternal({ ...ready("t1"), external: "deleted" }, stat("t1"))).toBe("clear");
  });
  it("読み込み中・失敗のタブは対象外", () => {
    expect(judgeExternal(openTabIn(emptySession(), "a.ts").tabs[0], stat("t2"))).toBe("none");
  });
  it("modified が null なら判断しない", () => {
    expect(judgeExternal(ready("t1"), stat(null))).toBe("none");
  });
  it("保存中のタブは問い合わせない", () => {
    let s = openTabIn(openTabIn(emptySession(), "a.ts"), "b.ts");
    s = updateTab(s, "a.ts", { status: "ready", save: "saving", modified: "t1" });
    s = updateTab(s, "b.ts", { status: "ready", modified: "t2" });
    expect(pollTargets(s)).toEqual([{ relPath: "b.ts", modified: "t2" }]);
  });
  it("問い合わせは最大件数で切る", () => {
    let s = emptySession();
    for (let i = 0; i < 5; i++) s = updateTab(openTabIn(s, `f${i}`), `f${i}`, { status: "ready" });
    expect(pollTargets(s, 3)).toHaveLength(3);
  });
});

describe("タブの復元", () => {
  it("保存データを組み立てる(表示モードは保存用の名前に)", () => {
    let s = openTabIn(openTabIn(emptySession(), "a.md", "preview"), "src/b.ts", "edit");
    s = { ...s, expanded: ["src"] };
    expect(buildSessionData(s)).toEqual({
      tabs: [
        { relPath: "a.md", mdMode: "read" },
        { relPath: "src/b.ts", mdMode: "write" },
      ],
      active: "src/b.ts",
      expanded: ["src"],
    });
  });
  it("存在するファイルだけ復元し、重複は捨てる", () => {
    const plan = planRestore(
      {
        tabs: [
          { relPath: "a.md", mdMode: "read" },
          { relPath: "gone.ts", mdMode: "write" },
          { relPath: "a.md", mdMode: "split" },
        ],
        active: "a.md",
        expanded: ["src", "src"],
      },
      [
        { relPath: "a.md", exists: true, modified: "t" },
        { relPath: "gone.ts", exists: false, modified: null },
      ],
    );
    expect(plan).toEqual({ tabs: [{ relPath: "a.md", mdMode: "preview" }], active: "a.md", expanded: ["src"] });
  });
  it("アクティブが消えていたら、最後のタブに", () => {
    const plan = planRestore(
      { tabs: [{ relPath: "a", mdMode: "split" }, { relPath: "b", mdMode: "split" }], active: "gone", expanded: [] },
      [
        { relPath: "a", exists: true, modified: "t" },
        { relPath: "b", exists: true, modified: "t" },
      ],
    );
    expect(plan.active).toBe("b");
  });
  it("保存が無ければ空", () => {
    expect(planRestore(null, [])).toEqual({ tabs: [], active: null, expanded: [] });
  });
  it("保存データの組み立ては上限で切る", () => {
    let s = emptySession();
    for (let i = 0; i < 205; i++) s = openTabIn(s, `f${i}`);
    expect(buildSessionData(s).tabs).toHaveLength(200);
  });
});

describe("ファイル操作: パス", () => {
  it("joinPath / isSameOrInside / remapPath", () => {
    expect(joinPath("", "a.ts")).toBe("a.ts");
    expect(joinPath("src", "a.ts")).toBe("src/a.ts");
    expect(isSameOrInside("src/a.ts", "src")).toBe(true);
    expect(isSameOrInside("src", "src")).toBe(true);
    expect(isSameOrInside("srcx/a.ts", "src")).toBe(false); // 前方一致だけでは配下にしない
    expect(isSameOrInside("a", "")).toBe(true);
    expect(remapPath("src/a.ts", "src", "lib")).toBe("lib/a.ts");
    expect(remapPath("src", "src", "lib")).toBe("lib");
    expect(remapPath("srcx/a.ts", "src", "lib")).toBe("srcx/a.ts");
  });

  it("creationParent: フォルダ選択ならその中、ファイルなら親、なければルート", () => {
    expect(creationParent({ relPath: "src", kind: "dir" })).toBe("src");
    expect(creationParent({ relPath: "src/a.ts", kind: "file" })).toBe("src");
    expect(creationParent({ relPath: "README.md", kind: "file" })).toBe("");
    expect(creationParent(null)).toBe("");
  });

  it("absolutePathOf: プロジェクトの区切りに合わせる", () => {
    expect(absolutePathOf("C:\\p\\app", "src/a.ts")).toBe("C:\\p\\app\\src\\a.ts");
    expect(absolutePathOf("/home/u/app/", "src/a.ts")).toBe("/home/u/app/src/a.ts");
    expect(absolutePathOf("C:\\p\\app", "")).toBe("C:\\p\\app");
  });
});

describe("validateEntryName", () => {
  it("正常な名前は null", () => {
    expect(validateEntryName("a.ts", ["b.ts"])).toBeNull();
    expect(validateEntryName(".gitignore")).toBeNull();
  });
  it("空・区切り・禁止文字・末尾のドット・予約名を弾く", () => {
    expect(validateEntryName("")).not.toBeNull();
    expect(validateEntryName("   ")).not.toBeNull();
    expect(validateEntryName("..")).not.toBeNull();
    expect(validateEntryName("a/b")).not.toBeNull();
    expect(validateEntryName("a:b")).not.toBeNull();
    expect(validateEntryName("a.")).not.toBeNull();
    expect(validateEntryName("NUL.txt")).not.toBeNull();
  });
  it("同じフォルダの名前とは、大文字小文字を区別せず重複扱い", () => {
    expect(validateEntryName("README.md", ["readme.md"])).toBe("同じ名前がすでにあります。");
  });
});

describe("名前変更・削除とタブ", () => {
  const open = (paths: string[], active: string, expanded: string[] = []) => {
    let s = emptySession();
    for (const p of paths) s = openTabIn(s, p);
    return { ...s, active, expanded };
  };

  it("ファイルの名前変更: タブとアクティブが付け替わり、未保存の編集は保たれる", () => {
    const base = open(["a.ts", "b.ts"], "a.ts");
    const s0 = updateTab(base, "a.ts", (t) => ({ ...applyLoaded(t, file("a.ts", "old")), draft: "edited" }));
    const s = renameInSession(s0, "a.ts", "c.ts");
    expect(s.tabs.map((t) => t.relPath)).toEqual(["c.ts", "b.ts"]);
    expect(s.active).toBe("c.ts");
    expect(s.tabs[0].draft).toBe("edited");
    expect(isDirty(s.tabs[0])).toBe(true);
  });

  it("フォルダの名前変更: 配下のタブと展開状態をまとめて付け替える(似た名前は触らない)", () => {
    const s0 = open(["src/a.ts", "src/x/b.ts", "srcx/c.ts"], "src/x/b.ts", ["src", "src/x", "srcx"]);
    const s = renameInSession(s0, "src", "lib");
    expect(s.tabs.map((t) => t.relPath)).toEqual(["lib/a.ts", "lib/x/b.ts", "srcx/c.ts"]);
    expect(s.active).toBe("lib/x/b.ts");
    expect(s.expanded).toEqual(["lib", "lib/x", "srcx"]);
  });

  it("tabsUnder / removeFromSession: フォルダの削除で配下のタブをすべて閉じる", () => {
    const s0 = open(["src/a.ts", "src/b.ts", "keep.ts"], "src/b.ts", ["src", "other"]);
    expect(tabsUnder(s0, "src").length).toBe(2);
    const s = removeFromSession(s0, "src");
    expect(s.tabs.map((t) => t.relPath)).toEqual(["keep.ts"]);
    expect(s.active).toBe("keep.ts");
    expect(s.expanded).toEqual(["other"]);
  });

  it("ファイル削除: アクティブでないタブを消してもアクティブは変わらない", () => {
    const s = removeFromSession(open(["a.ts", "b.ts"], "a.ts"), "b.ts");
    expect(s.active).toBe("a.ts");
  });
});

describe("フォルダ一覧のキャッシュ", () => {
  const ent = (relPath: string, kind: "dir" | "file"): FsEntry => ({ name: baseName(relPath), relPath, kind, size: 0, modified: null });
  const dirs: Record<string, TreeDir> = {
    "": { status: "ready", entries: [ent("src", "dir"), ent("a.md", "file")], error: null },
    src: { status: "ready", entries: [ent("src/x.ts", "file")], error: null },
  };

  it("remapDirsCache: キーと中身のパス・名前が付け替わる", () => {
    const m = remapDirsCache(dirs, "src", "lib");
    expect(Object.keys(m).sort()).toEqual(["", "lib"]);
    expect(m[""].entries[0]).toMatchObject({ relPath: "lib", name: "lib" });
    expect(m.lib.entries[0].relPath).toBe("lib/x.ts");
  });

  it("dropFromDirsCache: 配下を捨て、親の一覧からも外す", () => {
    const m = dropFromDirsCache(dirs, "src");
    expect(Object.keys(m)).toEqual([""]);
    expect(m[""].entries.map((e) => e.relPath)).toEqual(["a.md"]);
  });
});

describe("文字コード(3b-3)", () => {
  const ready = (over: Partial<FileContent> = {}) => applyLoaded(newTab("a.txt"), { ...file("a.txt"), ...over });

  it("読み込み結果の文字コードをタブに持つ", () => {
    expect(newTab("a.txt").encoding).toBe("utf-8");
    expect(ready({ encoding: "shift_jis" }).encoding).toBe("shift_jis");
  });
  it("text 以外を読み直したら、前の文字コードを引きずらない", () => {
    const t = ready({ encoding: "shift_jis" });
    const u = applyLoaded(t, { ...file("a.txt"), kind: "unsupportedEncoding", content: null, encoding: "utf-8" });
    expect(u.encoding).toBe("utf-8");
    expect(u.draft).toBeNull();
  });
  it("表示名は大文字", () => {
    expect(encodingLabel("utf-8")).toBe("UTF-8");
    expect(encodingLabel("shift_jis")).toBe("SHIFT_JIS");
  });
  it("一覧は9種で、現在のものに印が付く", () => {
    const list = encodingChoices("euc-jp");
    expect(list).toHaveLength(9);
    expect(list.filter((c) => c.current).map((c) => c.encoding)).toEqual(["euc-jp"]);
    expect(encodingChoices(null).some((c) => c.current)).toBe(false);
  });
  it("再度開く・保存できる条件", () => {
    expect(canReopenWithEncoding(ready())).toBe(true);
    expect(canReopenWithEncoding(newTab("a.txt"))).toBe(false); // 読み込み中
    const unsupported = applyLoaded(newTab("a.txt"), { ...file("a.txt"), kind: "unsupportedEncoding", content: null });
    expect(canReopenWithEncoding(unsupported)).toBe(true);
    expect(canSaveWithEncoding(unsupported)).toBe(false);
    const binary = applyLoaded(newTab("a.bin"), { ...file("a.bin"), kind: "binary", content: null });
    expect(canReopenWithEncoding(binary)).toBe(false);
    expect(canSaveWithEncoding(ready())).toBe(true);
    expect(canSaveWithEncoding({ ...ready(), save: "saving" })).toBe(false);
  });
  it("BOM: UTF-16 へは必ず付け、UTF-16 から出るときは外す", () => {
    expect(bomForEncoding("utf-8", "utf-16le", false)).toBe(true);
    expect(bomForEncoding("utf-16be", "utf-16be", true)).toBe(true);
    expect(bomForEncoding("utf-16le", "utf-8", true)).toBe(false);
    expect(bomForEncoding("utf-8", "shift_jis", true)).toBe(true);
    expect(bomForEncoding("utf-8", "utf-8", false)).toBe(false);
  });
  it("内容が同じでも、文字コードが違えば書き直しが要る", () => {
    expect(needsWriteForEncoding(ready(), "utf-8")).toBe(false);
    expect(needsWriteForEncoding(ready(), "shift_jis")).toBe(true);
  });
});
