import { useEffect, useId, useRef, type ReactNode } from "react";

type Props = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** ネイティブの <dialog>(showModal)を使う確認ダイアログ。Esc・フォーカス閉じ込めはブラウザが担当。 */
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = "やめる", onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId(); // ダイアログが複数あっても id がぶつからないように

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="confirm" onCancel={(e) => { e.preventDefault(); onCancel(); }} aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>
      <div className="confirm-body">{children}</div>
      <div className="confirm-actions">
        {/* 誤操作を防ぐため、最初のフォーカスは「やめる」側 */}
        <button type="button" className="btn btn-ghost" autoFocus onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className="btn btn-danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
