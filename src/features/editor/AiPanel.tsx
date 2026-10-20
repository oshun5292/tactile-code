import { useState } from "react";

/** 右のAI会話の枠。MVPでは中身は無く、畳んだ状態が既定(細い縦のタブを押すと開く)。 */
export function AiPanel() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <aside className="ai ai-closed" aria-label="AI会話">
        <button type="button" className="ai-tab" aria-expanded={false} onClick={() => setOpen(true)}>
          AI会話(準備中)
        </button>
      </aside>
    );
  }
  return (
    <aside className="ai ai-open" aria-label="AI会話">
      <div className="ai-head">
        <h2 className="panel-title">AI会話</h2>
        <button type="button" className="ai-fold" aria-expanded={true} onClick={() => setOpen(false)} title="畳む">
          畳む
        </button>
      </div>
      <p className="ai-soon">AI会話は後のバージョンで追加します</p>
    </aside>
  );
}
