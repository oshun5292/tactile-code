// 状態バー(画面下の1行)の純粋な処理。画面から切り離して Vitest で確認する。
import type { Eol } from "../../api/types";
import type { Tab } from "./editorLogic";

// ---------- カーソル位置 ----------

/** カーソル位置。line・column は 1 始まり(表示と同じ数え方)。 */
export type CursorInfo = { line: number; column: number; selectionLength: number };

export const sameCursor = (a: CursorInfo | undefined, b: CursorInfo): boolean =>
  !!a && a.line === b.line && a.column === b.column && a.selectionLength === b.selectionLength;

/** 「行 3, 桁 5」。選択があれば「行 3, 桁 5 (12 文字を選択)」。 */
export function formatPosition(c: CursorInfo): string {
  const base = `行 ${c.line}, 桁 ${c.column}`;
  return c.selectionLength > 0 ? `${base} (${c.selectionLength} 文字を選択)` : base;
}

// ---------- インデント ----------

export type IndentSetting = { kind: "spaces"; size: number } | { kind: "tab" };

/** メニューに並べる選択肢 */
export const INDENT_CHOICES: IndentSetting[] = [
  { kind: "spaces", size: 2 },
  { kind: "spaces", size: 4 },
  { kind: "spaces", size: 8 },
  { kind: "tab" },
];

export const indentLabel = (s: IndentSetting): string => (s.kind === "tab" ? "タブ" : `スペース: ${s.size}`);

export const sameIndent = (a: IndentSetting, b: IndentSetting): boolean =>
  a.kind === b.kind && (a.kind === "tab" || (b.kind === "spaces" && a.size === b.size));

const DETECT_MAX_LINES = 5000;

/**
 * ファイルの内容から、インデントを多数決で推定する。根拠が無ければ null(呼び出し側が言語の既定を使う)。
 * スペースは「前の行との字下げ幅の差」を数える。行頭の絶対幅で数えると、深い階層(8, 12…)に引きずられて幅を誤るため。
 */
export function detectIndent(text: string | null): IndentSetting | null {
  if (!text) return null;
  let tabLines = 0;
  let spaceLines = 0;
  const deltas = new Map<number, number>();
  let prev = 0;
  const lines = text.split("\n", DETECT_MAX_LINES);
  for (const raw of lines) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.trim() === "") continue; // 空行は字下げの根拠にしない
    if (line[0] === "\t") {
      tabLines++;
      prev = 0;
      continue;
    }
    let w = 0;
    while (line[w] === " ") w++;
    if (w > 0) spaceLines++;
    const d = Math.abs(w - prev);
    // 差が 1 は、コメントの「 *」などの位置合わせが大半。2〜8 だけを数える
    if (d >= 2 && d <= 8) deltas.set(d, (deltas.get(d) ?? 0) + 1);
    prev = w;
  }
  if (tabLines > spaceLines) return { kind: "tab" };
  if (spaceLines === 0 || tabLines === spaceLines) return null;
  let best = 0;
  let bestCount = 0;
  for (const [size, count] of deltas) {
    if (count > bestCount || (count === bestCount && size < best)) {
      best = size;
      bestCount = count;
    }
  }
  return best > 0 ? { kind: "spaces", size: best } : null;
}

/** 手動の指定 > 内容からの推定 > 言語の既定、の順で決める。 */
export function resolveIndent(manual: IndentSetting | null, detected: IndentSetting | null, langTabSize: number): IndentSetting {
  return manual ?? detected ?? { kind: "spaces", size: langTabSize };
}

/** CodeMirror に渡す値。タブ文字のときの表示幅は 4。 */
export function indentToCm(s: IndentSetting): { unit: string; tabSize: number } {
  return s.kind === "tab" ? { unit: "\t", tabSize: 4 } : { unit: " ".repeat(s.size), tabSize: s.size };
}

// ---------- 改行コード ----------

export const EOL_CHOICES: { eol: Eol; label: string }[] = [
  { eol: "lf", label: "LF" },
  { eol: "crlf", label: "CRLF" },
];

export const eolLabel = (e: Eol): string => (e === "crlf" ? "CRLF" : "LF");

/**
 * 改行コードを切り替えた後のタブ。本文(draft)は変えず、baseEol との差で「未保存」になる。
 * 保存したときに初めて、writeFile の eol 引数でファイルへ反映される。
 */
export function withEol(tab: Tab, eol: Eol): Tab {
  if (tab.kind !== "text" || tab.eol === eol) return tab;
  // 「保存済み」の表示は、変更が入ったので消す(保存中だけはそのまま)
  return { ...tab, eol, save: tab.save === "saving" ? "saving" : "idle", saveError: null };
}
