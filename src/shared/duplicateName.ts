// 複製の名前付け(純粋関数)。バックエンド(Rust)と同じ規則をモックで再現するために使う。

/**
 * `foo.ts` → `foo copy.ts` → `foo copy 2.ts` …。最初に空いている名前を返す。
 * 先頭だけのドット(`.env`)は拡張子ではないので `.env copy`。大文字小文字は区別せず衝突とみなす(Windows)。
 */
export function duplicateName(name: string, existing: readonly string[]): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  for (let n = 1; ; n++) {
    const candidate = `${stem} copy${n === 1 ? "" : ` ${n}`}${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
