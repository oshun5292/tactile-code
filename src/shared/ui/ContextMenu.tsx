import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import "./overlay.css";

export type MenuItem =
  | { type?: "item"; label: string; hint?: string; danger?: boolean; disabled?: boolean; onClick: () => void }
  | { type: "separator" };

type Props = {
  /** 画面上の位置(clientX / clientY)。はみ出す場合は内側へ寄せる */
  x: number;
  y: number;
  items: MenuItem[];
  label: string;
  onClose: () => void;
};

/** 右クリックメニュー。↑↓で移動、Enter で実行、Esc・外クリック・スクロールで閉じる。 */
export function ContextMenu({ x, y, items, label, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // onClose は毎回新しい関数で渡されることがある。イベント登録を張り直さないよう ref 経由で呼ぶ
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = () => closeRef.current();
  const [pos, setPos] = useState({ left: x, top: y });

  // 画面の端からはみ出さないよう、描画後の大きさで位置を直す
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    });
  }, [x, y, items]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onClose = close;
    window.addEventListener("mousedown", away, true);
    window.addEventListener("contextmenu", away, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    window.addEventListener("wheel", onClose, { passive: true, capture: true });
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("contextmenu", away, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("wheel", onClose, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation(); // 画面全体の Esc(ボードへ戻る)に渡さない
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      buttons[(i + d + buttons.length) % buttons.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      buttons[e.key === "Home" ? 0 : buttons.length - 1]?.focus();
    }
  };

  return (
    <div ref={ref} className="ctx-menu" role="menu" aria-label={label} style={pos} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it.type === "separator" ? (
          <div key={`sep${i}`} className="ctx-sep" role="separator" />
        ) : (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            className="ctx-item"
            data-danger={it.danger ? "" : undefined}
            disabled={it.disabled}
            onClick={() => {
              close();
              it.onClick();
            }}
          >
            <span>{it.label}</span>
            {it.hint && <kbd>{it.hint}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
