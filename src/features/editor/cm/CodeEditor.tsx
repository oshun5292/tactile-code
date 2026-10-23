import { useEffect, useMemo, useRef } from "react";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { bracketMatching, indentUnit } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { revealRange } from "../searchLogic";
import { languageForFilename } from "./languages";
import { themeExtensions } from "./theme";
import "./cm.css";

export type CodeEditorProps = {
  value: string; // 改行は "\n"
  filename: string; // 拡張子から言語を決める
  onChange: (next: string) => void;
  onSave: () => void; // Ctrl+S(preventDefault する)
  readOnly?: boolean;
  wrap?: boolean; // 折り返し(既定 false)
  autoFocus?: boolean;
  ariaLabel?: string;
  /** この行・桁(行は1始まり、桁は0始まりの文字数)を選択して表示する。tick が変わるたびに動く(同じ位置への2回目も効く) */
  reveal?: RevealTarget | null;
  /** reveal を適用し終えたとき(古い要求が、タブの開き直しで再実行されないよう呼び出し側が消す) */
  onRevealed?: (tick: number) => void;
};

export type RevealTarget = { line: number; column: number; length: number; tick: number };

// 外から差し替えた変更には、この印を付けて onChange を呼ばない(自分の入力と区別する)
const External = Annotation.define<boolean>();

export function CodeEditor(props: CodeEditorProps) {
  const { value, filename, readOnly = false, wrap = false, autoFocus = false, ariaLabel } = props;
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // コールバックは最新のものを ref 経由で呼ぶ(EditorView を作り直さないため)
  const cb = useRef(props);
  cb.current = props;
  const pending = useRef<string | null>(null);

  const lang = useMemo(() => languageForFilename(filename), [filename]);
  const comps = useRef({
    lang: new Compartment(),
    editable: new Compartment(),
    wrap: new Compartment(),
    aria: new Compartment(),
  });

  // 変わりうる設定は Compartment に入れ、EditorView を作り直さずに差し替える
  const parts = () => ({
    lang: [
      lang.extension ?? [],
      EditorState.tabSize.of(lang.tabSize),
      indentUnit.of(" ".repeat(lang.tabSize)),
    ],
    editable: [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)],
    wrap: wrap ? EditorView.lineWrapping : [],
    aria: EditorView.contentAttributes.of({ "aria-label": ariaLabel ?? filename }),
  });

  // EditorView は生存中ずっと1つ。初期化は一度だけ。
  useEffect(() => {
    const c = comps.current;
    const d = parts();
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          bracketMatching(),
          highlightSelectionMatches(),
          search({ top: true }),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                cb.current.onSave();
                return true;
              },
            },
            indentWithTab,
            ...searchKeymap,
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          themeExtensions,
          c.lang.of(d.lang),
          c.editable.of(d.editable),
          c.wrap.of(d.wrap),
          c.aria.of(d.aria),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((tr) => tr.annotation(External))) {
              cb.current.onChange(u.state.doc.toString());
            }
          }),
          EditorView.domEventHandlers({
            // 変換が終わったら、変換中に保留した外からの差し替えを反映する
            compositionend: (_e, v) => {
              setTimeout(() => applyExternal(v), 0);
            },
          }),
        ],
      }),
    });
    viewRef.current = view;
    if (autoFocus) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyExternal(view: EditorView) {
    const next = pending.current;
    if (next === null || view.composing) return;
    pending.current = null;
    if (view.state.doc.toString() === next) return;
    // 全置換だとカーソルが先頭に飛ぶので、範囲内に収める
    const head = Math.min(view.state.selection.main.head, next.length);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
      selection: { anchor: head },
      annotations: External.of(true),
    });
  }

  // 外から value が変わったときだけ文書を差し替える(自分の入力では、中身が同じなので何もしない)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    pending.current = value;
    applyExternal(view);
  }, [value]);

  // 検索結果などからの「この位置を選択して表示」。タブが表示された後に動かすため、1フレーム待つ
  const revealTick = props.reveal?.tick;
  useEffect(() => {
    const target = cb.current.reveal;
    if (!target) return;
    const id = requestAnimationFrame(() => {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = revealRange(view.state.doc, target.line, target.column, target.length);
      view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: "center" }) });
      view.focus();
      cb.current.onRevealed?.(target.tick);
    });
    return () => cancelAnimationFrame(id);
  }, [revealTick]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const c = comps.current;
    const d = parts();
    view.dispatch({
      effects: [
        c.lang.reconfigure(d.lang),
        c.editable.reconfigure(d.editable),
        c.wrap.reconfigure(d.wrap),
        c.aria.reconfigure(d.aria),
      ],
    });
  }, [lang, readOnly, wrap, ariaLabel, filename]);

  return <div ref={host} className="cm-host" data-language={lang.id} />;
}
