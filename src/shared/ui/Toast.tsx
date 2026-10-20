import { useEffect } from "react";
import "./overlay.css";

export type ToastData = { id: number; kind: "info" | "error"; text: string };

const AUTO_HIDE_MS = { info: 2500, error: 9000 } as const;

/** 画面下の短いお知らせ。失敗は role="alert"、成功は role="status"。時間が来るか、×で消える。 */
export function Toast({ toast, onClose }: { toast: ToastData | null; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, AUTO_HIDE_MS[toast.kind]);
    return () => clearTimeout(t);
  }, [toast, onClose]);

  if (!toast) return null;
  return (
    <div className="toast" data-kind={toast.kind} role={toast.kind === "error" ? "alert" : "status"}>
      <span className="toast-text">{toast.text}</span>
      <button type="button" className="toast-close" onClick={onClose} aria-label="閉じる">
        ×
      </button>
    </div>
  );
}
