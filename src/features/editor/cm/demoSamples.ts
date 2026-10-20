// 開発用デモのサンプル文書(本番では使わない)
export const SAMPLES: { filename: string; text: string }[] = [
  {
    filename: "stg_orders.sql",
    text: `{{ config(materialized='view') }}

-- 注文データの整形。{{ ref }} は dbt のモデル参照
with source as (
    select * from {{ ref('raw_orders') }}
    where order_date >= '2024-01-01'
),
renamed as (
    select
        id as order_id,
        user_id,
        {% if var('use_cents', true) %}
        amount / 100.0 as amount_jpy,
        {% else %}
        amount as amount_jpy,
        {% endif %}
        count(*) over (partition by user_id) as order_count
    from source
)
select * from renamed
`,
  },
  {
    filename: "TaskList.tsx",
    text: `import { useState } from "react";

type Task = { id: number; title: string; done: boolean };

// 未完了を先頭に並べる
export function TaskList({ tasks }: { tasks: Task[] }) {
  const [filter, setFilter] = useState<"all" | "open">("all");
  const shown = tasks.filter((t) => filter === "all" || !t.done);
  return (
    <ul className="tasks">
      {shown.map((t) => (
        <li key={t.id} data-done={t.done}>
          {t.title} ({t.id * 2 + 1})
        </li>
      ))}
    </ul>
  );
}
`,
  },
  {
    filename: "pipeline.py",
    text: `import pandas as pd
from pathlib import Path


class Loader:
    """CSV を読み込んで整形する。"""

    def __init__(self, root: Path, limit: int = 100):
        self.root = root
        self.limit = limit

    def load(self, name: str) -> pd.DataFrame:
        # 日本語のコメントも読めること
        df = pd.read_csv(self.root / f"{name}.csv", encoding="utf-8")
        if df.empty:
            raise ValueError("空のファイルです")
        return df.head(self.limit)
`,
  },
  {
    filename: "dbt_project.yml",
    text: `name: shop_analytics   # プロジェクト名
version: "1.0.0"
profile: snowflake_dev
models:
  shop_analytics:
    staging:
      +materialized: view
      +tags: [staging, daily]
    marts:
      +materialized: table
      enabled: true
      limit: 100
`,
  },
  {
    filename: "main.rs",
    text: `use std::collections::HashMap;

/// 単語の出現数を数える
fn count_words(text: &str) -> HashMap<String, usize> {
    let mut map = HashMap::new();
    for w in text.split_whitespace() {
        *map.entry(w.to_lowercase()).or_insert(0) += 1;
    }
    map
}

fn main() {
    let counts = count_words("a b a");
    println!("{:?}", counts.get("a")); // Some(2)
}
`,
  },
];

export const MARKDOWN_SAMPLE = `# 3年計画メモ

仕事と暮らしの方向を、ゆっくり整理するためのメモです。**大事なところ**は太字で、\`inline code\` は等幅で表示します。

## 今年やること

- データ基盤の勉強（Snowflake と dbt）
- 統計の復習
  - 検定の使い分け
  - 回帰の読み方
- 週に一度の振り返り

1. 朝に十五分だけ読む
2. 昼に手を動かす
3. 夜にメモをまとめる

### チェックリスト

- [x] 計画の大枠を決める
- [x] 学習用の環境を整える
- [ ] 小さなモデルを一つ作る
- [ ] 振り返りの時間を固定する

> 焦らず、続けられる速さで進める。
> 引用はプロジェクト色の線と淡い面で表示されます。

## 比較表

| 項目 | いまの状態 | 目標 |
|---|---|---|
| SQL | 初級 | 中級 |
| dbt | 初学者 | 実務で使える |
| 統計 | 2級 | 準1級 |

## コード

\`\`\`sql
select order_id, amount
from {{ ref('stg_orders') }}
where amount > 0
\`\`\`

---

詳しくは [公式ドキュメント](https://docs.getdbt.com/) を参照。相対リンクの [別のメモ](./other.md) は何も起きません。

長い文章の例です。日本語の文章は、単語の区切りがないので、折り返しがどの位置でも自然に行われることが大切です。全角の記号「」（）、句読点、そして英数字 ABC123 が混ざっても、行間が詰まりすぎず、目が疲れない読み心地になっているかを確認します。エディタの左側で入力した内容は、右側の表示にすぐ反映されます。
`;
