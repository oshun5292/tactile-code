import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { languageColor } from "../../shared/languageColors";
import { iconForFile, parentPath, visibleRows, type TreeDir, type TreeRow } from "./editorLogic";

type Props = {
  dirs: Record<string, TreeDir>;
  expanded: string[];
  activePath: string | null;
  onToggleDir: (relPath: string) => void;
  onOpenFile: (relPath: string) => void;
  onReload: () => void;
};

/** ファイルツリー(36 の .tree)。flat な role="tree" で、↑↓ Enter ←→ で操作できる。 */
export function FileTree({ dirs, expanded, activePath, onToggleDir, onOpenFile, onReload }: Props) {
  const rows = useMemo(() => visibleRows(dirs, expanded), [dirs, expanded]);
  const entries = useMemo(() => rows.filter((r): r is Extract<TreeRow, { type: "entry" }> => r.type === "entry"), [rows]);
  const treeRef = useRef<HTMLDivElement>(null);
  // キーボードで今いる行(roving tabindex)。なければ、選択中のファイル、それもなければ先頭
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const current = entries.find((r) => r.entry.relPath === focusPath) ?? entries.find((r) => r.entry.relPath === activePath) ?? entries[0];

  // フォーカスがツリーの中にあるときだけ、移った行へ実際のフォーカスも移す
  useEffect(() => {
    const tree = treeRef.current;
    if (!tree || !focusPath || !tree.contains(document.activeElement)) return;
    tree.querySelector<HTMLElement>(`[data-path="${CSS.escape(focusPath)}"]`)?.focus();
  }, [focusPath, rows]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!current || e.altKey || e.ctrlKey || e.metaKey) return;
    const i = entries.indexOf(current);
    const { entry, open } = current;
    let handled = true;
    switch (e.key) {
      case "ArrowDown":
        setFocusPath(entries[Math.min(i + 1, entries.length - 1)].entry.relPath);
        break;
      case "ArrowUp":
        setFocusPath(entries[Math.max(i - 1, 0)].entry.relPath);
        break;
      case "Home":
        setFocusPath(entries[0].entry.relPath);
        break;
      case "End":
        setFocusPath(entries[entries.length - 1].entry.relPath);
        break;
      case "ArrowRight":
        if (entry.kind === "dir") {
          if (!open) onToggleDir(entry.relPath);
          else if (entries[i + 1]?.entry.relPath.startsWith(`${entry.relPath}/`)) setFocusPath(entries[i + 1].entry.relPath);
        }
        break;
      case "ArrowLeft":
        if (entry.kind === "dir" && open) onToggleDir(entry.relPath);
        else {
          const parent = parentPath(entry.relPath);
          if (parent) setFocusPath(parent);
        }
        break;
      case "Enter":
      case " ":
        if (entry.kind === "dir") onToggleDir(entry.relPath);
        else onOpenFile(entry.relPath);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };

  return (
    <nav className="tree" aria-label="ファイルツリー">
      <div className="tree-head">
        <h2 className="panel-title">FILES</h2>
        <button type="button" className="tree-reload" onClick={onReload} title="フォルダの中身を読み直す">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.8-4.1" />
            <path d="M13.5 2v3.2h-3.2" />
          </svg>
          再読み込み
        </button>
      </div>
      <div ref={treeRef} role="tree" aria-label="プロジェクトのファイル" onKeyDown={onKeyDown}>
        {rows.map((row) => {
          if (row.type === "status") {
            return (
              <div key={row.key} className="tree-status" data-status={row.status} style={{ "--depth": row.depth } as CSSProperties} role={row.status === "error" ? "alert" : "status"}>
                {row.status === "loading" && <span className="spinner" aria-hidden="true" />}
                {row.message}
              </div>
            );
          }
          const { entry, depth, open } = row;
          const isDir = entry.kind === "dir";
          const active = !isDir && entry.relPath === activePath;
          const icon = iconForFile(entry.name);
          return (
            <div
              key={entry.relPath}
              className="tree-row"
              role="treeitem"
              data-path={entry.relPath}
              data-kind={entry.kind}
              data-active={active ? "" : undefined}
              aria-level={depth + 1}
              aria-expanded={isDir ? open : undefined}
              aria-selected={active}
              tabIndex={current?.entry.relPath === entry.relPath ? 0 : -1}
              style={{ "--depth": depth } as CSSProperties}
              onFocus={() => setFocusPath(entry.relPath)}
              onClick={() => {
                setFocusPath(entry.relPath);
                if (isDir) onToggleDir(entry.relPath);
                else onOpenFile(entry.relPath);
              }}
            >
              {isDir ? (
                <span className="ico ico-dir" aria-hidden="true" />
              ) : (
                <span className="ico" style={{ "--c": languageColor(icon.language).d } as CSSProperties} aria-hidden="true">
                  {icon.abbr}
                </span>
              )}
              <span className="tree-name">{entry.name}</span>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
