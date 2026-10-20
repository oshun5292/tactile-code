import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import type { FsEntry, GitFileState } from "../../api/types";
import { languageColor } from "../../shared/languageColors";
import { ContextMenu, type MenuItem } from "../../shared/ui/ContextMenu";
import { InlineName } from "./InlineName";
import { gitLabel, gitLetter } from "./gitLogic";
import { canDropInto, creationParent, iconForFile, joinPath, movedPath, parentPath, visibleRows, type TreeDir, type TreeRow } from "./editorLogic";

type Props = {
  dirs: Record<string, TreeDir>;
  /** git の状態(ファイル単位 / 配下に変更があるフォルダ)。無ければ印を出さない */
  gitFiles: ReadonlyMap<string, GitFileState>;
  gitDirs: ReadonlyMap<string, GitFileState>;
  expanded: string[];
  activePath: string | null;
  onToggleDir: (relPath: string) => void;
  onOpenFile: (relPath: string) => void;
  onReload: () => void;
  /** 作成・名前変更は、成功なら null、失敗なら理由を返す(行内の入力欄に出す) */
  onCreate: (kind: "file" | "dir", relPath: string) => Promise<string | null>;
  onRename: (from: string, to: string) => Promise<string | null>;
  /** ドラッグ移動(destDir が "" ならルート)。通知は呼び出し側が出す */
  onMove: (from: string, destDir: string) => Promise<boolean>;
  /** 複製。成功なら新しいエントリ(そのまま名前変更に入る)、失敗なら null */
  onDuplicate: (entry: FsEntry) => Promise<FsEntry | null>;
  onDelete: (entry: FsEntry) => void;
  onCopyPath: (entry: FsEntry, absolute: boolean) => void;
  /** relPath が "" ならプロジェクトのフォルダ */
  onOpenInVscode: (relPath: string) => void;
};

/** いま行内で入力している対象 */
type Editing = { type: "rename"; entry: FsEntry } | { type: "create"; kind: "file" | "dir"; parent: string };
type MenuState = { x: number; y: number; target: FsEntry | null };
type EntryRow = Extract<TreeRow, { type: "entry" }>;

/** ファイルツリー(36 の .tree)。flat な role="tree" で、↑↓ Enter ←→ F2 Delete で操作できる。 */
export function FileTree({ dirs, gitFiles, gitDirs, expanded, activePath, onToggleDir, onOpenFile, onReload, onCreate, onRename, onMove, onDuplicate, onDelete, onCopyPath, onOpenInVscode }: Props) {
  const rows = useMemo(() => visibleRows(dirs, expanded), [dirs, expanded]);
  const entries = useMemo(() => rows.filter((r): r is EntryRow => r.type === "entry"), [rows]);
  const treeRef = useRef<HTMLDivElement>(null);
  // キーボードで今いる行(roving tabindex)。なければ、選択中のファイル、それもなければ先頭
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const current = entries.find((r) => r.entry.relPath === focusPath) ?? entries.find((r) => r.entry.relPath === activePath) ?? entries[0];
  // 「選択中」の行(新規作成の置き場所の基準)。先頭への仮のフォールバックはここでは使わない
  const selected = entries.find((r) => r.entry.relPath === focusPath) ?? entries.find((r) => r.entry.relPath === activePath) ?? null;

  const [editing, setEditing] = useState<Editing | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  // メニューや入力欄が消えたあと、行へフォーカスを戻すための合図
  const [restore, setRestore] = useState(0);

  // フォーカスがツリーの中にあるときだけ、移った行へ実際のフォーカスも移す。
  // 入力中は動かさない(入力欄からフォーカスを奪うと、入力が取り消されてしまう)
  useEffect(() => {
    const tree = treeRef.current;
    if (editing || !tree || !focusPath || !tree.contains(document.activeElement)) return;
    tree.querySelector<HTMLElement>(`[data-path="${CSS.escape(focusPath)}"]`)?.focus();
  }, [focusPath, rows, editing]);

  // 入力欄・メニューが閉じたら、選択していた行へフォーカスを戻す(restore が変わったときだけ動かす)
  useEffect(() => {
    if (restore === 0 || !focusPath) return;
    const tree = treeRef.current;
    // 何もフォーカスされていないとき(入力欄やメニューが消えた直後)だけ戻す。本文のエディタへ移っていたら邪魔しない
    const a = document.activeElement;
    if (tree && (!a || a === document.body)) {
      tree.querySelector<HTMLElement>(`[data-path="${CSS.escape(focusPath)}"]`)?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restore]);

  // ドラッグ中の対象(dragover では dataTransfer を読めないので ref に持つ)と、いま強調している行き先("" はルート)
  const dragFrom = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const openTimer = useRef<{ path: string; id: ReturnType<typeof setTimeout> } | null>(null);

  const clearOpenTimer = () => {
    if (openTimer.current) clearTimeout(openTimer.current.id);
    openTimer.current = null;
  };
  const endDrag = () => {
    clearOpenTimer();
    dragFrom.current = null;
    setDragging(null);
    setDropTarget(null);
  };
  // 閉じたフォルダの上に 700ms 留まったら開く(同じフォルダでは、タイマーを張り直さない)
  const armAutoOpen = (dir: string) => {
    if (openTimer.current?.path === dir) return;
    clearOpenTimer();
    openTimer.current = { path: dir, id: setTimeout(() => onToggleDir(dir), 700) };
  };
  useEffect(() => clearOpenTimer, []);

  /** dragover の共通処理。ドロップできる行き先なら受け付けて強調する。 */
  const dragOverDir = (e: DragEvent, dir: string, closedDir: boolean) => {
    const from = dragFrom.current;
    if (!from) return;
    e.stopPropagation();
    if (closedDir && !(dir === from)) armAutoOpen(dir);
    else if (!closedDir) clearOpenTimer();
    if (!canDropInto(from, dir)) {
      setDropTarget((t) => (t === null ? t : null));
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(dir);
  };

  const dropOnDir = async (e: DragEvent, dir: string) => {
    const from = dragFrom.current;
    if (!from) return;
    e.preventDefault();
    e.stopPropagation();
    endDrag();
    if (!canDropInto(from, dir) || moving) return;
    setMoving(true);
    try {
      if (await onMove(from, dir)) setFocusPath(movedPath(from, dir));
    } finally {
      setMoving(false);
    }
  };

  const closeEditing = () => {
    setEditing(null);
    setRestore((n) => n + 1);
  };

  const startCreate = (kind: "file" | "dir", parent: string) => {
    if (parent && !expanded.includes(parent)) onToggleDir(parent);
    setEditing({ type: "create", kind, parent });
  };
  const startRename = (entry: FsEntry) => setEditing({ type: "rename", entry });

  const siblingNames = (parent: string, exceptRelPath?: string) =>
    (dirs[parent]?.entries ?? []).filter((e) => e.relPath !== exceptRelPath).map((e) => e.name);

  const commitCreate = async (kind: "file" | "dir", parent: string, name: string) => {
    const relPath = joinPath(parent, name);
    const reason = await onCreate(kind, relPath);
    if (!reason) {
      setFocusPath(relPath);
      closeEditing();
    }
    return reason;
  };

  const commitRename = async (entry: FsEntry, name: string) => {
    const to = joinPath(parentPath(entry.relPath), name);
    const reason = await onRename(entry.relPath, to);
    if (!reason) {
      setFocusPath(to);
      closeEditing();
    }
    return reason;
  };

  const openMenu = (e: MouseEvent, target: FsEntry | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (target) setFocusPath(target.relPath);
    setMenu({ x: e.clientX, y: e.clientY, target });
  };

  const duplicate = async (entry: FsEntry) => {
    const created = await onDuplicate(entry);
    if (!created) return;
    // 複製したものを選んで、すぐ名前を変えられるようにする(VSCode と同じ)
    setFocusPath(created.relPath);
    startRename(created);
  };

  const menuItems = (target: FsEntry | null): MenuItem[] => {
    const parent = creationParent(target);
    const items: MenuItem[] = [
      { label: "新規ファイル", onClick: () => startCreate("file", parent) },
      { label: "新規フォルダ", onClick: () => startCreate("dir", parent) },
    ];
    if (target) {
      items.push(
        { type: "separator" },
        { label: "名前を変更", hint: "F2", onClick: () => startRename(target) },
        { label: "複製", onClick: () => void duplicate(target) },
        { label: "削除", hint: "Delete", danger: true, onClick: () => onDelete(target) },
        { type: "separator" },
        { label: "相対パスをコピー", onClick: () => onCopyPath(target, false) },
        { label: "絶対パスをコピー", onClick: () => onCopyPath(target, true) },
      );
    }
    items.push({ type: "separator" }, { label: "VSCodeで開く", onClick: () => onOpenInVscode(target?.relPath ?? "") });
    return items;
  };

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
      case "F2":
        startRename(entry);
        break;
      case "Delete":
        onDelete(entry);
        break;
      case "ContextMenu": {
        const r = treeRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(entry.relPath)}"]`)?.getBoundingClientRect();
        setMenu({ x: (r?.left ?? 0) + 40, y: (r?.bottom ?? 0) - 4, target: entry });
        break;
      }
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

  /** 行の右端の印。ファイルは文字、フォルダは配下の最優先の状態を示すドット。色以外(文字・読み上げ)でも伝える。 */
  const gitMark = (state: GitFileState | undefined, isDir: boolean) => {
    if (!state) return null;
    return isDir ? (
      <span className="tree-git tree-git-dot" data-git={state} role="img" aria-label={`配下に${gitLabel(state)}`} title={`配下に${gitLabel(state)}`} />
    ) : (
      <span className="tree-git" data-git={state} role="img" aria-label={gitLabel(state)} title={gitLabel(state)}>
        {gitLetter(state)}
      </span>
    );
  };

  const creating = editing?.type === "create" ? editing : null;

  /** 新規作成の入力行。親フォルダの直下(最初の子)に差し込む。 */
  const createRow = (parent: string, kind: "file" | "dir", depth: number) => (
    <div key="#create" className="tree-row" data-editing="" role="treeitem" aria-selected={false} aria-label="新しい名前を入力" style={{ "--depth": depth } as CSSProperties}>
      {kind === "dir" ? (
        <span className="ico ico-dir" aria-hidden="true" />
      ) : (
        <span className="ico" aria-hidden="true">
          ·
        </span>
      )}
      <InlineName initial="" siblings={siblingNames(parent)} onCommit={(name) => commitCreate(kind, parent, name)} onCancel={closeEditing} />
    </div>
  );

  const addBtn = (label: string, onClick: () => void, base: string) => (
    <button type="button" className="tree-icon-btn" onClick={onClick} title={label} aria-label={label}>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={base} />
        <path d="M12 9.5v4M10 11.5h4" />
      </svg>
    </button>
  );

  return (
    <nav
      className="tree"
      aria-label="ファイルツリー"
      data-drop-root={dropTarget === "" ? "" : undefined}
      onContextMenu={(e) => openMenu(e, null)}
      onDragOver={(e) => dragOverDir(e, "", false)}
      onDrop={(e) => void dropOnDir(e, "")}
      onDragLeave={(e) => {
        // ツリーの外へ出たときだけ強調を消す(子要素の間の移動では消さない)
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          clearOpenTimer();
          setDropTarget(null);
        }
      }}
    >
      <div className="tree-head">
        <h2 className="panel-title">FILES</h2>
        <div className="tree-tools">
          {addBtn("新規ファイル", () => startCreate("file", creationParent(selected?.entry ?? null)), "M3.5 2h5l3 3v3M3.5 2v11h5M8.5 2v3h3")}
          {addBtn("新規フォルダ", () => startCreate("dir", creationParent(selected?.entry ?? null)), "M2 4.5h4l1.5 1.5H13v2.5M2 4.5V13h7")}
          <button type="button" className="tree-reload" onClick={onReload} title="フォルダの中身を読み直す">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.8-4.1" />
              <path d="M13.5 2v3.2h-3.2" />
            </svg>
            再読み込み
          </button>
        </div>
      </div>
      <div ref={treeRef} role="tree" aria-label="プロジェクトのファイル" onKeyDown={onKeyDown}>
        {creating && creating.parent === "" && createRow("", creating.kind, 0)}
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
          const iconEl = isDir ? (
            <span className="ico ico-dir" aria-hidden="true" />
          ) : (
            <span className="ico" style={{ "--c": languageColor(icon.language).d } as CSSProperties} aria-hidden="true">
              {icon.abbr}
            </span>
          );

          if (editing?.type === "rename" && editing.entry.relPath === entry.relPath) {
            return (
              <div key={entry.relPath} className="tree-row" data-editing="" role="treeitem" aria-selected={false} aria-label={`${entry.name} の名前を変更`} style={{ "--depth": depth } as CSSProperties}>
                {iconEl}
                <InlineName
                  initial={entry.name}
                  siblings={siblingNames(parentPath(entry.relPath), entry.relPath)}
                  onCommit={(name) => commitRename(entry, name)}
                  onCancel={closeEditing}
                />
              </div>
            );
          }
          return (
            <div key={entry.relPath} style={{ display: "contents" }}>
              <div
                className="tree-row"
                role="treeitem"
                data-path={entry.relPath}
                data-kind={entry.kind}
                data-active={active ? "" : undefined}
                aria-level={depth + 1}
                aria-expanded={isDir ? open : undefined}
                aria-selected={active}
                tabIndex={current?.entry.relPath === entry.relPath ? 0 : -1}
                // 入力中・移動の処理中はドラッグさせない
                draggable={!editing && !moving}
                data-dragging={dragging === entry.relPath ? "" : undefined}
                data-drop={isDir && dropTarget === entry.relPath ? "" : undefined}
                onDragStart={(e) => {
                  dragFrom.current = entry.relPath;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", entry.relPath);
                  // 同じ描画の中で見た目を変えるとドラッグが始まらないことがあるので、1拍おく
                  setTimeout(() => dragFrom.current && setDragging(entry.relPath), 0);
                }}
                onDragEnd={endDrag}
                onDragOver={(e) => {
                  // 行き先はフォルダ行だけ。ファイル行の上では「置けない」を示す(ルートへの誤ドロップを防ぐ)
                  if (isDir) dragOverDir(e, entry.relPath, !open);
                  else if (dragFrom.current) {
                    e.stopPropagation();
                    clearOpenTimer();
                    setDropTarget(null);
                  }
                }}
                onDrop={(e) => {
                  if (isDir) void dropOnDir(e, entry.relPath);
                  else if (dragFrom.current) {
                    e.stopPropagation();
                    endDrag();
                  }
                }}
                style={{ "--depth": depth } as CSSProperties}
                onFocus={() => setFocusPath(entry.relPath)}
                onContextMenu={(e) => openMenu(e, entry)}
                onClick={() => {
                  setFocusPath(entry.relPath);
                  if (isDir) onToggleDir(entry.relPath);
                  else onOpenFile(entry.relPath);
                }}
              >
                {iconEl}
                <span className="tree-name" data-git={isDir ? undefined : gitFiles.get(entry.relPath)}>
                  {entry.name}
                </span>
                {gitMark(isDir ? gitDirs.get(entry.relPath) : gitFiles.get(entry.relPath), isDir)}
              </div>
              {creating && creating.parent !== "" && creating.parent === entry.relPath ? createRow(entry.relPath, creating.kind, depth + 1) : null}
            </div>
          );
        })}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.target ? `${menu.target.name} のメニュー` : "ファイルツリーのメニュー"}
          items={menuItems(menu.target)}
          onClose={() => {
            setMenu(null);
            setRestore((n) => n + 1);
          }}
        />
      )}
    </nav>
  );
}
