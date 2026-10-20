import type { CSSProperties } from "react";
import { undo } from "./penActions";
import { PEN_COLORS, usePen, usePenHistory } from "./penStore";

type Props = {
  canClear: boolean;
  onClearRequest: () => void;
};

const PenIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 13l.7-3L11 2.7a1.4 1.4 0 012 2L5.7 12 3 13z" />
  </svg>
);

const EraserIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6.2 13.5H13M3.1 9.6l5.3-5.3a1.3 1.3 0 011.9 0l2.4 2.4a1.3 1.3 0 010 1.9l-4.6 4.9H6.2L3.1 11.5a1.3 1.3 0 010-1.9z" />
    <path d="M5.8 7.2l4.2 4.2" />
  </svg>
);

/** 左下のペンツールバー(36 の .tools)。ペン / 消しゴム / 色4つ / 整える / 戻す / 消す。 */
export function PenToolbar({ canClear, onClearRequest }: Props) {
  const { on, tool, color, snap, setOn, setTool, setColor, setSnap } = usePen();
  const canUndo = usePenHistory((s) => s.stack.length > 0);
  const penOn = on && tool === "pen";
  const eraserOn = on && tool === "eraser";

  return (
    <div className="pen-tools" role="toolbar" aria-label="手書きペン">
      <button type="button" className="pen-toggle" aria-pressed={penOn} aria-label="ペン" onClick={() => (penOn ? setOn(false) : setTool("pen"))} title="ペン(もう一度押すか Esc でOFF)">
        <PenIcon />
        ペン
      </button>
      <button
        type="button"
        className="pen-toggle"
        aria-pressed={eraserOn}
        aria-label="消しゴム"
        onClick={() => (eraserOn ? setOn(false) : setTool("eraser"))}
        title="消しゴム: なぞった線を1本ごと消す(Esc でOFF)"
      >
        <EraserIcon />
        消しゴム
      </button>
      <span className="pen-sep" aria-hidden="true" />
      {PEN_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          className="pen-dot"
          style={{ "--c": c.value } as CSSProperties}
          aria-label={`${c.name}のペン`}
          aria-pressed={penOn && color === c.value}
          data-selected={color === c.value ? "" : undefined}
          onClick={() => setColor(c.value)}
        />
      ))}
      <span className="pen-sep" aria-hidden="true" />
      <button
        type="button"
        className="pen-snap"
        aria-pressed={snap}
        aria-label="丸を自動で整える"
        onClick={() => setSnap(!snap)}
        title="ほぼ閉じた丸を、手書き風のきれいな丸に整える"
      >
        整える
      </button>
      <span className="pen-sep" aria-hidden="true" />
      <button type="button" className="pen-act" onClick={() => void undo()} disabled={!canUndo} title="直前の操作(描く・消す)を取り消す">
        戻す
      </button>
      <button type="button" className="pen-act" onClick={onClearRequest} disabled={!canClear} title="手書きをすべて消す">
        消す
      </button>
    </div>
  );
}
