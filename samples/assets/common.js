/*!
 * MemoLab common.js  —  見た目サンプル共通の「振る舞い」部品(見た目は持たない)
 *
 * 各サンプルHTMLは、このファイルを <script src="assets/common.js"></script> で読み込み、
 * 見た目(HTML/CSS/SVG)だけを自由に作る。ここには "ふるまい" だけがある。
 *
 * ─ 必須の骨組み ───────────────────────────────────────────────
 *   <body data-view="board">
 *     <div id="board">                       ← ボード(プロジェクト一覧)。position:relative か absolute, 画面いっぱい
 *       <svg id="deco"></svg>                ← 丸囲み/コネクタ線の描画レイヤ(pointer-events:none, inset:0, 100%x100%)
 *       <div data-project="todo-app" data-drag class="…" style="left:…;top:…"> … </div>   ← プロジェクトのカード(position:absolute)
 *       <svg id="pen"></svg>                 ← 手書きペンのレイヤ(inset:0, 100%x100%, 最前面)
 *       <button data-action="pen">…</button> など
 *     </div>
 *     <div id="editor"> … スロット(下記) … </div>   ← エディタ。#board と同じ階層に置く
 *   </body>
 *
 * ─ data 属性 / スロット ───────────────────────────────────────
 *   [data-project="ID"]   クリックでエディタを開く。ID: todo-app / sales-analysis / dbt-snowflake / life-plan / memo-editor
 *   [data-drag]           ドラッグで動かせる(left/top を書き換える。position:absolute 必須)
 *   [data-action="back"]  エディタ→ボードへ戻る(Escキーも可)
 *   [data-action="pen"]   手書きペンのON/OFF(押している間は aria-pressed="true"、body[data-pen="on"])
 *   [data-pen-color="#c33"]  ペンの色を選ぶ(押すとペンもONになる)
 *   [data-action="pen-undo"] / [data-action="pen-clear"]
 *   エディタ内スロット(中身は common.js が生成。クラス名で見た目をつける):
 *     [data-slot="title"] [data-slot="path"] [data-slot="lang"] [data-slot="blurb"] [data-slot="branch"]  … テキストが入る
 *     [data-slot="tree"]   ファイルツリー    .ml-tree .ml-tree-dir(.ml-tree-children) .ml-tree-file[data-active] .ml-ico[data-kind]
 *     [data-slot="tabs"]   タブ              .ml-tab[data-active] .ml-tab-title .ml-tab-close
 *     [data-slot="doc"]    本文              .ml-doc[data-kind="md|code|diff"][data-mode="edit|split|preview"]
 *                            .ml-doc-bar .ml-doc-path .ml-mode[data-md-mode]
 *                            md   : .ml-md > textarea.ml-md-src + .ml-md-out(h1 h2 h3 p ul ol li blockquote code pre.ml-pre hr .ml-task[data-done] .ml-check)
 *                            code : .ml-code > .ml-line[data-k="ctx|add|del|hunk"] > .ml-ln + .ml-sign + .ml-src(.tk-kw .tk-str .tk-com .tk-num .tk-fn .tk-meta)
 *                                   行番号クリックでレビューコメントを書ける → .ml-comment[data-who="ai|me"] > .ml-comment-who + .ml-comment-text
 *     [data-slot="chat"]   AI会話            .ml-chat > .ml-chat-log(.ml-msg[data-role="user|ai"] > .ml-msg-body, .ml-perm) + form.ml-chat-form(textarea + button.ml-send)
 *   JS: MemoLab.open(id,{file,mode,instant}) / MemoLab.back() / MemoLab.openFile(path)
 *       MemoLab.ready(fn)                      DOM準備後に実行(装飾の登録はここで)
 *       MemoLab.around(el|selector,{shape:'circle|box|underline|highlight',color,width,pad,seed,svg})  手書き風の丸囲み
 *       MemoLab.link(a,b,{color,width,dash,dots,curve,svg})                                          手書き風コネクタ線(ドラッグに追従)
 *       MemoLab.scribble(kind,x,y,w,h,{color,width,svg})   kind: arrow|star|spiral|check|zigzag|cross
 *       MemoLab.projects                                    サンプルデータ
 *         各プロジェクト: id name path lang branch blurb review / langs([[言語,%]…] 自動検知の内訳) progress(0-100) note(ひと言) updated updatedAgo
 *                         github({repo visibility state:'synced|ahead|behind' ahead behind prs ci:'passing|failing|none'} / 連携なしは null)
 *
 * ─ ビュー切り替え(アニメは各サンプルのCSSで作る) ──────────────────────
 *   body[data-view="board"|"editor"], 切替中の約900msだけ body[data-phase="to-editor"|"to-board"]。
 *   クリックしたカードの中心座標が :root の --ox --oy(px), --oxp --oyp(%) に入る(ズーム起点に使える)。
 *   body[data-project="ID"] に開いているプロジェクト。
 *   既定では「切替中以外、非アクティブ側は visibility:hidden」。アニメは opacity/transform で作ること。
 *
 * ─ スクリーンショット用 ─────────────────────────────────────
 *   file:///…/NN-name.html#open=todo-app&file=src/types.ts&mode=split   → 最初からエディタ表示(アニメなし)
 */
(function () {
  'use strict';
  var ML = (window.MemoLab = {});
  var NS = 'http://www.w3.org/2000/svg';
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function svgEl(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs || {}) e.setAttribute(k, attrs[k]); return e; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function f(n) { return Math.round(n * 10) / 10; }
  function mulberry(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function storeGet(k) { try { return JSON.parse(localStorage.getItem('memolab:' + location.pathname + ':' + k)); } catch (e) { return null; } }
  function storeSet(k, v) { try { localStorage.setItem('memolab:' + location.pathname + ':' + k, JSON.stringify(v)); } catch (e) {} }

  /* ================= データ ================= */
  var PROJECTS = [
    {
      id: 'todo-app', name: 'ToDoアプリ', path: 'C:\\Users\\ashun\\dev\\todo-app', lang: 'TypeScript', branch: 'feat/toggle-done',
      blurb: 'React + TypeScript の小さなタスク管理', review: 2,
      langs: [['TypeScript', 82], ['CSS', 11], ['JSON', 7]], progress: 60, note: '完了トグルを実装中。次は期限の表示', updated: '10/18', updatedAgo: '2日前',
      github: { repo: 'ashun/todo-app', visibility: 'private', state: 'ahead', ahead: 2, behind: 0, prs: 1, ci: 'passing' }, start: 'README.md', open: ['README.md', 'src/TaskList.tsx', 'review/完了トグルの追加.diff'],
      chat: [['user', '完了トグルを追加したい。まず store から。'], ['ai', 'toggle アクションを store.ts に足しました。差分はレビュータブで確認できます。']],
      files: [
        { path: 'README.md', kind: 'md', text: [
          '# ToDoアプリ', '', 'React + TypeScript で作る、小さなタスク管理アプリ。', '', '## できること',
          '- [x] タスクの追加・削除', '- [x] 完了トグル', '- [ ] 期限の表示', '- [ ] タグで絞り込み', '', '## はじめかた',
          '~~~bash', 'pnpm install', 'pnpm dev', '~~~', '', '> メモ: 状態管理は **Zustand**。まずは動くものを優先。'].join('\n') },
        { path: 'docs/design.md', kind: 'md', text: [
          '# 設計メモ', '', '## 方針', '1. 型を先に決める(`Task`)', '2. 状態は store に集約', '3. 見た目は最後', '', '---', '',
          '## 未決事項', '- 期限が過ぎたタスクの見せ方', '- 完了タスクを消すか、薄くするか'].join('\n') },
        { path: 'src/types.ts', kind: 'code', lang: 'ts', text: [
          'export type TaskId = string;', '', 'export interface Task {', '  id: TaskId;', '  title: string;', '  done: boolean;',
          '  dueDate?: string; // ISO 8601', '  tags: string[];', '}', '', 'export const createTask = (title: string): Task => ({',
          '  id: crypto.randomUUID(),', '  title,', '  done: false,', '  tags: [],', '});'].join('\n'),
          comments: [{ match: 'dueDate', who: 'ai', text: '期限は文字列(ISO 8601)で持つと保存しやすいです。' }] },
        { path: 'src/TaskList.tsx', kind: 'code', lang: 'tsx', text: [
          "import { useTaskStore } from './store';", '', 'export function TaskList() {', '  const tasks = useTaskStore((s) => s.tasks);',
          '  const toggle = useTaskStore((s) => s.toggle);', '', '  return (', '    <ul className="task-list">', '      {tasks.map((t) => (',
          '        <li key={t.id}>', '          <label>', '            <input', '              type="checkbox"', '              checked={t.done}',
          '              onChange={() => toggle(t.id)}', '            />', '            {t.title}', '          </label>', '        </li>',
          '      ))}', '    </ul>', '  );', '}'].join('\n') },
        { path: 'review/完了トグルの追加.diff', kind: 'diff', lang: 'ts', text: [
          '@@ -8,6 +8,14 @@ src/store.ts', ' export const useTaskStore = create<State>((set) => ({', '   tasks: [],',
          '+  toggle: (id) =>', '+    set((s) => ({', '+      tasks: s.tasks.map((t) =>', '+        t.id === id ? { ...t, done: !t.done } : t', '+      ),', '+    })),',
          '-  add: (title) => set((s) => ({ tasks: [...s.tasks, createTask(title)] })),', '+  add: (title) => set((s) => ({ tasks: [...s.tasks, createTask(title.trim())] })),', ' }));'].join('\n'),
          comments: [
            { match: 'toggle: (id)', who: 'ai', text: '比較は問題ありません。完了時刻 completedAt を持たせると、あとで集計しやすくなります。' },
            { match: 'title.trim()', who: 'me', text: '空文字のタスクは弾きたい。バリデーションはどこに置く?' }] }
      ]
    },
    {
      id: 'sales-analysis', name: '売上データ分析', path: 'C:\\Users\\ashun\\dev\\sales-analysis', lang: 'Python', branch: 'main',
      blurb: '月別の売上推移と前年比を出す', review: 1,
      langs: [['Python', 91], ['SQL', 9]], progress: 40, note: '前年比で欠けている月を確認中', updated: '10/16', updatedAgo: '4日前',
      github: { repo: 'ashun/sales-analysis', visibility: 'private', state: 'synced', ahead: 0, behind: 0, prs: 0, ci: 'passing' }, start: 'notes.md', open: ['notes.md', 'analyze.py'],
      chat: [['user', '月別の売上推移を出して、前年比も見たい。'], ['ai', 'pandas で月次集計し、pct_change(12) で前年比を計算しました。']],
      files: [
        { path: 'README.md', kind: 'md', text: ['# 売上データ分析', '', '2024-2026 の注文データから、月別の売上と前年比を出す。', '', '## 使い方', '~~~bash', 'python analyze.py', '~~~'].join('\n') },
        { path: 'notes.md', kind: 'md', text: [
          '# 分析メモ', '', '## 気づき', '- 11月と12月に売上が集中している', '- **前年比** は 2025年から横ばい', '- 欠損は `amount` が空の行だけ', '',
          '## 次にやること', '- [ ] 商品カテゴリ別に分解する', '- [ ] グラフを matplotlib で出す', '- [x] 欠損行の除外'].join('\n') },
        { path: 'analyze.py', kind: 'code', lang: 'py', text: [
          'import pandas as pd', '', '', 'def load_sales(path: str) -> pd.DataFrame:', '    df = pd.read_csv(path, parse_dates=["order_date"])',
          '    return df.dropna(subset=["amount"])', '', '', 'def monthly_summary(df: pd.DataFrame) -> pd.DataFrame:', '    monthly = (',
          '        df.assign(month=df["order_date"].dt.to_period("M"))', '          .groupby("month", as_index=False)["amount"].sum()', '    )',
          '    monthly["yoy"] = monthly["amount"].pct_change(12)', '    return monthly', '', '', 'if __name__ == "__main__":',
          '    print(monthly_summary(load_sales("data/sales.csv")).tail())'].join('\n') },
        { path: 'review/前年比の計算を修正.diff', kind: 'diff', lang: 'py', text: [
          '@@ -11,5 +11,6 @@ analyze.py', ' def monthly_summary(df: pd.DataFrame) -> pd.DataFrame:', '     monthly = (',
          '-        df.assign(month=df["order_date"].dt.month)', '+        df.assign(month=df["order_date"].dt.to_period("M"))', '           .groupby("month", as_index=False)["amount"].sum()',
          '     )', '-    monthly["yoy"] = monthly["amount"].pct_change()', '+    monthly["yoy"] = monthly["amount"].pct_change(12)', '     return monthly'].join('\n'),
          comments: [{ match: 'pct_change(12)', who: 'ai', text: '月次データなので12行前との比較=前年同月比になります。欠けた月があると位置がずれる点に注意。' }] }
      ]
    },
    {
      id: 'dbt-snowflake', name: 'dbt × Snowflake', path: 'C:\\Users\\ashun\\dev\\dbt-snowflake', lang: 'SQL / dbt', branch: 'main',
      blurb: 'staging から marts まで、モデルを整理する', review: 1,
      langs: [['SQL', 74], ['YAML', 18], ['Jinja', 8]], progress: 55, note: 'staging は完了。marts はこれから', updated: '10/12', updatedAgo: '1週間前',
      github: { repo: 'ashun/dbt-snowflake', visibility: 'private', state: 'behind', ahead: 0, behind: 1, prs: 0, ci: 'failing' }, start: 'models/staging/stg_orders.sql', open: ['models/staging/stg_orders.sql', 'models/schema.yml'],
      chat: [['user', 'stg_orders の列名をそろえたい。'], ['ai', '金額は円に直して amount_jpy にしました。schema.yml のテストも足しています。']],
      files: [
        { path: 'README.md', kind: 'md', text: ['# dbt × Snowflake', '', '注文データを `staging` → `marts` へ整える練習用プロジェクト。', '', '## コマンド', '~~~bash', 'dbt build --select staging', '~~~'].join('\n') },
        { path: 'models/staging/stg_orders.sql', kind: 'code', lang: 'sql', text: [
          'with source as (', '', "    select * from {{ source('shop', 'orders') }}", '', '),', '', 'renamed as (', '', '    select', '        id               as order_id,',
          '        user_id          as customer_id,', '        status,', '        amount / 100     as amount_jpy,', '        created_at::date as ordered_on', '    from source', '',
          ')', '', 'select * from renamed'].join('\n'),
          comments: [{ match: 'amount / 100', who: 'ai', text: '整数除算にならないか確認を。Snowflake では NUMBER 同士の除算は小数になります。' }] },
        { path: 'models/marts/fct_sales.sql', kind: 'code', lang: 'sql', text: [
          'select', '    ordered_on,', '    count(*)         as order_count,', '    sum(amount_jpy)  as sales_jpy', "from {{ ref('stg_orders') }}",
          "where status = 'completed'", 'group by 1', 'order by 1'].join('\n') },
        { path: 'models/schema.yml', kind: 'code', lang: 'yaml', text: [
          'version: 2', '', 'models:', '  - name: stg_orders', '    description: 注文データ(整形済み)', '    columns:', '      - name: order_id', '        tests:', '          - unique', '          - not_null'].join('\n') },
        { path: 'review/列名の統一.diff', kind: 'diff', lang: 'sql', text: [
          '@@ -9,6 +9,7 @@ models/staging/stg_orders.sql', '     select', '-        id as order_id,', '+        id               as order_id,', '         user_id          as customer_id,',
          '         status,', '-        amount,', '+        amount / 100     as amount_jpy,', '         created_at::date as ordered_on'].join('\n') }
      ]
    },
    {
      id: 'life-plan', name: '人生設計 2027-2029', path: 'C:\\Users\\ashun\\notes\\life-plan', lang: 'Markdown', branch: 'main',
      blurb: '3年後にどうなっていたいかを、言葉にしていく', review: 0,
      langs: [['Markdown', 100]], progress: 30, note: '2027年の目標を書き終えた', updated: '10/19', updatedAgo: '昨日',
      github: { repo: 'ashun/private-notes', visibility: 'private', state: 'synced', ahead: 0, behind: 0, prs: 0, ci: 'none' }, start: '3year-plan.md', open: ['3year-plan.md', 'values.md'],
      chat: [['user', '3年後にデータエンジニアとしてどうなっていたいか整理したい。'], ['ai', '「得意にしたいこと」「働き方」「収入」の3つに分けて、一言ずつ聞かせてください。']],
      files: [
        { path: '3year-plan.md', kind: 'md', text: [
          '# 3年プラン', '', '## 2027', '- [x] dbt を実務で使えるようになる', '- [ ] Snowflake の設計を1本任される', '', '## 2028', '- [ ] 小さなアプリを1つ公開する', '- [ ] 統計の勉強を再開する', '',
          '## 2029', '- [ ] 自分の得意を **一言で** 言える', '', '> 迷ったら、毎週の振り返りに戻る。'].join('\n') },
        { path: 'values.md', kind: 'md', text: [
          '# 大事にしたいこと', '', '1. 学び続けられる環境', '2. 手を動かして確かめる', '3. 無理のないペース', '', '## しないこと', '- 比べすぎる', '- 完璧を待つ'].join('\n') },
        { path: 'reading-list.md', kind: 'md', text: ['# 読みたい本', '', '- [ ] データ指向アプリケーションデザイン', '- [ ] 統計学が最強の学問である', '- [x] SQL実践入門'].join('\n') }
      ]
    },
    {
      id: 'memo-editor', name: 'このアプリ自身', path: 'C:\\Users\\ashun\\Documents\\00_active\\memo_editor', lang: 'Rust + TypeScript', branch: 'main',
      blurb: 'メモ型AIエディタ(Tauri)。いま作っているもの', review: 1,
      langs: [['Rust', 46], ['TypeScript', 44], ['CSS', 10]], progress: 20, note: '見た目を決めている最中', updated: '今日', updatedAgo: '今日',
      github: null, start: 'design-notes.md', open: ['design-notes.md', 'src-tauri/src/agent/mod.rs'],
      chat: [['user', 'AIの窓口を trait で切りたい。'], ['ai', 'AgentBackend trait を作り、イベントは AgentEvent に正規化しました。']],
      files: [
        { path: 'README.md', kind: 'md', text: ['# メモ型AIエディタ(仮)', '', 'ボードにプロジェクトを並べ、クリックすると **エディタ** が開く。', '', '- ボード: 自由配置・手書き・丸囲み', '- エディタ: マークダウン / コード / レビュー', '- AI: メモごとの会話'].join('\n') },
        { path: 'design-notes.md', kind: 'md', text: [
          '# 設計メモ', '', '## 層', '1. 画面(React)', '2. 中核(Rust)', '3. AI実行(窓口の裏)', '', '## 決めたこと', '- [x] Tauri v2', '- [x] React Flow', '- [ ] AIは Vercel AI SDK から',
          '', '> 見た目は「使い始めたくなる」ことを最優先に。'].join('\n') },
        { path: 'src-tauri/src/agent/mod.rs', kind: 'code', lang: 'rust', text: [
          'use tokio::sync::mpsc::Sender;', '', 'pub enum AgentEvent {', '    TextDelta(String),', '    ToolUse { name: String },', '    PermissionRequested { id: String, command: String },',
          '    Completed,', '}', '', '#[async_trait::async_trait]', 'pub trait AgentBackend: Send + Sync {', '    async fn start_turn(', '        &self,', '        cwd: std::path::PathBuf,',
          '        text: String,', '        tx: Sender<AgentEvent>,', '    ) -> anyhow::Result<()>;', '}'].join('\n'),
          comments: [{ match: 'PermissionRequested', who: 'ai', text: '許可の応答は別の command で返す設計にすると、スマホからも押せるようになります。' }] },
        { path: 'src/features/canvas/MemoNode.tsx', kind: 'code', lang: 'tsx', text: [
          "import { memo } from 'react';", '', 'type Props = { data: { memoId: string; title: string } };', '', 'export const MemoNode = memo(function MemoNode({ data }: Props) {',
          '  return (', '    <div className="memo-node">', '      <h3>{data.title}</h3>', '    </div>', '  );', '});'].join('\n') },
        { path: 'review/AgentEventの追加.diff', kind: 'diff', lang: 'rust', text: [
          '@@ -3,5 +3,7 @@ src-tauri/src/agent/mod.rs', ' pub enum AgentEvent {', '     TextDelta(String),', '+    ToolUse { name: String },',
          '+    PermissionRequested { id: String, command: String },', '     Completed,', ' }'].join('\n'),
          comments: [{ match: 'ToolUse', who: 'me', text: 'ツールの入力は長いので、要約だけ持たせたい。' }] }
      ]
    }
  ];
  ML.projects = PROJECTS;
  function project(id) { for (var i = 0; i < PROJECTS.length; i++) if (PROJECTS[i].id === id) return PROJECTS[i]; return null; }

  /* ================= シンタックスハイライト(簡易) ================= */
  var LANGS = {
    ts: { c: '\\/\\/.*', kw: 'import|export|from|const|let|var|function|return|interface|type|extends|new|if|else|true|false|string|number|boolean|undefined|null|as|default|async|await|class|void' },
    py: { c: '#.*', kw: 'def|import|from|as|return|if|else|elif|for|in|with|class|None|True|False|not|and|or|is|lambda|print' },
    sql: { c: '--.*', i: 1, meta: '\\{\\{.*?\\}\\}', kw: 'select|from|with|as|where|group|by|order|join|left|on|and|or|case|when|then|end|count|sum|distinct' },
    yaml: { c: '#.*', kw: 'version|name|description|columns|tests|models|unique|not_null|sources|tables|config|materialized' },
    rust: { c: '\\/\\/.*', kw: 'use|pub|enum|trait|fn|async|impl|let|mut|struct|match|Self|self|mod|type|where|dyn|std' }
  };
  var ALIAS = { tsx: 'ts', js: 'ts', jsx: 'ts', python: 'py', rs: 'rust', yml: 'yaml' };
  function hl(lang, text) {
    lang = ALIAS[lang] || lang; var d = LANGS[lang]; if (!d) return esc(text);
    var src = '(' + d.c + ')|("(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\')|(\\b\\d+(?:\\.\\d+)?\\b)|(\\b(?:' + d.kw + ')\\b)|(\\b[A-Za-z_]\\w*(?=\\())|(' + (d.meta || '(?!)') + ')';
    var re = new RegExp(src, 'g' + (d.i ? 'i' : '')), out = '', last = 0, m;
    while ((m = re.exec(text))) {
      out += esc(text.slice(last, m.index));
      var cls = m[1] ? 'com' : m[2] ? 'str' : m[3] ? 'num' : m[4] ? 'kw' : m[5] ? 'fn' : 'meta';
      out += '<span class="tk-' + cls + '">' + esc(m[0]) + '</span>'; last = re.lastIndex; if (m[0] === '') re.lastIndex++;
    }
    return out + esc(text.slice(last));
  }

  /* ================= マークダウン(簡易) ================= */
  function inline(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="#" onclick="return false">$1</a>');
  }
  function md(src) {
    var lines = src.split('\n'), out = [], i = 0, list = null, m;
    function close() { if (list) { out.push('</' + list + '>'); list = null; } }
    while (i < lines.length) {
      var l = lines[i];
      if (/^(```|~~~)/.test(l)) {
        close(); var lang = l.slice(3).trim(), buf = []; i++;
        while (i < lines.length && !/^(```|~~~)/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; out.push('<pre class="ml-pre"><code>' + hl(lang === 'bash' ? '' : lang, buf.join('\n')) + '</code></pre>'); continue;
      }
      if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) { close(); out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'); }
      else if (/^---+$/.test(l)) { close(); out.push('<hr>'); }
      else if ((m = /^>\s?(.*)$/.exec(l))) { close(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); }
      else if ((m = /^- \[( |x)\]\s+(.*)$/.exec(l))) { if (list !== 'ul') { close(); out.push('<ul class="ml-tasks">'); list = 'ul'; } out.push('<li class="ml-task" data-done="' + (m[1] === 'x') + '"><span class="ml-check"></span>' + inline(m[2]) + '</li>'); }
      else if ((m = /^[-*]\s+(.*)$/.exec(l))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(m[1]) + '</li>'); }
      else if ((m = /^\d+\.\s+(.*)$/.exec(l))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(m[1]) + '</li>'); }
      else if (l.trim() === '') close();
      else { close(); out.push('<p>' + inline(l) + '</p>'); }
      i++;
    }
    close(); return out.join('\n');
  }

  /* ================= エディタ ================= */
  var state = { pid: null, tabs: [], cur: null, mode: 'split', edits: {}, userComments: {} };
  function fileOf(p, path) { for (var i = 0; i < p.files.length; i++) if (p.files[i].path === path) return p.files[i]; return null; }
  function icoKind(path) { var e = (path.split('.').pop() || '').toLowerCase(); return ({ md: 'md', ts: 'ts', tsx: 'ts', py: 'py', sql: 'sql', yml: 'yaml', yaml: 'yaml', rs: 'rs', diff: 'diff' })[e] || 'file'; }

  function buildTree(p) {
    var root = { dirs: {}, files: [] };
    p.files.forEach(function (fl) {
      var parts = fl.path.split('/'), node = root;
      for (var i = 0; i < parts.length - 1; i++) { node = node.dirs[parts[i]] || (node.dirs[parts[i]] = { dirs: {}, files: [] }); }
      node.files.push({ name: parts[parts.length - 1], path: fl.path });
    });
    function render(node, container) {
      Object.keys(node.dirs).forEach(function (name) {
        var d = el('div', 'ml-tree-dir'); d.dataset.open = 'true';
        var head = el('div', 'ml-tree-dirname'); head.appendChild(el('span', 'ml-ico')).dataset.kind = 'dir'; head.appendChild(el('span', 'ml-tree-label', name));
        head.addEventListener('click', function () { d.dataset.open = d.dataset.open === 'true' ? 'false' : 'true'; });
        var ch = el('div', 'ml-tree-children'); render(node.dirs[name], ch); d.appendChild(head); d.appendChild(ch); container.appendChild(d);
      });
      node.files.forEach(function (fl) {
        var row = el('div', 'ml-tree-file'); row.dataset.path = fl.path; row.tabIndex = 0;
        row.appendChild(el('span', 'ml-ico')).dataset.kind = icoKind(fl.path); row.appendChild(el('span', 'ml-tree-label', fl.name));
        row.addEventListener('click', function () { ML.openFile(fl.path); });
        row.addEventListener('keydown', function (e) { if (e.key === 'Enter') ML.openFile(fl.path); });
        container.appendChild(row);
      });
    }
    var t = el('div', 'ml-tree'); render(root, t); return t;
  }

  function renderTabs() {
    var host = $('[data-slot="tabs"]'); if (!host) return; host.textContent = '';
    state.tabs.forEach(function (path) {
      var t = el('div', 'ml-tab'); t.dataset.path = path; if (path === state.cur) t.dataset.active = 'true';
      t.appendChild(el('span', 'ml-ico')).dataset.kind = icoKind(path);
      t.appendChild(el('span', 'ml-tab-title', path.split('/').pop()));
      var x = el('span', 'ml-tab-close', '×'); x.addEventListener('click', function (e) { e.stopPropagation(); closeTab(path); }); t.appendChild(x);
      t.addEventListener('click', function () { ML.openFile(path); }); host.appendChild(t);
    });
  }
  function closeTab(path) {
    var i = state.tabs.indexOf(path); if (i < 0) return; state.tabs.splice(i, 1);
    if (state.cur === path) state.cur = state.tabs[Math.max(0, i - 1)] || null;
    renderTabs(); renderTreeActive(); renderDoc();
  }
  function renderTreeActive() { $$('.ml-tree-file').forEach(function (r) { if (r.dataset.path === state.cur) r.dataset.active = 'true'; else delete r.dataset.active; }); }

  ML.openFile = function (path) {
    var p = project(state.pid); if (!p || !fileOf(p, path)) return;
    if (state.tabs.indexOf(path) < 0) state.tabs.push(path);
    state.cur = path; renderTabs(); renderTreeActive(); renderDoc();
  };

  function buildLines(fl) {
    if (fl.kind === 'diff') {
      var on = 1, nn = 1;
      return fl.text.split('\n').map(function (l) {
        if (/^@@/.test(l)) { var m = /-(\d+)\S*\s+\+(\d+)/.exec(l); if (m) { on = +m[1]; nn = +m[2]; } return { k: 'hunk', t: l.replace(/@@/g, '').replace(/-\d+\S*\s+\+\d+\S*/, '').trim() || l, n: '' }; }
        var c = l.charAt(0), t = l.slice(1);
        if (c === '+') return { k: 'add', t: t, n: nn++ };
        if (c === '-') return { k: 'del', t: t, n: on++ };
        on++; return { k: 'ctx', t: t, n: nn++ };
      });
    }
    return fl.text.split('\n').map(function (t, i) { return { k: 'ctx', t: t, n: i + 1 }; });
  }
  function commentEl(who, text) {
    var c = el('div', 'ml-comment'); c.dataset.who = who;
    c.appendChild(el('span', 'ml-comment-who', who === 'ai' ? 'AI' : '自分')); c.appendChild(el('span', 'ml-comment-text', text)); return c;
  }
  function renderCode(fl, host) {
    var lines = buildLines(fl), code = el('div', 'ml-code');
    var byIdx = {}; (fl.comments || []).forEach(function (c) { for (var i = 0; i < lines.length; i++) if (lines[i].t.indexOf(c.match) >= 0) { (byIdx[i] = byIdx[i] || []).push(c); break; } });
    ((state.userComments[state.pid + '/' + fl.path]) || []).forEach(function (c) { (byIdx[c.idx] = byIdx[c.idx] || []).push({ who: 'me', text: c.text }); });
    lines.forEach(function (ln, i) {
      var row = el('div', 'ml-line'); row.dataset.k = ln.k;
      var num = el('span', 'ml-ln', String(ln.n)); num.title = 'クリックでコメント';
      row.appendChild(num); row.appendChild(el('span', 'ml-sign', ln.k === 'add' ? '+' : ln.k === 'del' ? '−' : ''));
      var src = el('span', 'ml-src'); src.innerHTML = ln.k === 'hunk' ? esc(ln.t) : (hl(fl.lang, ln.t) || ' '); row.appendChild(src); code.appendChild(row);
      (byIdx[i] || []).forEach(function (c) { code.appendChild(commentEl(c.who, c.text)); });
      num.addEventListener('click', function () {
        var nx = row.nextSibling; while (nx && nx.classList && nx.classList.contains('ml-comment') && !nx.classList.contains('ml-compose')) nx = nx.nextSibling;
        if (nx && nx.classList && nx.classList.contains('ml-compose')) { nx.remove(); return; }
        var box = el('div', 'ml-comment ml-compose'); box.dataset.who = 'me';
        box.appendChild(el('span', 'ml-comment-who', '自分'));
        var inp = el('input', 'ml-compose-input'); inp.placeholder = 'コメントを書く… (Enterで追加 / Escで閉じる)'; box.appendChild(inp);
        row.parentNode.insertBefore(box, nx); inp.focus();
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') box.remove();
          if (e.key === 'Enter' && !e.isComposing && inp.value.trim()) {
            var key = state.pid + '/' + fl.path; (state.userComments[key] = state.userComments[key] || []).push({ idx: i, text: inp.value.trim() });
            box.parentNode.insertBefore(commentEl('me', inp.value.trim()), box); box.remove();
          }
        });
      });
    });
    host.appendChild(code);
  }
  function renderDoc() {
    var host = $('[data-slot="doc"]'); if (!host) return; host.textContent = '';
    var p = project(state.pid), fl = p && state.cur ? fileOf(p, state.cur) : null;
    var doc = el('div', 'ml-doc'); host.appendChild(doc);
    if (!fl) { doc.dataset.kind = 'empty'; doc.appendChild(el('div', 'ml-empty', 'ファイルを選んでください')); return; }
    doc.dataset.kind = fl.kind; doc.dataset.mode = state.mode;
    var bar = el('div', 'ml-doc-bar'); bar.appendChild(el('span', 'ml-doc-path', fl.path));
    if (fl.kind === 'md') {
      [['edit', '書く'], ['split', '半分'], ['preview', '読む']].forEach(function (m) {
        var b = el('button', 'ml-mode', m[1]); b.type = 'button'; b.dataset.mdMode = m[0]; if (state.mode === m[0]) b.dataset.active = 'true';
        b.addEventListener('click', function () { state.mode = m[0]; doc.dataset.mode = m[0]; $$('.ml-mode', bar).forEach(function (x) { if (x === b) x.dataset.active = 'true'; else delete x.dataset.active; }); });
        bar.appendChild(b);
      });
    }
    doc.appendChild(bar);
    if (fl.kind === 'md') {
      var wrap = el('div', 'ml-md'), ta = el('textarea', 'ml-md-src'), out = el('div', 'ml-md-out');
      var key = state.pid + '/' + fl.path; ta.value = state.edits[key] != null ? state.edits[key] : fl.text; ta.spellcheck = false;
      out.innerHTML = md(ta.value);
      ta.addEventListener('input', function () { state.edits[key] = ta.value; out.innerHTML = md(ta.value); });
      wrap.appendChild(ta); wrap.appendChild(out); doc.appendChild(wrap);
    } else renderCode(fl, doc);
  }

  /* ================= AI会話(ダミー) ================= */
  function addMsg(log, role, text) {
    var m = el('div', 'ml-msg'); m.dataset.role = role; var b = el('div', 'ml-msg-body', text); m.appendChild(b); log.appendChild(m); log.scrollTop = log.scrollHeight; return b;
  }
  function stream(body, text, done) {
    var i = 0; body.classList.add('ml-typing');
    var t = setInterval(function () { i += 2; body.textContent = text.slice(0, i); if (i >= text.length) { clearInterval(t); body.classList.remove('ml-typing'); if (done) done(); } }, 22);
  }
  function renderChat() {
    var host = $('[data-slot="chat"]'); if (!host) return; host.textContent = '';
    var p = project(state.pid), chat = el('div', 'ml-chat'), log = el('div', 'ml-chat-log'), form = el('form', 'ml-chat-form');
    ((p && p.chat) || []).forEach(function (m) { addMsg(log, m[0], m[1]); });
    var ta = el('textarea'); ta.rows = 2; ta.placeholder = '続きを話す… (Enterで送信)'; var btn = el('button', 'ml-send', '送る'); btn.type = 'submit';
    form.appendChild(ta); form.appendChild(btn); chat.appendChild(log); chat.appendChild(form); host.appendChild(chat);
    var busy = false;
    function send() {
      var text = ta.value.trim(); if (!text || busy) return; ta.value = ''; addMsg(log, 'user', text); busy = true;
      setTimeout(function () {
        var body = addMsg(log, 'ai', '');
        var wantsRun = /実行|テスト|ビルド|run/i.test(text);
        var reply = wantsRun ? 'テストを実行して確認します。コマンドを実行してもよいですか?'
          : /レビュー|差分|確認/.test(text) ? '差分を見ました。気になる行は行番号をクリックしてコメントを残せます。私も1件コメントしています。'
          : '「' + text.slice(0, 20) + '」ですね。このフォルダのファイルを見ながら、次の一歩を提案します。(ダミー返信)';
        stream(body, reply, function () {
          busy = false;
          if (!wantsRun) return;
          var perm = el('div', 'ml-perm'); perm.appendChild(el('div', 'ml-perm-title', '実行の許可'));
          perm.appendChild(el('code', 'ml-perm-cmd', '> ' + (state.pid === 'sales-analysis' ? 'python -m pytest' : state.pid === 'dbt-snowflake' ? 'dbt build --select staging' : 'pnpm test')));
          var row = el('div', 'ml-perm-row'), ok = el('button', 'ml-perm-ok', '許可'), ng = el('button', 'ml-perm-ng', '拒否'); ok.type = ng.type = 'button';
          function decide(a) { perm.dataset.done = a ? 'ok' : 'ng'; row.remove(); addMsg(log, 'ai', a ? '実行しました。3 passed (ダミー出力)' : '了解です。実行はやめておきます。'); }
          ok.onclick = function () { decide(true); }; ng.onclick = function () { decide(false); };
          row.appendChild(ok); row.appendChild(ng); perm.appendChild(row); log.appendChild(perm); log.scrollTop = log.scrollHeight;
        });
      }, 300);
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); send(); });
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  }

  /* ================= ビュー切り替え ================= */
  var phaseTimer = null;
  function setSlots(p) {
    [['title', p.name], ['path', p.path], ['lang', p.lang], ['blurb', p.blurb], ['branch', p.branch], ['count-review', String(p.review)]].forEach(function (kv) {
      $$('[data-slot="' + kv[0] + '"]').forEach(function (n) { n.textContent = kv[1]; });
    });
  }
  ML.open = function (id, opts) {
    opts = opts || {}; var p = project(id); if (!p) return;
    state.pid = id; state.tabs = p.open.slice(); state.cur = opts.file && fileOf(p, opts.file) ? opts.file : p.start;
    if (state.tabs.indexOf(state.cur) < 0) state.tabs.push(state.cur);
    if (opts.mode) state.mode = opts.mode;
    setSlots(p); var tree = $('[data-slot="tree"]'); if (tree) { tree.textContent = ''; tree.appendChild(buildTree(p)); }
    renderTabs(); renderTreeActive(); renderDoc(); renderChat();
    var b = document.body; b.dataset.project = id;
    var from = opts.from; if (from && from.getBoundingClientRect) {
      var r = from.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, de = document.documentElement.style;
      de.setProperty('--ox', f(x) + 'px'); de.setProperty('--oy', f(y) + 'px'); de.setProperty('--oxp', f(x / innerWidth * 100) + '%'); de.setProperty('--oyp', f(y / innerHeight * 100) + '%');
    }
    clearTimeout(phaseTimer);
    if (opts.instant) { delete b.dataset.phase; b.dataset.view = 'editor'; return; }
    b.dataset.phase = 'to-editor'; void b.offsetWidth; b.dataset.view = 'editor';
    phaseTimer = setTimeout(function () { delete b.dataset.phase; }, 900);
  };
  ML.back = function () {
    var b = document.body; if (b.dataset.view !== 'editor') return;
    clearTimeout(phaseTimer); b.dataset.phase = 'to-board'; void b.offsetWidth; b.dataset.view = 'board';
    phaseTimer = setTimeout(function () { delete b.dataset.phase; ML.redraw(); }, 900); setTimeout(ML.redraw, 50);
  };

  /* ================= ドラッグ ================= */
  function initDrag() {
    var board = $('#board'); if (!board) return;
    board.addEventListener('pointerdown', function (e) {
      if (document.body.dataset.pen === 'on') return;
      var t = e.target.closest && e.target.closest('[data-drag],[data-project]'); if (!t || !board.contains(t)) return;
      if (e.target.closest('button,a,input,textarea,[data-no-drag]') && !e.target.closest('[data-project]')) return;
      var movable = t.hasAttribute('data-drag') && getComputedStyle(t).position === 'absolute';
      var sx = e.clientX, sy = e.clientY, ox = t.offsetLeft, oy = t.offsetTop, moved = false;
      function mv(ev) {
        var dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.hypot(dx, dy) < 5) return;
        moved = true; if (!movable) return;
        t.dataset.dragging = 'true'; t.style.left = ox + dx + 'px'; t.style.top = oy + dy + 'px'; t.style.right = 'auto'; t.style.bottom = 'auto';
        document.dispatchEvent(new Event('ml:drag'));
      }
      function up() {
        document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); delete t.dataset.dragging;
        if (!moved && t.dataset.project) ML.open(t.dataset.project, { from: t });
        if (moved) { var z = (initDrag.z = (initDrag.z || 50) + 1); t.style.zIndex = z; }
      }
      document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
    });
    $$('[data-project]').forEach(function (n) {
      if (!n.hasAttribute('tabindex')) n.tabIndex = 0; if (!n.getAttribute('role')) n.setAttribute('role', 'button');
      n.addEventListener('keydown', function (e) { if (e.key === 'Enter') ML.open(n.dataset.project, { from: n }); });
    });
  }

  /* ================= 手書き表現 ================= */
  function smooth(pts) {
    if (pts.length < 2) return ''; var d = 'M' + f(pts[0][0]) + ' ' + f(pts[0][1]);
    if (pts.length === 2) return d + ' L' + f(pts[1][0]) + ' ' + f(pts[1][1]);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += ' C' + f(p1[0] + (p2[0] - p0[0]) / 6) + ' ' + f(p1[1] + (p2[1] - p0[1]) / 6) + ' ' + f(p2[0] - (p3[0] - p1[0]) / 6) + ' ' + f(p2[1] - (p3[1] - p1[1]) / 6) + ' ' + f(p2[0]) + ' ' + f(p2[1]);
    }
    return d;
  }
  function stroke(g, d, o, extra) {
    var p = svgEl('path', { d: d, fill: (extra && extra.fill) || 'none', stroke: (extra && extra.noStroke) ? 'none' : (o.color || '#c33'), 'stroke-width': o.width || 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    if (o.dash) p.setAttribute('stroke-dasharray', o.dash); if (extra && extra.opacity) p.setAttribute('opacity', extra.opacity);
    if (extra && extra.blend) p.style.mixBlendMode = extra.blend; p.setAttribute('class', 'ml-stroke'); g.appendChild(p); return p;
  }
  var reg = [];
  function register(svg, fn) {
    svg = svg || $('#deco') || $('#pen'); if (!svg) return null;
    var g = svgEl('g', { class: 'ml-deco' }); svg.appendChild(g); var it = { g: g, svg: svg, fn: fn }; reg.push(it); draw(it); return g;
  }
  function draw(it) { var r = it.svg.getBoundingClientRect(); if (!r.width) return; while (it.g.firstChild) it.g.removeChild(it.g.firstChild); try { it.fn(it.g, r); } catch (e) {} }
  var rafId = 0;
  ML.redraw = function () { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(function () { reg.forEach(draw); }); };
  function target(t) { return typeof t === 'string' ? $(t) : t; }
  function rel(e, r) { var b = e.getBoundingClientRect(); return { x: b.left - r.left, y: b.top - r.top, w: b.width, h: b.height }; }

  ML.around = function (t, o) {
    o = o || {}; var node = target(t); if (!node) return;
    return register(o.svg && target(o.svg), function (g, r) {
      var b = rel(node, r), pad = o.pad != null ? o.pad : 10, rnd = mulberry(o.seed || 7), shape = o.shape || 'circle', pts = [], i;
      var x = b.x - pad, y = b.y - pad, w = b.w + pad * 2, h = b.h + pad * 2;
      if (shape === 'circle') {
        var cx = x + w / 2, cy = y + h / 2, rx = w / 2 * 1.08, ry = h / 2 * 1.12, a0 = -Math.PI * (0.6 + rnd() * 0.3), tilt = (rnd() - 0.5) * 0.12, N = 30;
        for (i = 0; i <= N; i++) { var t2 = i / N, a = a0 + t2 * Math.PI * 2.14, k = 1 + (rnd() - 0.5) * 0.05 + t2 * 0.05;
          var px = Math.cos(a) * rx * k, py = Math.sin(a) * ry * k; pts.push([cx + px * Math.cos(tilt) - py * Math.sin(tilt), cy + px * Math.sin(tilt) + py * Math.cos(tilt)]); }
        stroke(g, smooth(pts), o);
      } else if (shape === 'box') {
        var c = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
        pts.push([x + 6, y + (rnd() - 0.5) * 3]);
        for (i = 0; i < 4; i++) for (var s = 1; s <= 3; s++) { var q = s / 3; pts.push([c[i][0] + (c[i + 1][0] - c[i][0]) * q + (rnd() - 0.5) * 3, c[i][1] + (c[i + 1][1] - c[i][1]) * q + (rnd() - 0.5) * 3]); }
        pts.push([x + w * 0.2, y + 2]); stroke(g, smooth(pts), o);
      } else if (shape === 'underline') {
        var yy = b.y + b.h + pad * 0.4; for (i = 0; i <= 10; i++) pts.push([b.x - 4 + (b.w + 8) * i / 10, yy + Math.sin(i * 1.3) * 1.6 + (rnd() - 0.5) * 1.5]);
        stroke(g, smooth(pts), o);
        var p2 = []; for (i = 0; i <= 6; i++) p2.push([b.x + b.w * 0.15 + b.w * 0.7 * i / 6, yy + 5 + (rnd() - 0.5) * 1.5]); stroke(g, smooth(p2), { color: o.color, width: (o.width || 2.5) * 0.7 });
      } else if (shape === 'highlight') {
        var hy = b.y + b.h * 0.35, hh = b.h * 0.62; pts = [[b.x - 3, hy + 2], [b.x + b.w * 0.5, hy - 1], [b.x + b.w + 4, hy + 1], [b.x + b.w + 2, hy + hh], [b.x + b.w * 0.5, hy + hh + 2], [b.x - 2, hy + hh - 1], [b.x - 3, hy + 2]];
        stroke(g, smooth(pts), { color: o.color, width: 1 }, { fill: o.color || '#ff0', opacity: o.opacity || 0.45, blend: 'multiply', noStroke: true });
      }
    });
  };

  ML.link = function (a, b, o) {
    o = o || {}; var A = target(a), B = target(b); if (!A || !B) return;
    return register(o.svg && target(o.svg), function (g, r) {
      var ra = rel(A, r), rb = rel(B, r), ca = [ra.x + ra.w / 2, ra.y + ra.h / 2], cb = [rb.x + rb.w / 2, rb.y + rb.h / 2];
      function edge(c, rr, to) { var dx = to[0] - c[0], dy = to[1] - c[1], k = Math.min(Math.abs(rr.w / 2 / (dx || 1e-6)), Math.abs(rr.h / 2 / (dy || 1e-6))); return [c[0] + dx * k, c[1] + dy * k]; }
      var p0 = edge(ca, ra, cb), p1 = edge(cb, rb, ca), mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2, dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dx, dy) || 1;
      var cv = (o.curve != null ? o.curve : 0.18) * len, qx = mx - dy / len * cv, qy = my + dx / len * cv, rnd = mulberry(Math.round(len)), pts = [];
      for (var i = 0; i <= 14; i++) { var t = i / 14, u = 1 - t; pts.push([u * u * p0[0] + 2 * u * t * qx + t * t * p1[0] + (rnd() - 0.5) * 1.2, u * u * p0[1] + 2 * u * t * qy + t * t * p1[1] + (rnd() - 0.5) * 1.2]); }
      stroke(g, smooth(pts), { color: o.color || '#555', width: o.width || 1.8, dash: o.dash });
      if (o.dots !== false) [p0, p1].forEach(function (p) { g.appendChild(svgEl('circle', { cx: f(p[0]), cy: f(p[1]), r: o.dotR || 3.6, fill: o.color || '#555' })); });
    });
  };

  ML.scribble = function (kind, x, y, w, h, o) {
    o = o || {};
    return register(o.svg && target(o.svg), function (g) {
      var rnd = mulberry(o.seed || 3), pts = [], i, cx = x + w / 2, cy = y + h / 2;
      if (kind === 'arrow') {
        var qx = x + w * 0.5 + (o.bend != null ? o.bend : -h * 0.3), qy = y + h * 0.5 + (o.bend != null ? o.bend : w * 0.3);
        for (i = 0; i <= 12; i++) { var t = i / 12, u = 1 - t; pts.push([u * u * x + 2 * u * t * qx + t * t * (x + w), u * u * y + 2 * u * t * qy + t * t * (y + h)]); }
        stroke(g, smooth(pts), o); var ex = x + w, ey = y + h, ang = Math.atan2(ey - pts[10][1], ex - pts[10][0]);
        stroke(g, 'M' + f(ex - Math.cos(ang - 0.5) * 12) + ' ' + f(ey - Math.sin(ang - 0.5) * 12) + ' L' + f(ex) + ' ' + f(ey) + ' L' + f(ex - Math.cos(ang + 0.5) * 12) + ' ' + f(ey - Math.sin(ang + 0.5) * 12), o);
      } else if (kind === 'star') {
        var R = Math.min(w, h) / 2, order = [0, 2, 4, 1, 3, 0]; order.forEach(function (k) { var a = -Math.PI / 2 + k * 2 * Math.PI / 5; pts.push([cx + Math.cos(a) * R * (1 + (rnd() - 0.5) * 0.08), cy + Math.sin(a) * R * (1 + (rnd() - 0.5) * 0.08)]); });
        stroke(g, 'M' + pts.map(function (p) { return f(p[0]) + ' ' + f(p[1]); }).join(' L'), o);
      } else if (kind === 'spiral') {
        for (i = 0; i <= 40; i++) { var a2 = i / 40 * Math.PI * 5.5, rr = (i / 40) * Math.min(w, h) / 2; pts.push([cx + Math.cos(a2) * rr, cy + Math.sin(a2) * rr]); } stroke(g, smooth(pts), o);
      } else if (kind === 'check') { stroke(g, smooth([[x, y + h * 0.55], [x + w * 0.35, y + h], [x + w, y]]), o); }
      else if (kind === 'zigzag') { var n = 7; for (i = 0; i <= n; i++) pts.push([x + w * i / n, y + (i % 2 ? h : 0) + (rnd() - 0.5) * 2]); stroke(g, 'M' + pts.map(function (p) { return f(p[0]) + ' ' + f(p[1]); }).join(' L'), o); }
      else if (kind === 'cross') { stroke(g, 'M' + x + ' ' + y + ' L' + (x + w) + ' ' + (y + h), o); stroke(g, 'M' + (x + w) + ' ' + y + ' L' + x + ' ' + (y + h), o); }
    });
  };

  /* ================= 手書きペン ================= */
  var pen = { on: false, color: '#d33', width: 3, strokes: [], g: null, svg: null };
  function initPen() {
    var svg = $('#pen'); if (!svg) return; pen.svg = svg; svg.style.pointerEvents = 'none'; svg.style.touchAction = 'none'; pen.g = svgEl('g', { class: 'ml-pen-layer' }); svg.appendChild(pen.g);
    pen.strokes = storeGet('pen') || []; pen.strokes.forEach(function (s) { drawStroke(s); });
    var cur = null, last = null;
    svg.addEventListener('pointerdown', function (e) {
      if (!pen.on) return; var r = svg.getBoundingClientRect(); svg.setPointerCapture(e.pointerId);
      cur = { c: pen.color, w: pen.width, p: [[e.clientX - r.left, e.clientY - r.top]] }; last = drawStroke(cur);
    });
    svg.addEventListener('pointermove', function (e) {
      if (!cur) return; var r = svg.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, lp = cur.p[cur.p.length - 1];
      if (Math.hypot(x - lp[0], y - lp[1]) < 2) return; cur.p.push([x, y]); last.setAttribute('d', smooth(cur.p));
    });
    function end() { if (!cur) return; if (cur.p.length === 1) cur.p.push([cur.p[0][0] + 0.1, cur.p[0][1] + 0.1]); last.setAttribute('d', smooth(cur.p)); pen.strokes.push(cur); storeSet('pen', pen.strokes); cur = null; }
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
    $$('[data-action="pen"]').forEach(function (b) { b.addEventListener('click', function () { setPen(!pen.on); }); });
    $$('[data-pen-color]').forEach(function (b) { b.addEventListener('click', function () { pen.color = b.dataset.penColor; setPen(true); $$('[data-pen-color]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); }); });
    $$('[data-action="pen-undo"]').forEach(function (b) { b.addEventListener('click', function () { pen.strokes.pop(); storeSet('pen', pen.strokes); redrawPen(); }); });
    $$('[data-action="pen-clear"]').forEach(function (b) { b.addEventListener('click', function () { pen.strokes = []; storeSet('pen', []); redrawPen(); }); });
    var first = $('[data-pen-color]'); if (first) pen.color = first.dataset.penColor;
  }
  function drawStroke(s) {
    var p = svgEl('path', { d: smooth(s.p), fill: 'none', stroke: s.c, 'stroke-width': s.w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'ml-pen-path' }); pen.g.appendChild(p); return p;
  }
  function redrawPen() { while (pen.g.firstChild) pen.g.removeChild(pen.g.firstChild); pen.strokes.forEach(drawStroke); }
  function setPen(on) {
    pen.on = on; document.body.dataset.pen = on ? 'on' : 'off'; if (pen.svg) { pen.svg.style.pointerEvents = on ? 'auto' : 'none'; pen.svg.style.cursor = on ? 'crosshair' : ''; }
    $$('[data-action="pen"]').forEach(function (b) { b.setAttribute('aria-pressed', String(on)); });
  }

  /* ================= 「この見本について」(目的・目次) ================= */
  function initAbout() {
    var title = (($('meta[name="ml-title"]') || {}).content) || document.title, concept = (($('meta[name="ml-concept"]') || {}).content) || '';
    var d = el('details', 'ml-about'), s = el('summary', '', 'この見本について'); d.appendChild(s);
    var body = el('div', 'ml-about-body');
    body.innerHTML = '<strong>' + esc(title) + '</strong>' + (concept ? '<p class="ml-about-concept">' + esc(concept) + '</p>' : '') +
      '<h4>目的</h4><p>「ディレクトリ=プロジェクトを、見た目の好きなボードに自由に置き、クリックすると従来のエディタが開く」アプリの<b>見た目の参考例</b>です。</p>' +
      '<h4>目次</h4><ol><li>ボード: カードをドラッグ / クリックで開く</li><li>ペン: 手書きで囲む・線を引く</li><li>エディタ: ツリー・タブ・マークダウン(書く/読む)</li><li>コードレビュー: 行番号をクリックしてコメント</li><li>AI会話: 右側(返事はダミー)</li></ol>' +
      '<p class="ml-about-note">※ 内容は見た目確認用の<b>ダミー</b>です。Escでボードへ戻ります。</p>';
    d.appendChild(body); document.body.appendChild(d);
  }
  function baseCss() {
    var s = el('style'); s.id = 'ml-base';
    s.textContent =
      ':where(body[data-view="board"]:not([data-phase])) #editor{visibility:hidden;pointer-events:none}' +
      ':where(body[data-view="editor"]:not([data-phase])) #board{visibility:hidden;pointer-events:none}' +
      ':where(body[data-view="board"]) #editor,:where(body[data-view="editor"]) #board{pointer-events:none}' +
      ':where([data-drag]){cursor:grab;touch-action:none;user-select:none}:where([data-drag][data-dragging]){cursor:grabbing}' +
      ':where([data-project]){cursor:pointer}' +
      ':where(.ml-code){font-family:ui-monospace,Consolas,monospace;white-space:pre;overflow:auto}' +
      ':where(.ml-line){display:flex}:where(.ml-ln){flex:none;width:3.2em;text-align:right;padding-right:1em;cursor:pointer;user-select:none}:where(.ml-sign){flex:none;width:1.2em}' +
      ':where(.ml-md){display:grid;grid-template-columns:1fr 1fr;min-height:0}:where(.ml-md-src){resize:none;border:0;outline:0;background:transparent;font:inherit;color:inherit}' +
      ':where(.ml-doc[data-mode="edit"]) .ml-md-out{display:none}:where(.ml-doc[data-mode="preview"]) .ml-md-src{display:none}' +
      ':where(.ml-doc[data-mode="edit"],.ml-doc[data-mode="preview"]) .ml-md{grid-template-columns:1fr}' +
      ':where(.ml-chat){display:flex;flex-direction:column;height:100%;min-height:0}:where(.ml-chat-log){flex:1;overflow:auto;min-height:0}:where(.ml-chat-form){display:flex;gap:8px}:where(.ml-chat-form textarea){flex:1;resize:none}' +
      ':where(.ml-typing)::after{content:"▍";animation:mlb 1s steps(2) infinite}@keyframes mlb{50%{opacity:0}}' +
      ':where(.ml-compose-input){flex:1;border:0;outline:0;background:transparent;font:inherit;color:inherit}' +
      ':where(.ml-tree-dir[data-open="false"])>.ml-tree-children{display:none}:where(.ml-tree-dirname,.ml-tree-file,.ml-tab){cursor:pointer}' +
      ':where(.ml-comment){display:flex;gap:.6em;align-items:baseline;white-space:normal}' +
      ':where(.ml-ico){display:inline-block;flex:none}' +
      ':where(.ml-doc-bar){display:flex;align-items:center;gap:6px}:where(.ml-doc-path){margin-right:auto}' +
      ':where(.ml-tasks){list-style:none;padding-left:0}:where(.ml-check){display:inline-block;width:.9em;height:.9em;border:1.5px solid currentColor;border-radius:3px;margin-right:.55em;vertical-align:-.12em;line-height:.8;text-align:center;font-size:.9em}' +
      ':where(.ml-task[data-done="true"]) .ml-check::after{content:"✓"}:where(.ml-tree-label){white-space:nowrap}' +
      ':where(.ml-about){position:fixed;right:12px;bottom:12px;z-index:9999;max-width:320px;font:12px/1.6 system-ui,"Yu Gothic UI",sans-serif;background:rgba(255,255,255,.96);color:#222;border:1px solid rgba(0,0,0,.25);border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.25);padding:6px 10px}' +
      'body[data-view="editor"] .ml-about{left:8px!important;right:auto!important;bottom:8px!important;max-width:300px}' +
      ':where(.ml-about summary){cursor:pointer}:where(.ml-about h4){margin:8px 0 2px;font-size:12px}:where(.ml-about p,.ml-about ol){margin:2px 0;padding-left:0}:where(.ml-about ol){padding-left:1.3em}' +
      ':where(#deco,#pen){position:absolute;left:0;top:0;width:100%;height:100%}:where(#deco){pointer-events:none}';
    document.head.insertBefore(s, document.head.firstChild);
  }

  /* ================= 起動 ================= */
  var queue = [], inited = false;
  ML.ready = function (fn) { if (inited) fn(); else queue.push(fn); };
  function init() {
    baseCss(); initAbout();
    if (!document.body.dataset.view) document.body.dataset.view = 'board';
    initDrag(); initPen();
    $$('[data-action="back"]').forEach(function (b) { b.addEventListener('click', ML.back); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.body.dataset.view === 'editor' && !document.activeElement.matches('input,textarea')) ML.back(); });
    document.addEventListener('ml:drag', ML.redraw); window.addEventListener('resize', ML.redraw);
    inited = true; queue.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } }); queue = [];
    var h = location.hash.slice(1); if (h) {
      var o = {}; h.split('&').forEach(function (kv) { var a = kv.split('='); o[a[0]] = decodeURIComponent(a[1] || ''); });
      if (o.open) ML.open(o.open, { file: o.file, mode: o.mode, instant: true });
    }
    ML.redraw(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(ML.redraw); window.addEventListener('load', ML.redraw);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
