import "./markdown.css";
import type { MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";


const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// リンクは画面を遷移させない。http(s) だけ外部で開き、相対リンクなどは何もしない(MVP)。
async function openExternal(href: string) {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(href);
  } else {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

const components: Components = {
  a({ href, children }) {
    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      if (href && /^https?:\/\//i.test(href)) void openExternal(href).catch(() => {});
    };
    return (
      <a href={href} onClick={onClick} title={href} rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  // タスクリストのチェックは、操作できない丸で表示する
  input({ type, checked }) {
    if (type !== "checkbox") return null;
    return (
      <span className="md-check" data-done={checked ? "true" : "false"} role="img" aria-label={checked ? "完了" : "未完了"}>
        {checked ? "✓" : ""}
      </span>
    );
  },
  li({ className, children }) {
    const task = className?.includes("task-list-item");
    return <li className={task ? "md-task" : undefined}>{children}</li>;
  },
  ul({ className, children }) {
    return <ul className={className?.includes("contains-task-list") ? "md-tasks" : undefined}>{children}</ul>;
  },
  // 画像は alt テキストの表示のみ(MVP)
  img({ alt }) {
    return <span className="md-img-alt">{alt ? `[画像: ${alt}]` : "[画像]"}</span>;
  },
  table({ children }) {
    return (
      <div className="md-table-wrap">
        <table>{children}</table>
      </div>
    );
  },
};

export function MarkdownPreview({ value }: { value: string }) {
  return (
    <div className="md-out">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {value}
      </ReactMarkdown>
    </div>
  );
}
