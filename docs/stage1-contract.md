# 段階1の契約: プロジェクト登録 + 言語の自動検知 + カード表示

Rust(バックエンド)と React(フロントエンド)が、同じ約束でつながるための設計書。**コードが正**。実装と食い違ったら、この文書を直す。
要件: `docs/requirements.html`(FR-01〜04, 15)。見た目の見本: `samples/36-gentle-bento.html`。

## 1. ゴール(段階1)
- 「プロジェクトを追加」ボタン → フォルダ選択ダイアログ → プロジェクトとして登録 → **言語バー付きのカード**がボードに出る。
- 再起動しても残る(アプリ専用のJSONに保存)。カードの「ひと言メモ」「説明」を編集できる。
- ボード操作(ドラッグ・コネクタ・手書き)は段階2、エディタは段階3。**段階1では作らない**(カードの位置 x,y は保存するが、ドラッグはまだ)。

## 2. 型(JSON は camelCase)

```ts
type LangShare = { name: string; percent: number };   // percent: 0〜100 の整数。合計は 100 になるよう調整(丸め誤差は最大の言語に足す)
type GitInfo = {
  branch: string | null;          // 現在のブランチ。HEAD が分離状態なら null
  remote: { repo: string } | null; // origin の URL から "owner/name" を取り出す。GitHub以外/origin なしは null
  ahead: number;                  // 上流ブランチより先の件数(上流が無ければ 0)
  behind: number;                 // 上流ブランチより遅れの件数(上流が無ければ 0)
  hasUpstream: boolean;
  lastCommitAt: string | null;    // 最新コミットの日時(ISO 8601)
};
type ProjectSummary = {
  id: string;                     // UUID v4
  name: string;                   // ディレクトリ名(パスの最後の要素)
  path: string;                   // 絶対パス(Windows: C:\...)
  displayPath: string;            // 表示用の短いパス。ホーム配下なら "~/…"(区切りは / )
  exists: boolean;                // フォルダがまだ存在するか
  description: string | null;     // ユーザーが上書きした説明 → なければ README の最初の見出し以外の1行 → なければ null
  note: string;                   // ひと言メモ(ユーザー入力。空文字あり)
  languages: LangShare[];         // 割合の大きい順。最大6件、残りは name:"その他" にまとめる
  mainLanguage: string | null;    // 最大割合の言語(除外後に何も無ければ null)
  git: GitInfo | null;            // git管理でなければ null
  lastUpdated: string | null;     // フォルダ内の最新のファイル更新日時(ISO 8601)。gitがあれば lastCommitAt を優先
  position: { x: number; y: number }; // ボード上の位置(px)
};
```

## 3. コマンド(Tauri の `invoke`)。引数名も camelCase。エラーは文字列(日本語の短い説明)

| コマンド | 引数 | 戻り値 | 意味 |
|---|---|---|---|
| `list_projects` | なし | `ProjectSummary[]` | 登録済みの全プロジェクト(登録順)。言語・gitは毎回計算して返す |
| `add_project` | `{ path: string }` | `ProjectSummary` | 登録。存在しないパス・ファイル(フォルダでない)はエラー。同じパスの二重登録はエラー(「すでに登録されています」)。初期位置は既存カードと重なりにくい格子状 |
| `remove_project` | `{ id: string }` | `null` | 記憶から外すだけ。**フォルダは消さない** |
| `update_project_note` | `{ id: string, note: string }` | `null` | ひと言メモを保存(最大200文字) |
| `update_project_description` | `{ id: string, description: string \| null }` | `null` | 説明を上書き(null で README 由来に戻す) |
| `move_project` | `{ id: string, x: number, y: number }` | `null` | 位置を保存 |
| `refresh_project` | `{ id: string }` | `ProjectSummary` | 1件を再計算 |

- 重い処理(フォルダ走査・git)は、画面を止めないよう、バックグラウンドのスレッドで行う(`async` コマンド + `spawn_blocking`)。
- `list_projects` が遅い場合に備え、1件の失敗(フォルダが消えた等)は `exists: false` として返し、全体は失敗させない。

## 4. 保存ファイル
- 場所: Tauri の `app_data_dir()` の下の `projects.json`(Windows: `%APPDATA%\com.oshun5292.tactilecode\`)。
- 形式:
```json
{ "schemaVersion": 1,
  "projects": [ { "id": "...", "path": "C:\\...", "note": "", "descriptionOverride": null, "position": { "x": 0, "y": 0 } } ] }
```
- 書き込みは「同じフォルダの一時ファイルに書く → 置き換え(rename)」で、途中で壊れないようにする。読み込みで壊れていたら、`projects.json.broken-<日時>` に退避して空から始める(アプリを落とさない)。
- ファイルの中身(言語の内訳・git状態・最終更新)は**保存しない**(毎回計算する)。

## 5. 言語の自動検知のルール
- 走査: `ignore` クレート(`.gitignore` を尊重)。隠しファイル・フォルダは対象外。常に除外: `.git` `node_modules` `target` `dist` `build` `out` `.venv` `venv` `__pycache__` `.next` `.cache` `vendor`。ロックファイルと生成物(`pnpm-lock.yaml` `package-lock.json` `yarn.lock` `Cargo.lock` `*.min.js` `*.map`)は除外。
- 上限: ファイル数 50,000 件、1ファイル 2MB を超えるものは数えない(大きいデータファイル対策)。
- 数え方: **バイト数**で割合を出す。拡張子 → 言語名:

| 言語名 | 拡張子 |
|---|---|
| TypeScript | .ts .tsx |
| JavaScript | .js .jsx .mjs .cjs |
| Python | .py |
| SQL | .sql |
| Markdown | .md .mdx |
| Rust | .rs |
| YAML | .yml .yaml |
| JSON | .json |
| CSS | .css .scss |
| HTML | .html .htm |
| Jinja | .jinja .jinja2 .j2 |
| Shell | .sh .ps1 |
| TOML | .toml |

  上にない拡張子は数えない。dbt の SQL(Jinja入り)は、拡張子が .sql なので SQL として数える。
- メイン言語 = 割合が最大の言語。同率なら、上の表の順。
- `languages` は最大6件 + 「その他」。

## 6. git情報の取得
- `git` コマンドを `std::process::Command` で呼ぶ(`-C <path>`)。Windows ではコンソールが一瞬出ないよう `CREATE_NO_WINDOW`(0x08000000)を付ける。git が無い/管理外のフォルダなら `git: null`。
- 取得: ブランチ(`rev-parse --abbrev-ref HEAD`)、origin(`remote get-url origin`)、ahead/behind(`rev-list --left-right --count @{u}...HEAD`)、最新コミット日時(`log -1 --format=%cI`)。
- origin の URL(`https://github.com/owner/name(.git)` と `git@github.com:owner/name(.git)`)から `owner/name` を取り出す。GitHub 以外は `remote: null`(段階1では GitHub のみ扱う)。
- **PR件数・CIの状態・公開/非公開は、GitHub API が必要なので段階1では取得しない**(Phase 2)。

## 7. 画面(フロントエンド)の約束
- 初期表示: ヘッダー「Projects.」+「workspace / N projects / week W」、右上に自動検知した言語の凡例チップ、中央にカード。0件のときは「プロジェクトを追加」を促す空の状態(36の雰囲気で、手書き風の矢印+文言)。
- カード: 36の見本の構造。**番号・レビュー件数・進捗バーは置かない**。言語(色の点+名前+「自動検知」)と内訳バー、名前(ディレクトリ名)、パス、ブランチ、説明、ひと言メモ(クリックで編集)、最終更新、GitHubチップ(origin があれば「owner/name」+ahead/behind。なければ破線の「未連携・ローカルのみ」)。
- 色: 言語→色の対応は `src/shared/languageColors.ts` に集約。TypeScript=水色, Python=薄緑, SQL=薄紫, Markdown=薄黄, Rust=桃(36の見本と同じ)。他の言語(JavaScript, CSS, HTML, YAML, JSON, Jinja, Shell, TOML, その他)は、同じ淡い系統で調和する色を選ぶ。メイン言語の色が、カードのアクセント(ヘッダー面・タグ)になる。
- 見た目の値(色・書体・影・角丸)は CSS 変数(`src/styles/tokens.css`)に集める。36の見本の `:root` の値を使う。書体は `@fontsource` パッケージで同梱(オフラインで動く): Zen Maru Gothic(本文), Fraunces(数字・見出しの飾り), JetBrains Mono(等幅)。
- 状態管理は Zustand。Tauri呼び出しは `src/api/` のラッパーだけが行う。**ブラウザ(Tauri外)でも動く**ように、`window.__TAURI_INTERNALS__` が無いときはモック(サンプルの5プロジェクト)に切り替える(Edgeのヘッドレス撮影で見た目を確認するため)。
- フォルダ選択は `@tauri-apps/plugin-dialog` の `open({ directory: true })`。

## 8. テスト
- Rust: 言語検知(一時フォルダで)、origin URL の解析、保存と読み込みの往復、壊れたJSONの退避、そして **`tauri::test`(モックのIPC)で、コマンドの呼び出しと JSON の形(camelCase)が、この契約どおりか**を確認する。
- フロント: 純粋な関数(割合の整形、パスの短縮、週番号など)を Vitest で。画面は、ブラウザ(モック)でのスクリーンショットで確認する。
