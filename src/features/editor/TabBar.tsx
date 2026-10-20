import type { GitFileState } from "../../api/types";
import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { languageColor } from "../../shared/languageColors";
import { ContextMenu, type MenuItem } from "../../shared/ui/ContextMenu";
import { baseName, iconForFile, isDirty, tabsToClose, type CloseMode, type ExternalMark, type Session } from "./editorLogic";

const EXTERNAL_LABEL: Record<ExternalMark, string> = {
  reloaded: "更新",
  changed: "外部で変更",
  deleted: "削除された",
};

type Props = {
  session: Session;
  /** git の状態(変更のあるファイル名を色で示す。任意) */
  gitFiles: ReadonlyMap<string, GitFileState>;
  onActivate: (relPath: string) => void;
  onClose: (relPath: string) => void;
  /** メニューの「他を閉じる」等。対象の計算は tabsToClose、未保存の確認は呼び出し側 */
  onCloseMany: (relPaths: string[]) => void;
  onCopyPath: (relPath: string, absolute: boolean) => void;
  /** insertIndex は移動前の並びでの隙間の番号(moveTabIn と同じ) */
  onReorder: (relPath: string, insertIndex: number) => void;
};

/** タブ専用の型名。ファイルツリーのドラッグ(別の型)と取り違えないため */
const DRAG_TYPE = "application/x-tactile-tab";

/** タブ(36 の .ml-tab)。アクティブはプロジェクト色の上線、未保存は ●。多いときは横スクロール。 */
export function TabBar({ session, gitFiles, onActivate, onClose, onCloseMany, onCopyPath, onReorder }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; relPath: string } | null>(null);
  // ドラッグ中のタブと、挿入線を出す隙間の番号(動かない位置なら null)
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const menuItems = (relPath: string): MenuItem[] => {
    const many = (mode: CloseMode) => () => onCloseMany(tabsToClose(session, relPath, mode));
    const i = session.tabs.findIndex((t) => t.relPath === relPath);
    return [
      { label: "閉じる", onClick: () => onClose(relPath) },
      { label: "他を閉じる", disabled: session.tabs.length <= 1, onClick: many("others") },
      { label: "右側をすべて閉じる", disabled: i === session.tabs.length - 1, onClick: many("right") },
      { label: "すべて閉じる", onClick: many("all") },
      { type: "separator" },
      { label: "相対パスをコピー", onClick: () => onCopyPath(relPath, false) },
      { label: "絶対パスをコピー", onClick: () => onCopyPath(relPath, true) },
    ];
  };

  const endDrag = () => {
    setDragging(null);
    setDropAt(null);
  };

  /** 動かない位置(自分の直前・直後)の隙間は線を出さない */
  const effectiveGap = (gap: number): number | null => {
    const from = session.tabs.findIndex((t) => t.relPath === dragging);
    return gap === from || gap === from + 1 ? null : gap;
  };
  /** カーソルが対象タブの左半分なら手前、右半分なら後ろの隙間 */
  const gapFor = (e: DragEvent<HTMLElement>, index: number): number | null => {
    const r = e.currentTarget.getBoundingClientRect();
    return effectiveGap(e.clientX < r.left + r.width / 2 ? index : index + 1);
  };

  // アクティブなタブが見える位置までスクロールする
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [session.active, session.tabs.length]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const i = session.tabs.findIndex((t) => t.relPath === session.active);
    if (i === -1) return;
    const next = session.tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + session.tabs.length) % session.tabs.length];
    e.preventDefault();
    onActivate(next.relPath);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
  };

  return (
    <div
      className="tabs"
      ref={listRef}
      role="tablist"
      aria-label="開いているファイル"
      onKeyDown={onKeyDown}
      // タブの右の空き地にドロップしたら、末尾へ
      onDragOver={(e) => {
        if (!dragging || e.target !== e.currentTarget) return;
        e.preventDefault();
        setDropAt(effectiveGap(session.tabs.length));
      }}
      onDrop={(e) => {
        if (!dragging || e.target !== e.currentTarget) return;
        e.preventDefault();
        if (dropAt !== null) onReorder(dragging, dropAt);
        endDrag();
      }}
    >
      {session.tabs.map((t, index) => {
        const active = t.relPath === session.active;
        const dirty = isDirty(t);
        const name = baseName(t.relPath);
        const icon = iconForFile(name);
        return (
          <div
            key={t.relPath}
            className="tab"
            data-active={active ? "" : undefined}
            data-dirty={dirty ? "" : undefined}
            data-dragging={dragging === t.relPath ? "" : undefined}
            data-drop={dropAt === index ? "before" : dropAt === index + 1 && index === session.tabs.length - 1 ? "after" : undefined}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE, t.relPath);
              e.dataTransfer.effectAllowed = "move";
              setDragging(t.relPath);
            }}
            onDragEnd={endDrag}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const gap = gapFor(e, index);
              if (gap !== dropAt) setDropAt(gap);
            }}
            onDrop={(e) => {
              if (!dragging) return;
              e.preventDefault();
              if (dropAt !== null) onReorder(dragging, dropAt);
              endDrag();
            }}
            onContextMenu={(e: MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu({ x: e.clientX, y: e.clientY, relPath: t.relPath });
            }}
            // 中ボタンで閉じる(VSCode と同じ)。mousedown を止めないと Windows の自動スクロールが始まる
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(t.relPath);
              }
            }}
          >
            <button
              type="button"
              role="tab"
              className="tab-main"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={`${t.relPath}${dirty ? "(未保存)" : ""}${t.external ? `(${EXTERNAL_LABEL[t.external]})` : ""}`}
              onClick={() => onActivate(t.relPath)}
            >
              <span className="ico" style={{ "--c": languageColor(icon.language).d } as CSSProperties} aria-hidden="true">
                {icon.abbr}
              </span>
              <span className="tab-name" data-git={gitFiles.get(t.relPath)}>
                {name}
              </span>
              {t.external && (
                <span className="tab-ext" data-kind={t.external}>
                  {EXTERNAL_LABEL[t.external]}
                </span>
              )}
              {dirty && (
                <span className="tab-dirty" role="img" aria-label="未保存">
                  ●
                </span>
              )}
            </button>
            <button type="button" className="tab-close" onClick={() => onClose(t.relPath)} aria-label={`${name} を閉じる`} title="閉じる">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          </div>
        );
      })}
      {menu && <ContextMenu x={menu.x} y={menu.y} label="タブのメニュー" items={menuItems(menu.relPath)} onClose={() => setMenu(null)} />}
    </div>
  );
}
