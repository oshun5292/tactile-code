// モック用のサンプルファイル群(ブラウザで pnpm dev したときの、5つのプロジェクトの中身)。
// 中身は samples/assets/common.js のデータをもとにしている。
import type { EncodingName, Eol, FileKind } from "./types";

export type MockFileSeed = {
  content?: string; // kind が "text" のとき
  kind?: FileKind; // 省略は "text"
  size?: number; // text 以外で見せるバイト数
  eol?: Eol;
  hasBom?: boolean;
  encoding?: EncodingName; // 省略は "utf-8"
  asShiftJis?: string; // kind が "unsupportedEncoding" のとき、shift_jis で開いた場合の本文
};

const lines = (...l: string[]) => l.join("\n") + "\n";

const todo: Record<string, MockFileSeed> = {
  "README.md": {
    content: lines(
      "# ToDoアプリ", "", "React + TypeScript で作る、小さなタスク管理アプリ。", "", "## できること",
      "- [x] タスクの追加・削除", "- [x] 完了トグル", "- [ ] 期限の表示", "- [ ] タグで絞り込み", "", "## はじめかた",
      "~~~bash", "pnpm install", "pnpm dev", "~~~", "", "> メモ: 状態管理は **Zustand**。まずは動くものを優先。",
    ),
  },
  "docs/design.md": {
    content: lines(
      "# 設計メモ", "", "## 方針", "1. 型を先に決める(`Task`)", "2. 状態は store に集約", "3. 見た目は最後", "", "---", "",
      "## 未決事項", "- 期限が過ぎたタスクの見せ方", "- 完了タスクを消すか、薄くするか",
    ),
  },
  "src/types.ts": {
    content: lines(
      "export type TaskId = string;", "", "export interface Task {", "  id: TaskId;", "  title: string;", "  done: boolean;",
      "  dueDate?: string; // ISO 8601", "  tags: string[];", "}", "", "export const createTask = (title: string): Task => ({",
      "  id: crypto.randomUUID(),", "  title,", "  done: false,", "  tags: [],", "});",
    ),
  },
  "src/TaskList.tsx": {
    content: lines(
      "import { useTaskStore } from './store';", "", "export function TaskList() {", "  const tasks = useTaskStore((s) => s.tasks);",
      "  const toggle = useTaskStore((s) => s.toggle);", "", "  return (", '    <ul className="task-list">', "      {tasks.map((t) => (",
      "        <li key={t.id}>", "          <label>", "            <input", '              type="checkbox"', "              checked={t.done}",
      "              onChange={() => toggle(t.id)}", "            />", "            {t.title}", "          </label>", "        </li>",
      "      ))}", "    </ul>", "  );", "}",
    ),
  },
  "src/store.ts": {
    content: lines(
      "import { create } from 'zustand';", "import { createTask, type Task, type TaskId } from './types';", "",
      "type State = {", "  tasks: Task[];", "  add: (title: string) => void;", "  toggle: (id: TaskId) => void;", "};", "",
      "export const useTaskStore = create<State>((set) => ({", "  tasks: [],",
      "  add: (title) => set((s) => ({ tasks: [...s.tasks, createTask(title.trim())] })),",
      "  toggle: (id) =>", "    set((s) => ({", "      tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),", "    })),", "}));",
    ),
  },
  "src/styles/app.css": {
    content: lines(".task-list { list-style: none; padding: 0; }", ".task-list li { padding: 6px 0; }", ".task-list label { display: flex; gap: 8px; }"),
  },
  "package.json": {
    content: lines("{", '  "name": "todo-app",', '  "private": true,', '  "scripts": { "dev": "vite", "build": "tsc && vite build" }', "}"),
  },
  "assets/logo.png": { kind: "binary", size: 18_432 },
};

const sales: Record<string, MockFileSeed> = {
  "README.md": { content: lines("# 売上データ分析", "", "2024-2026 の注文データから、月別の売上と前年比を出す。", "", "## 使い方", "~~~bash", "python analyze.py", "~~~") },
  "notes.md": {
    content: lines(
      "# 分析メモ", "", "## 気づき", "- 11月と12月に売上が集中している", "- **前年比** は 2025年から横ばい", "- 欠損は `amount` が空の行だけ", "",
      "## 次にやること", "- [ ] 商品カテゴリ別に分解する", "- [ ] グラフを matplotlib で出す", "- [x] 欠損行の除外",
    ),
  },
  "analyze.py": {
    content: lines(
      "import pandas as pd", "", "", "def load_sales(path: str) -> pd.DataFrame:", '    df = pd.read_csv(path, parse_dates=["order_date"])',
      '    return df.dropna(subset=["amount"])', "", "", "def monthly_summary(df: pd.DataFrame) -> pd.DataFrame:", "    monthly = (",
      '        df.assign(month=df["order_date"].dt.to_period("M"))', '          .groupby("month", as_index=False)["amount"].sum()', "    )",
      '    monthly["yoy"] = monthly["amount"].pct_change(12)', "    return monthly", "", "", 'if __name__ == "__main__":',
      '    print(monthly_summary(load_sales("data/sales.csv")).tail())',
    ),
  },
  "queries/monthly.sql": {
    content: lines("select date_trunc('month', order_date) as month,", "       sum(amount)                    as sales", "from orders", "group by 1", "order by 1"),
  },
  "data/sales.csv": { kind: "tooLarge", size: 48_300_000 },
  "data/legacy_shiftjis.txt": {
    kind: "unsupportedEncoding",
    size: 2_048,
    asShiftJis: lines("売上メモ(旧システムの出力)", "2024年12月は前年比 +8%。"),
  },
  "data/jp_euc.txt": { content: lines("EUC-JP 判定済みのサンプル", "日本語の本文です。"), encoding: "euc-jp" },
};

const dbt: Record<string, MockFileSeed> = {
  "README.md": { content: lines("# dbt × Snowflake", "", "注文データを `staging` → `marts` へ整える練習用プロジェクト。", "", "## コマンド", "~~~bash", "dbt build --select staging", "~~~") },
  "models/staging/stg_orders.sql": {
    content: lines(
      "with source as (", "", "    select * from {{ source('shop', 'orders') }}", "", "),", "", "renamed as (", "", "    select", "        id               as order_id,",
      "        user_id          as customer_id,", "        status,", "        amount / 100     as amount_jpy,", "        created_at::date as ordered_on", "    from source", "",
      ")", "", "select * from renamed",
    ),
  },
  "models/marts/fct_sales.sql": {
    content: lines(
      "{{ config(materialized='table') }}", "", "select", "    ordered_on,", "    count(*)         as order_count,", "    sum(amount_jpy)  as sales_jpy",
      "from {{ ref('stg_orders') }}", "{% if is_incremental() %}", "where ordered_on > (select max(ordered_on) from {{ this }})", "{% endif %}",
      "group by 1", "order by 1",
    ),
  },
  "models/schema.yml": {
    content: lines(
      "version: 2", "", "models:", "  - name: stg_orders", "    description: 注文データ(整形済み)", "    columns:", "      - name: order_id", "        tests:",
      "          - unique", "          - not_null",
    ),
  },
  "dbt_project.yml": { content: lines("name: dbt_snowflake", "version: '1.0.0'", "profile: snowflake", "model-paths: ['models']") },
};

const life: Record<string, MockFileSeed> = {
  "README.md": { content: lines("# 人生設計 2027-2029", "", "3年後にどうなっていたいかを、言葉にしていく場所。") },
  "3year-plan.md": {
    content: lines(
      "# 3年プラン", "", "## 2027", "- [x] dbt を実務で使えるようになる", "- [ ] Snowflake の設計を1本任される", "", "## 2028", "- [ ] 小さなアプリを1つ公開する",
      "- [ ] 統計の勉強を再開する", "", "## 2029", "- [ ] 自分の得意を **一言で** 言える", "", "> 迷ったら、毎週の振り返りに戻る。", "",
      "| 年 | テーマ | 目安 |", "|---|---|---|", "| 2027 | 実務の土台 | dbt / Snowflake |", "| 2028 | 作って公開 | 小さなアプリ |", "| 2029 | 一言で言える | 得意の言語化 |",
    ),
    eol: "crlf",
  },
  "values.md": { content: lines("# 大事にしたいこと", "", "1. 学び続けられる環境", "2. 手を動かして確かめる", "3. 無理のないペース", "", "## しないこと", "- 比べすぎる", "- 完璧を待つ") },
  "reading-list.md": { content: lines("# 読みたい本", "", "- [ ] データ指向アプリケーションデザイン", "- [ ] 統計学が最強の学問である", "- [x] SQL実践入門") },
  "journal/2027-01.md": { content: lines("# 2027年1月", "", "- 週1回の振り返りを始めた") },
};

const memo: Record<string, MockFileSeed> = {
  "README.md": { content: lines("# メモ型AIエディタ(仮)", "", "ボードにプロジェクトを並べ、クリックすると **エディタ** が開く。", "", "- ボード: 自由配置・手書き・丸囲み", "- エディタ: マークダウン / コード / レビュー", "- AI: メモごとの会話") },
  "design-notes.md": {
    content: lines("# 設計メモ", "", "## 層", "1. 画面(React)", "2. 中核(Rust)", "3. AI実行(窓口の裏)", "", "## 決めたこと", "- [x] Tauri v2", "- [x] React Flow", "- [ ] AIは Vercel AI SDK から", "", "> 見た目は「使い始めたくなる」ことを最優先に。"),
  },
  "src-tauri/src/agent/mod.rs": {
    content: lines(
      "use tokio::sync::mpsc::Sender;", "", "pub enum AgentEvent {", "    TextDelta(String),", "    ToolUse { name: String },", "    PermissionRequested { id: String, command: String },",
      "    Completed,", "}", "", "#[async_trait::async_trait]", "pub trait AgentBackend: Send + Sync {", "    async fn start_turn(", "        &self,", "        cwd: std::path::PathBuf,",
      "        text: String,", "        tx: Sender<AgentEvent>,", "    ) -> anyhow::Result<()>;", "}",
    ),
  },
  "src-tauri/Cargo.toml": { content: lines("[package]", 'name = "tactile-code"', 'version = "0.1.0"', "", "[dependencies]", 'serde = { version = "1", features = ["derive"] }') },
  "src/features/canvas/MemoNode.tsx": {
    content: lines(
      "import { memo } from 'react';", "", "type Props = { data: { memoId: string; title: string } };", "", "export const MemoNode = memo(function MemoNode({ data }: Props) {",
      "  return (", '    <div className="memo-node">', "      <h3>{data.title}</h3>", "    </div>", "  );", "});",
    ),
  },
  "scripts/build.sh": { content: lines("#!/usr/bin/env bash", "set -euo pipefail", "", "# 本番ビルド", "pnpm build", 'echo "done"') },
};

export const MOCK_FILES: Record<string, Record<string, MockFileSeed>> = {
  "mock-1": todo,
  "mock-2": sales,
  "mock-3": dbt,
  "mock-4": life,
  "mock-5": memo,
};
