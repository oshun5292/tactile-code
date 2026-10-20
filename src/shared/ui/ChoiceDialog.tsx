import { useEffect, useId, useRef, type ReactNode } from "react";

export type Choice = {
  label: string;
  onClick: () => void;
  /** primary=濃い色(おすすめ)、danger=赤(元に戻せない)、ghost=控えめ */
  variant?: "primary" | "danger" | "ghost";
  /** 最初にフォーカスを置く(誤操作を避けるため、安全な選択肢に付ける) */
  autoFocus?: boolean;
};

type Props = {
  open: boolean;
  title: string;
  children: ReactNode;
  choices: Choice[];
  /** Esc で閉じたとき(たいてい「やめる」と同じ) */
  onCancel: () => void;
};

/** 3択以上の確認ダイアログ(ConfirmDialog の仲間)。ネイティブの <dialog> を使う。 */
export function ChoiceDialog({ open, title, children, choices, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="confirm" onCancel={(e) => { e.preventDefault(); onCancel(); }} aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>
      <div className="confirm-body">{children}</div>
      <div className="confirm-actions confirm-actions-wrap">
        {choices.map((c) => (
          <button
            key={c.label}
            type="button"
            className={`btn btn-${c.variant ?? "ghost"}`}
            data-autofocus={c.autoFocus ? "" : undefined}
            onClick={c.onClick}
          >
            {c.label}
          </button>
        ))}
      </div>
    </dialog>
  );
}
