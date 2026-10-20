import { useEffect, useRef, useState } from "react";

type Props = {
  value: string;
  placeholder: string;
  label: string; // スクリーンリーダー用の名前(「ひと言メモ」など)
  maxLength?: number;
  className?: string;
  onSave: (next: string) => void;
};

/**
 * クリック(または Enter)で編集 → フォーカスが外れる/Enter で保存、Esc で取り消し。
 * 保存は値が変わったときだけ呼ぶ。
 */
export function EditableText({ value, placeholder, label, maxLength, className, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const start = () => {
    cancelled.current = false;
    setDraft(value);
    setEditing(true);
  };

  const finish = () => {
    setEditing(false);
    if (cancelled.current) return;
    const next = draft.trim();
    if (next !== value) onSave(next);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`editable editable-input ${className ?? ""}`}
        value={draft}
        maxLength={maxLength}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className={`editable editable-view ${value ? "" : "is-empty"} ${className ?? ""}`}
      onClick={start}
      aria-label={`${label}を編集`}
      title="クリックで編集"
    >
      {value || placeholder}
    </button>
  );
}
