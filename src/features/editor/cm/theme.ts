import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

// プロジェクト色。--proj が無ければ空色。値は :root の CSS 変数を毎回参照するので、
// --proj の変更だけで、エディタを作り直さずに選択色・アクセントが変わる。
const P = "var(--proj, var(--sky-d))";
const PD = "var(--proj-d, var(--sky-d))";
const mix = (pct: number) => `color-mix(in srgb, ${P} ${pct}%, transparent)`;

export const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--ink)",
    backgroundColor: "var(--white)",
    fontSize: "13px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--mono)",
    lineHeight: "1.7",
    fontVariantLigatures: "none",
    fontFeatureSettings: '"liga" 0, "calt" 0',
  },
  ".cm-content": { padding: "10px 0 30px", caretColor: PD },
  ".cm-line": { padding: "0 16px 0 6px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: PD, borderLeftWidth: "2px" },
  ".cm-gutters": {
    backgroundColor: "var(--white)",
    color: "color-mix(in srgb, var(--soft) 70%, transparent)",
    border: "none",
    fontSize: "12px",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 14px", minWidth: "3ch" },
  ".cm-activeLine": { backgroundColor: mix(7) },
  ".cm-activeLineGutter": { backgroundColor: mix(10), color: "var(--ink)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: mix(28) },
  ".cm-selectionMatch": { backgroundColor: mix(16) },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: mix(30),
    outline: `1px solid ${mix(60)}`,
  },
  "&.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--danger) 22%, transparent)",
  },
  ".cm-searchMatch": { backgroundColor: "var(--butter)", outline: "1px solid var(--butter-d)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--amber)" },
  ".cm-panels": {
    backgroundColor: "var(--bg2)",
    color: "var(--ink)",
    fontFamily: "var(--round)",
  },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--line)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--line)" },
  ".cm-panel.cm-search": { padding: "8px 28px 8px 10px", fontSize: "12.5px" },
  ".cm-panel.cm-search input, .cm-panel.cm-search button": {
    fontFamily: "var(--round)",
    fontSize: "12.5px",
  },
  ".cm-panel.cm-search input.cm-textfield": {
    border: "1px solid var(--line)",
    borderRadius: "8px",
    backgroundColor: "var(--white)",
    padding: "3px 8px",
  },
  ".cm-panel.cm-search button": {
    border: "1px solid var(--line)",
    borderRadius: "99px",
    backgroundImage: "none",
    backgroundColor: "var(--white)",
    padding: "2px 10px",
    cursor: "pointer",
  },
  ".cm-panel.cm-search button:hover": { backgroundColor: mix(14) },
  ".cm-panel.cm-search [name=close]": { color: "var(--soft)", border: "none", background: "none" },
  ".cm-placeholder": { color: "var(--soft)" },
});

// 色は36の見本の .tk-*(キーワード=紫寄りの赤紫、文字列=緑、コメント=灰、数字=琥珀、関数=青)
const KW = "var(--tk-kw, #a73c82)";
const STR = "var(--tk-str, #3a8452)";
const COM = "var(--tk-com, #8f887a)";
const NUM = "var(--tk-num, #b8691a)";
const FN = "var(--tk-fn, #2f68b5)";
const META = "var(--tk-meta, #7a52b8)";
const TYPE = "var(--tk-type, #0e7c86)";

export const highlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.modifier, t.definitionKeyword], color: KW, fontWeight: "500" },
  { tag: [t.string, t.special(t.string), t.regexp], color: STR },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: COM, fontStyle: "italic" },
  { tag: [t.number, t.bool, t.null, t.atom], color: NUM },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: FN },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: FN },
  { tag: [t.typeName, t.className, t.namespace], color: TYPE },
  { tag: [t.propertyName, t.attributeName], color: "var(--tk-prop, #2a6f8f)" },
  { tag: [t.tagName, t.angleBracket], color: KW },
  { tag: [t.meta, t.annotation, t.processingInstruction, t.self], color: META },
  { tag: [t.special(t.brace), t.definitionOperator], color: META, fontWeight: "600" },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: "var(--ink2)" },
  { tag: [t.link, t.url], color: FN, textDecoration: "underline" },
  { tag: t.heading, color: "var(--ink)", fontWeight: "700" },
  { tag: t.heading1, fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.quote, color: "var(--ink2)", fontStyle: "italic" },
  { tag: t.monospace, color: STR },
  { tag: t.invalid, color: "var(--danger)" },
]);

export const themeExtensions: Extension[] = [editorTheme, syntaxHighlighting(highlightStyle)];
