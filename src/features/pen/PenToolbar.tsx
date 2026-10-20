import type { CSSProperties } from "react";
import { PEN_COLORS, usePen } from "./penStore";

type Props = {
  canUndo: boolean;
  canClear: boolean;
  onUndo: () => void;
  onClearRequest: () => void;
};

/** 左下のペンツールバー(36 の .tools)。ペンON/OFF、色4つ、戻す、消す。 */
export function PenToolbar({ canUndo, canClear, onUndo, onClearRequest }: Props) {
  const { on, color, setOn, setColor } = usePen();

  return (
    <div className="pen-tools" role="toolbar" aria-label="手書きペン">
      <button type="button" className="pen-toggle" aria-pressed={on} onClick={() => setOn(!on)} title="ペンのON/OFF(Esc でOFF)">
        ペン
      </button>
      {PEN_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          className="pen-dot"
          style={{ "--c": c.value } as CSSProperties}
          aria-label={`${c.name}のペン`}
          aria-pressed={on && color === c.value}
          data-selected={color === c.value ? "" : undefined}
          onClick={() => setColor(c.value)}
        />
      ))}
      <span className="pen-sep" aria-hidden="true" />
      <button type="button" className="pen-act" onClick={onUndo} disabled={!canUndo} title="最後の1本を戻す">
        戻す
      </button>
      <button type="button" className="pen-act" onClick={onClearRequest} disabled={!canClear} title="手書きをすべて消す">
        消す
      </button>
    </div>
  );
}
