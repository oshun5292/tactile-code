import { CodeEditor, type RevealTarget } from "./CodeEditor";
import { MarkdownPreview } from "./MarkdownPreview";

export type MarkdownEditorProps = {
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  mode: "edit" | "split" | "preview"; // 書く / 半分 / 読む
  reveal?: RevealTarget | null;
  onRevealed?: (tick: number) => void;
};

// 半分表示のスクロール同期は、MVPでは行わない
export function MarkdownEditor({ value, onChange, onSave, mode, reveal, onRevealed }: MarkdownEditorProps) {
  return (
    <div className="md-editor" data-mode={mode}>
      {mode !== "preview" && (
        <div className="md-editor-src">
          <CodeEditor value={value} filename="note.md" onChange={onChange} onSave={onSave} wrap ariaLabel="マークダウンの編集" reveal={reveal} onRevealed={onRevealed} />
        </div>
      )}
      {mode !== "edit" && (
        <div className="md-editor-out">
          <MarkdownPreview value={value} />
        </div>
      )}
    </div>
  );
}
