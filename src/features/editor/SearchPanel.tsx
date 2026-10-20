import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../../api";
import type { SearchOptions, SearchResult } from "../../api/types";
import { toMessage } from "../../shared/format";
import { baseName } from "./editorLogic";
import { groupMatches, previewSegments } from "./searchLogic";

const DEBOUNCE_MS = 300;

type Props = {
  projectId: string;
  /** 増えるたびに入力欄へフォーカスして全選択する(Ctrl+Shift+F) */
  focusTick: number;
  /** Ctrl+Shift+F で渡された検索語(選択中の文字)。focusTick と一緒に更新される */
  seed: string | null;
  onOpen: (relPath: string, line: number, column: number, length: number) => void;
};

type Load =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: SearchResult; query: string; options: SearchOptions };

/** サイドバーの「検索」。入力から 300ms 後に検索し、古い応答は捨てる。 */
export function SearchPanel({ projectId, focusTick, seed, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SearchOptions>({ caseSensitive: false, wholeWord: false });
  const [load, setLoad] = useState<Load>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusTick === 0) return;
    if (seed !== null) setQuery(seed);
    // 隠れていたパネルが表示されてからフォーカスする
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [focusTick, seed]);

  useEffect(() => {
    if (query === "") {
      setLoad({ status: "idle" });
      return;
    }
    let cancelled = false; // 入力が進んだ・閉じたあとに届いた古い応答を捨てる
    setLoad({ status: "loading" });
    const timer = setTimeout(() => {
      api.searchInProject(projectId, query, options).then(
        (result) => {
          if (cancelled) return;
          setLoad({ status: "ready", result, query, options });
          setCollapsed(new Set());
        },
        (e) => !cancelled && setLoad({ status: "error", message: toMessage(e) }),
      );
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, query, options, attempt]);

  const groups = useMemo(() => (load.status === "ready" ? groupMatches(load.result.matches) : []), [load]);

  const toggle = (relPath: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (!next.delete(relPath)) next.add(relPath);
      return next;
    });

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return; // 日本語変換中の Enter は確定のために残す
    if (e.key === "Enter") {
      e.preventDefault();
      const first = load.status === "ready" ? load.result.matches[0] : undefined;
      if (first) onOpen(first.relPath, first.line, first.column, first.length);
    }
  };

  return (
    <section className="search" aria-label="プロジェクト内を検索">
      <div className="search-box">
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          aria-label="検索する文字列"
          placeholder="検索"
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="search-opt"
          aria-pressed={options.caseSensitive}
          title="大文字と小文字を区別する"
          onClick={() => setOptions((o) => ({ ...o, caseSensitive: !o.caseSensitive }))}
        >
          Aa
        </button>
        <button
          type="button"
          className="search-opt"
          aria-pressed={options.wholeWord}
          title="単語単位で探す"
          onClick={() => setOptions((o) => ({ ...o, wholeWord: !o.wholeWord }))}
        >
          単語
        </button>
      </div>

      <div className="search-results" aria-live="polite">
        {load.status === "idle" && <p className="search-note">文字列を入力すると、プロジェクト内のファイルから探します。</p>}
        {load.status === "loading" && (
          <p className="search-note" role="status">
            <span className="spinner" aria-hidden="true" />
            検索しています…
          </p>
        )}
        {load.status === "error" && (
          <div className="search-note" data-kind="error" role="alert">
            <span>検索できませんでした: {load.message}</span>
            <button type="button" className="btn btn-ghost" onClick={() => setAttempt((n) => n + 1)}>
              再試行
            </button>
          </div>
        )}
        {load.status === "ready" && load.result.matches.length === 0 && <p className="search-note">一致する結果がありません。</p>}
        {load.status === "ready" && load.result.matches.length > 0 && (
          <>
            <p className="search-summary">
              {groups.length} ファイルに {load.result.matches.length} 件{load.result.truncated ? "以上" : ""}
            </p>
            {load.result.truncated && (
              <p className="search-note" data-kind="warn">
                結果が多いため、先頭 2,000 件のみ表示しています
              </p>
            )}
            {groups.map((g) => {
              const open = !collapsed.has(g.relPath);
              const name = baseName(g.relPath);
              return (
                <div key={g.relPath} className="search-group">
                  <button type="button" className="search-file" aria-expanded={open} title={g.relPath} onClick={() => toggle(g.relPath)}>
                    <span className="search-caret" aria-hidden="true" />
                    <span className="search-fname">{name}</span>
                    <span className="search-fdir">{g.relPath.slice(0, g.relPath.length - name.length)}</span>
                    <span className="search-count">{g.matches.length}</span>
                  </button>
                  {open &&
                    g.matches.map((m, i) => (
                      <button
                        key={`${m.line}:${m.column}:${i}`}
                        type="button"
                        className="search-hit"
                        title={`${m.relPath}:${m.line}`}
                        onClick={() => onOpen(m.relPath, m.line, m.column, m.length)}
                      >
                        <span className="search-line">{m.line}</span>
                        <span className="search-preview">
                          {previewSegments(m.preview, m.previewColumn, m.length).map((s, k) =>
                            s.hit ? <mark key={k}>{s.text}</mark> : <span key={k}>{s.text}</span>,
                          )}
                        </span>
                      </button>
                    ))}
                </div>
              );
            })}
          </>
        )}
      </div>
    </section>
  );
}
