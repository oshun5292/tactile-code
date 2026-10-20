import { useState, type KeyboardEvent } from "react";
import { parseGoto } from "./settingsLogic";

type Props = {
  /** 1始まりの行・桁。範囲外は呼び出し先(文書側)が端に丸める */
  onGo: (line: number, column: number) => void;
  onClose: () => void;
};

/** Ctrl+G の入力パレット(QuickOpen と同じ見た目・流儀)。開いている間だけマウントされる。 */
export function GotoLine({ onGo, onClose }: Props) {
  const [text, setText] = useState("");
  const parsed = parseGoto(text);
  const invalid = text.trim() !== "" && parsed === null;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return; // 日本語変換中の Enter/Esc は確定・取消のために残す
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!parsed) return;
      onClose();
      onGo(parsed.line, parsed.column);
    }
  };

  return (
    // .quickopen を共有するのは、Esc でボードへ戻る処理がこのクラスを見て遠慮するため
    <div className="quickopen-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="quickopen gotoline" role="dialog" aria-modal="true" aria-label="行へ移動">
        <input
          className="quickopen-input"
          aria-label="行番号"
          aria-invalid={invalid}
          placeholder="行番号を入力(12:5 のように桁も指定できます)"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="quickopen-foot">
          {invalid && <span data-kind="warn">数字で入力してください(例: 12 または 12:5)</span>}
          <span className="quickopen-keys">Enter 移動 / Esc 閉じる</span>
        </div>
      </div>
    </div>
  );
}
