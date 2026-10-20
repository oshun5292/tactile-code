import type { SearchMatch, SearchOptions } from "../../api/types";

/** 検索結果の上限(バックエンドと同じ。モックでも同じ挙動にする) */
export const MAX_SEARCH_RESULTS = 2000;
const PREVIEW_MAX = 200;

const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);

/** 一致の開始位置(UTF-16 の添字)をすべて返す。重ならない一致だけ。 */
function findAll(line: string, query: string, { caseSensitive, wholeWord }: SearchOptions): number[] {
  if (query === "") return [];
  const hay = caseSensitive ? line : line.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i === -1) break;
    const before = hay[i - 1];
    const after = hay[i + needle.length];
    if (!wholeWord || (!isWordChar(before) && !isWordChar(after))) {
      out.push(i);
      from = i + needle.length;
    } else {
      from = i + 1;
    }
  }
  return out;
}

/** 長い行は、一致の周辺を切り出す(前後の空白は除く)。start は元の行での一致の開始(UTF-16)。 */
function makePreview(line: string, start: number): { text: string; offset: number } {
  const lead = line.length - line.trimStart().length;
  const trimmed = line.trim();
  const s = Math.max(0, start - lead); // 空白を除いた分だけ位置を引く
  if (trimmed.length <= PREVIEW_MAX) return { text: trimmed, offset: s };
  const from = Math.max(0, Math.min(s - 40, trimmed.length - PREVIEW_MAX));
  return { text: trimmed.slice(from, from + PREVIEW_MAX), offset: s - from };
}

/** 1ファイル分の本文から一致を集める(モック用。本番は Rust 側が同じ仕様で行う)。 */
export function searchText(relPath: string, content: string, query: string, options: SearchOptions, limit = MAX_SEARCH_RESULTS): SearchMatch[] {
  const out: SearchMatch[] = [];
  if (query === "") return out;
  const lines = content.split(/\r\n|\n/);
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    for (const i of findAll(line, query, options)) {
      if (out.length >= limit) return out;
      const pv = makePreview(line, i);
      out.push({
        relPath,
        line: n + 1,
        column: [...line.slice(0, i)].length,
        length: [...query].length,
        preview: pv.text,
        previewColumn: [...pv.text.slice(0, pv.offset)].length,
      });
    }
  }
  return out;
}

/** プレビューを「前/一致/後」に分ける。previewColumn・length は文字数(Unicode スカラー値)で、範囲外は丸める。 */
export function previewSegments(preview: string, previewColumn: number, length: number): { text: string; hit: boolean }[] {
  const from = scalarToUtf16(preview, previewColumn);
  const to = from + scalarToUtf16(preview.slice(from), length);
  const out = [
    { text: preview.slice(0, from), hit: false },
    { text: preview.slice(from, to), hit: true },
    { text: preview.slice(to), hit: false },
  ];
  return out.filter((s) => s.text !== "");
}

export type MatchGroup = { relPath: string; matches: SearchMatch[] };

/** ファイルごとにまとめる。順序は、最初に現れた順(バックエンドが自然順で返す)。 */
export function groupMatches(matches: SearchMatch[]): MatchGroup[] {
  const map = new Map<string, MatchGroup>();
  for (const m of matches) {
    const g = map.get(m.relPath);
    if (g) g.matches.push(m);
    else map.set(m.relPath, { relPath: m.relPath, matches: [m] });
  }
  return [...map.values()];
}

/** 「行頭からの文字数(Unicode スカラー値)」を、CodeMirror が使う UTF-16 の添字に直す。絵文字などで食い違うため。 */
export function scalarToUtf16(lineText: string, scalarCount: number): number {
  let units = 0;
  let n = 0;
  for (const ch of lineText) {
    if (n >= scalarCount) break;
    units += ch.length;
    n++;
  }
  return units;
}

/** 1始まりの行・0始まりの桁から、文書内の選択範囲 [from, to] を求める。範囲外は丸める。 */
export function revealRange(doc: { lines: number; line: (n: number) => { from: number; to: number; text: string } }, line: number, column: number, length: number) {
  const l = doc.line(Math.min(Math.max(line, 1), doc.lines));
  const from = Math.min(l.from + scalarToUtf16(l.text, column), l.to);
  const to = Math.min(from + scalarToUtf16(l.text.slice(from - l.from), length), l.to);
  return { from, to };
}

/** 入力欄に入れる検索語にしてよい選択か(空・複数行・長すぎるものは除く)。 */
export function seedFromSelection(sel: string): string | null {
  const t = sel.trim();
  if (t === "" || /[\r\n]/.test(t) || t.length > 200) return null;
  return t;
}
