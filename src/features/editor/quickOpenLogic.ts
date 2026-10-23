// Ctrl+P(クイックオープン)の曖昧一致。画面に依存しない純粋関数だけを置く(テストしやすくするため)。

export type FuzzyResult = {
  score: number;
  /** 一致した文字の位置(path の UTF-16 インデックス、昇順)。強調表示に使う */
  positions: number[];
};

const MAX_QUERY = 64; // DP の計算量を抑える上限(これ以上は実用上打たない)
const SEPARATORS = new Set(["/", "\\", ".", "_", "-", " "]);

const same = (a: string, b: string) => a === b || a.toLowerCase() === b.toLowerCase();

/** query の文字が path に順番に含まれていれば一致(大文字小文字は区別しない)。一致しなければ null。 */
export function fuzzyMatch(query: string, path: string): FuzzyResult | null {
  const q = query.replace(/\s+/g, "").slice(0, MAX_QUERY);
  const n = path.length;
  const m = q.length;
  if (m === 0) return { score: 0, positions: [] };
  if (m > n) return null;

  // 先に「順番に含まれるか」だけを安く判定する(5万件を毎回 DP にかけないため)
  let qi = 0;
  for (let j = 0; j < n && qi < m; j++) if (same(q[qi], path[j])) qi++;
  if (qi < m) return null;

  const baseStart = path.lastIndexOf("/") + 1;
  // その位置に一致したときの加点: ファイル名部分・区切り直後(単語の頭)・先頭を優先
  const charScore = (j: number) => {
    let s = 1;
    if (j >= baseStart) s += 4;
    if (j === 0 || SEPARATORS.has(path[j - 1])) s += 3;
    if (j === baseStart) s += 4;
    return s;
  };
  const CONSECUTIVE = 6;
  const NEG = -1e9;

  // best[i][j] = q[i] を path[j] に当てたときの最高点。parent で位置を復元する
  const best: number[][] = [];
  const parent: number[][] = [];
  for (let i = 0; i < m; i++) {
    best.push(new Array<number>(n).fill(NEG));
    parent.push(new Array<number>(n).fill(-1));
  }
  for (let j = 0; j < n; j++) if (same(q[0], path[j])) best[0][j] = charScore(j);
  for (let i = 1; i < m; i++) {
    let runMax = NEG; // best[i-1][0..j-2] の最大(連続でない前の一致)
    let runArg = -1;
    for (let j = 1; j < n; j++) {
      if (j >= 2 && best[i - 1][j - 2] > runMax) {
        runMax = best[i - 1][j - 2];
        runArg = j - 2;
      }
      if (!same(q[i], path[j])) continue;
      let cand = NEG;
      let from = -1;
      if (runMax > NEG) {
        cand = runMax;
        from = runArg;
      }
      if (best[i - 1][j - 1] > NEG && best[i - 1][j - 1] + CONSECUTIVE > cand) {
        cand = best[i - 1][j - 1] + CONSECUTIVE;
        from = j - 1;
      }
      if (from >= 0) {
        best[i][j] = cand + charScore(j);
        parent[i][j] = from;
      }
    }
  }
  let end = -1;
  let top = NEG;
  for (let j = 0; j < n; j++) {
    if (best[m - 1][j] > top) {
      top = best[m - 1][j];
      end = j;
    }
  }
  if (end < 0) return null;
  const positions: number[] = new Array<number>(m);
  for (let i = m - 1, j = end; i >= 0; i--) {
    positions[i] = j;
    j = parent[i][j];
  }
  // 短いパスを優先(同点なら浅い・短いものが上に来る)
  return { score: top - n * 0.05, positions };
}

export type QuickItem = { relPath: string; positions: number[] };

/**
 * 候補を並べる。空の入力は「最近開いたファイル(渡された順)」を先頭に、残りは元の順。
 * 入力があれば一致したものだけをスコア順(同点は元の順)で返す。
 */
export function rankFiles(query: string, relPaths: string[], recent: string[]): QuickItem[] {
  if (query.trim() === "") {
    const set = new Set(relPaths);
    const head = [...new Set(recent)].filter((p) => set.has(p));
    const seen = new Set(head);
    return [...head, ...relPaths.filter((p) => !seen.has(p))].map((relPath) => ({ relPath, positions: [] }));
  }
  const hits: { item: QuickItem; score: number; order: number }[] = [];
  relPaths.forEach((relPath, order) => {
    const r = fuzzyMatch(query, relPath);
    if (r) hits.push({ item: { relPath, positions: r.positions }, score: r.score, order });
  });
  hits.sort((a, b) => b.score - a.score || a.order - b.order);
  return hits.map((h) => h.item);
}

/** 強調表示のために、文字列を「一致/非一致」の連なりに分ける。 */
export function highlightSegments(text: string, positions: number[]): { text: string; hit: boolean }[] {
  const set = new Set(positions);
  const out: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else out.push({ text: text[i], hit });
  }
  return out;
}
