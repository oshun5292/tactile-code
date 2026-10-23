import { Tag, styleTags, tags as t } from "@lezer/highlight";

// マークダウン専用のタグ。processingInstruction を共有すると他言語の色まで変わるため、
// 子タグを作って「記号(#, *, ` など)」だけを薄く、見出し記号は見出し色で出し分ける。
export const mdMark = Tag.define(t.processingInstruction);
export const mdHeadMark = Tag.define(t.processingInstruction);
export const mdListMark = Tag.define(t.processingInstruction);
export const mdQuoteMark = Tag.define(t.processingInstruction);
export const mdFenceInfo = Tag.define(t.labelName);

export const markdownTagStyles = {
  props: [
    styleTags({
      "EmphasisMark CodeMark LinkMark StrikethroughMark TableDelimiter": mdMark,
      HeaderMark: mdHeadMark,
      ListMark: mdListMark,
      QuoteMark: mdQuoteMark,
      CodeInfo: mdFenceInfo,
    }),
  ],
};
