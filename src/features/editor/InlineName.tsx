import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { validateEntryName } from "./editorLogic";

type Props = {
  initial: string;
  /** 同じフォルダにある、ほかの名前(重複の検査用。名前変更なら自分の元の名前は除く) */
  siblings: string[];
  /** 確定。成功なら null、失敗なら理由(入力欄の下に出して、編集を続けさせる) */
  onCommit: (name: string) => Promise<string | null>;
  onCancel: () => void;
};

/** ツリーの行の中で名前を入力する欄(VSCode と同じ: Enter で確定、Esc で取消、欄の外へ出ると取消)。 */
export function InlineName({ initial, siblings, onCommit, onCancel }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  // 最初に、拡張子を除いた部分だけを選択する(名前だけ打ち替えやすい)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);

  const commit = async () => {
    if (busy.current) return;
    const name = value.trim();
    if (name === initial) return onCancel(); // 変更なし
    const problem = validateEntryName(name, siblings);
    if (problem) return setError(problem);
    busy.current = true;
    const reason = await onCommit(name);
    busy.current = false;
    if (reason) {
      setError(reason);
      ref.current?.focus();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 木全体のキー操作(矢印・F2・Delete など)や画面全体の Esc へ渡さない
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return; // 日本語変換の確定の Enter / Esc は、変換のために使う
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="tree-edit">
      <input
        ref={ref}
        className="tree-edit-input"
        value={value}
        aria-label="名前"
        aria-invalid={error ? true : undefined}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!busy.current) onCancel();
        }}
        onClick={(e) => e.stopPropagation()}
      />
      {error && (
        <div className="tree-edit-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
