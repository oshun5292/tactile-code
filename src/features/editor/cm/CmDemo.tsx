import { useState } from "react";
import { CodeEditor } from "./CodeEditor";
import { MarkdownEditor } from "./MarkdownEditor";
import { MARKDOWN_SAMPLE, SAMPLES } from "./demoSamples";

// 開発用デモ(?demo=cm)。本番ビルドでは App から読み込まれない。
const COLORS: Record<string, [string, string]> = {
  sky: ["var(--sky)", "var(--sky-d)"],
  mint: ["var(--mint)", "var(--mint-d)"],
  lav: ["var(--lav)", "var(--lav-d)"],
  peach: ["var(--peach)", "var(--peach-d)"],
};

export default function CmDemo() {
  const [color, setColor] = useState("sky");
  const [mode, setMode] = useState<"edit" | "split" | "preview">("split");
  const [md, setMd] = useState(MARKDOWN_SAMPLE);
  const [docs, setDocs] = useState(SAMPLES.map((s) => s.text));
  const [saved, setSaved] = useState(0);
  const params = new URLSearchParams(window.location.search);
  const only = params.get("only"); // "md" ならマークダウンのみ、数字ならその言語のみ
  const style = { "--proj": COLORS[params.get("c") ?? color][0], "--proj-d": COLORS[params.get("c") ?? color][1] } as React.CSSProperties;

  return (
    <div style={{ ...style, padding: 16, background: "var(--bg)", minHeight: "100%" }} data-testid="cm-demo">
      <div style={{ display: "flex", gap: 8, marginBottom: 10, fontSize: 12 }}>
        <b>CM demo</b>
        {Object.keys(COLORS).map((c) => (
          <button key={c} onClick={() => setColor(c)}>{c}</button>
        ))}
        {(["edit", "split", "preview"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}>{m}</button>
        ))}
        <button onClick={() => setMd((v) => v + "\n外から追記した行\n")}>外から追記</button>
        <span>Ctrl+S 回数: <span data-testid="saved">{saved}</span></span>
      </div>
      {only !== null && only !== "md" ? null : (
        <div style={{ height: only === "md" ? 900 : 520, border: "1px solid var(--line)", marginBottom: 16 }}>
          <MarkdownEditor value={md} onChange={setMd} onSave={() => setSaved((n) => n + 1)} mode={(params.get("mode") as typeof mode) ?? mode} />
        </div>
      )}
      {only === "md" ? null : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {SAMPLES.map((s, i) =>
            only !== null && Number(only) !== i ? null : (
              <div key={s.filename} style={{ border: "1px solid var(--line)", height: 330, display: "flex", flexDirection: "column" }}>
                <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, padding: "4px 10px", color: "var(--soft)", borderBottom: "1px solid var(--line)" }}>{s.filename}</div>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <CodeEditor
                    value={docs[i]}
                    filename={s.filename}
                    onChange={(v) => setDocs((d) => d.map((x, j) => (j === i ? v : x)))}
                    onSave={() => setSaved((n) => n + 1)}
                  />
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
