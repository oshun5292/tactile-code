import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../../api";
import type { FileList } from "../../api/types";
import { baseName } from "./editorLogic";
import { highlightSegments, rankFiles } from "./quickOpenLogic";

const MAX_SHOWN = 50;

type Props = {
  projectId: string;
  /** 最近開いたファイル(タブの順)。入力が空のとき先頭に並べる */
  recent: string[];
  onOpen: (relPath: string) => void;
  onClose: () => void;
};

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; list: FileList };

function Highlighted({ text, positions }: { text: string; positions: number[] }) {
  return (
    <>
      {highlightSegments(text, positions).map((s, i) =>
        s.hit ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>,
      )}
    </>
  );
}

/** Ctrl+P のパレット。開いている間だけマウントされ、マウントのたびに一覧を取得し直す。 */
export function QuickOpen({ projectId, recent, onOpen, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  useEffect(() => {
    let cancelled = false; // 閉じた後・再試行後の古い応答を捨てる
    setLoad({ status: "loading" });
    api.listFiles(projectId).then(
      (list) => !cancelled && setLoad({ status: "ready", list }),
      (e) => !cancelled && setLoad({ status: "error", message: typeof e === "string" ? e : e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, attempt]);

  const all = load.status === "ready" ? load.list.relPaths : null;
  const ranked = useMemo(() => (all ? rankFiles(query, all, recent) : []), [all, query, recent]);
  const shown = ranked.slice(0, MAX_SHOWN);
  const active = Math.min(index, Math.max(shown.length - 1, 0));

  // 選択行が見える位置へ
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, shown.length]);

  const choose = (relPath: string) => {
    onClose();
    onOpen(relPath);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return; // 日本語変換中の Enter/Esc は確定・取消のために残す
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (shown.length === 0) return;
      const d = e.key === "ArrowDown" ? 1 : -1;
      setIndex((active + d + shown.length) % shown.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = shown[active];
      if (item) choose(item.relPath);
    }
  };

  return (
    <div className="quickopen-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="quickopen" role="dialog" aria-modal="true" aria-label="ファイルを探す">
        <input
          className="quickopen-input"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
          aria-label="ファイル名"
          placeholder="ファイル名を入力(曖昧に一致します)"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
        />

        {load.status === "loading" && (
          <p className="quickopen-note" role="status">
            ファイル一覧を取得しています…
          </p>
        )}
        {load.status === "error" && (
          <div className="quickopen-note" data-kind="error" role="alert">
            <span>ファイル一覧を取得できませんでした: {load.message}</span>
            <button type="button" className="btn btn-ghost" onClick={() => setAttempt((n) => n + 1)}>
              再試行
            </button>
          </div>
        )}
        {load.status === "ready" && shown.length === 0 && (
          <p className="quickopen-note" role="status">
            {query.trim() === "" ? "ファイルがありません" : "一致するファイルがありません"}
          </p>
        )}

        {shown.length > 0 && (
          <ul ref={listRef} id={listId} className="quickopen-list" role="listbox" aria-label="候補">
            {shown.map((it, i) => {
              const name = baseName(it.relPath);
              const dirLen = it.relPath.length - name.length;
              const dir = it.relPath.slice(0, dirLen);
              return (
                <li
                  key={it.relPath}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className="quickopen-item"
                  title={it.relPath}
                  // フォーカスを入力欄に残したまま選ぶ(クリックでフォーカスが外れると Esc が効かなくなる)
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => i !== active && setIndex(i)}
                  onClick={() => choose(it.relPath)}
                >
                  <span className="quickopen-name">
                    <Highlighted text={name} positions={it.positions.filter((p) => p >= dirLen).map((p) => p - dirLen)} />
                  </span>
                  {dir && (
                    <span className="quickopen-dir">
                      <Highlighted text={dir} positions={it.positions.filter((p) => p < dirLen)} />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {load.status === "ready" && (
          <div className="quickopen-foot">
            {ranked.length > MAX_SHOWN && <span>{ranked.length} 件中、先頭の {MAX_SHOWN} 件を表示しています(入力で絞り込めます)</span>}
            {load.list.truncated && <span data-kind="warn">件数が多いため、一部のみ表示しています</span>}
            <span className="quickopen-keys">↑↓ 選ぶ / Enter 開く / Esc 閉じる</span>
          </div>
        )}
      </div>
    </div>
  );
}
