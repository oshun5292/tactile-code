# 段階3(3a)の契約: エディタ(ツリー・タブ・マークダウン・コードの閲覧と編集・保存)

段階1・2の契約の続き。**コードが正**。実装と食い違ったら、この文書を直す。
要件: `docs/requirements.html` の FR-07〜11。見た目の見本: `samples/36-gentle-bento.html`(エディタ画面)。コードエディタは **CodeMirror 6**(決定済み)。
段階3b(あとで): ファイル操作(新規・名前変更・削除)、「VSCodeで開く」、タブの復元など。

## 1. ゴール(3a)
- ボードのカードをクリック → **エディタ画面**に切り替わる(アニメーションなし)。Esc / 戻るボタンでボードへ。
- 左: **ファイルツリー**(フォルダを開閉)。中: **タブ** + 本文。右: AI会話の領域(**MVPでは畳んだ状態**が既定。「AI会話は後のバージョンで」と書いた、畳める枠)。
- ファイルを開く → **マークダウン**は「書く / 半分 / 読む」、**コード**は行番号・色分け付きで**閲覧と編集**。Ctrl+S で**保存**。未保存は ● で示し、閉じるときに確認。
- プロジェクトのメイン言語の色が、エディタ全体(ヘッダー・タブ・ツリー・見出し・選択色)に続く。

## 2. 型(JSON は camelCase)。パスは「プロジェクトのルートからの相対パス」で、区切りは `/`、先頭に `/` を付けない。ルートは空文字

```ts
type FsEntry = { name: string; relPath: string; kind: "dir" | "file"; size: number; modified: string | null };
type FileContent = {
  relPath: string;
  kind: "text" | "binary" | "tooLarge" | "unsupportedEncoding";
  content: string | null;       // kind が "text" のときだけ文字列。改行は "\n" に正規化済み、BOM は取り除き済み
  size: number;                 // バイト数
  modified: string;             // 最終更新(RFC 3339、ナノ秒まで)。保存時の競合検出に使う
  eol: "lf" | "crlf";           // 元の改行。保存時に戻す
  hasBom: boolean;              // 元に BOM があったか。保存時に戻す
};
type SavedFile = { modified: string; size: number };
```

## 3. コマンド(`invoke`)。引数名も camelCase。エラーは日本語の短い文字列

| コマンド | 引数 | 戻り値 | 意味 |
|---|---|---|---|
| `list_dir` | `{ projectId, relPath }` | `FsEntry[]` | 1階層だけ返す(ツリーは開いたときに、その都度呼ぶ)。フォルダが先、あとにファイル。名前は大文字小文字を区別せずに並べ、数字は自然順(file2 < file10) |
| `read_file` | `{ projectId, relPath }` | `FileContent` | ファイルを読む |
| `write_file` | `{ projectId, relPath, content, expectedModified, eol, hasBom, force }` | `SavedFile` | 既存のファイルを上書き保存。`expectedModified` は読んだときの `modified`(`null` なら検査しない)。`force: false` で、現在の更新日時が `expectedModified` と違えば、**競合**エラー(メッセージの先頭が `競合:`)。`force: true` で、競合を無視して保存 |

## 4. Rust 側の要件(`src-tauri/`)
- 新規: `services/fs.rs`(安全なパス解決、一覧、読み書き)、`commands/` に3コマンド。段階1・2の構造に合わせる(薄いコマンド、`spawn_blocking`、日本語のエラー、camelCase)。依存の追加は不要(必要なら報告)。
- **パスの安全(最重要)**: プロジェクトは登録済みで、フォルダが存在すること。`relPath` は、空文字または `/` 区切りの相対パス。**拒否**: 絶対パス、`..` や `.` の要素、空の要素(`a//b`)、`\` や `:` を含む要素(Windows の代替データストリーム `file:stream` や、ドライブ指定を防ぐ)、末尾が `.` や空白の要素、Windows の予約名(`CON` `PRN` `AUX` `NUL` `COM1`〜`COM9` `LPT1`〜`LPT9`、拡張子付きも)。そのうえで、`canonicalize`(存在するもの)した結果が、プロジェクトのルートの `canonicalize` の内側であること(**シンボリックリンク・ジャンクションで外へ出られない**)。書き込み先は、親フォルダの `canonicalize` で検査する。`.git` の中(要素に `.git` を含むパス)は、**読み書きとも拒否**(一覧でも `.git` は出さない)。
- `list_dir`: シンボリックリンク・ジャンクション(リパースポイント)は一覧に出さない。常に隠す名前: `.git` `node_modules` `target` `.venv` `venv` `__pycache__`(どの階層でも)。`modified` は取れなければ `null`。
- `read_file`: 上限 **2MB** を超えたら `kind: "tooLarge"`(`content: null`)。先頭 8,000 バイトに NUL があれば `kind: "binary"`。UTF-8 として読めなければ `kind: "unsupportedEncoding"`(UTF-8 以外は、MVPでは未対応)。BOM(EF BB BF)は取り除き `hasBom: true`。改行は、最初に見つかった改行が `\r\n` なら `eol: "crlf"`、それ以外は `"lf"`。`content` は改行を `\n` に正規化して返す。
- `write_file`: **既存のファイルだけ**(無ければ「ファイルが見つかりません」)。`content` は 2MB まで。`eol: "crlf"` なら `\n` を `\r\n` に直し、`hasBom` なら BOM を付けて書く。**原子的に**書く(同じフォルダに一時ファイルを書き、置き換える)。一時ファイルが残らないこと。競合の検査は、書く直前に行う。権限エラー・読み取り専用ファイルは、日本語の分かりやすいメッセージ。
- テスト(`cargo test`): パスの拒否(上のすべて。シンボリックリンクは、作れる環境でのみ)、`.git` の拒否、一覧の並び(フォルダ先・自然順・隠す名前)、読み込みの種類4つ、BOM と改行の往復(読んで、書いて、バイト列が元に戻る)、競合検出(`force` あり・なし)、原子的な書き込み(一時ファイルが残らない)、存在しないファイルへの書き込み拒否、そして `tauri::test` の IPC で JSON の形(camelCase)が契約どおり。

## 5. エディタ部品の要件(フロントエンド、`src/features/editor/cm/`)

```ts
// CodeEditor.tsx
type CodeEditorProps = {
  value: string;                       // 改行は "\n"
  filename: string;                    // 拡張子から言語を決める
  onChange: (next: string) => void;
  onSave: () => void;                  // Ctrl+S(preventDefault する)
  readOnly?: boolean;
  wrap?: boolean;                      // 折り返し(既定 false。マークダウンは true)
  autoFocus?: boolean;
  ariaLabel?: string;
};
// MarkdownEditor.tsx
type MarkdownEditorProps = {
  value: string; onChange: (next: string) => void; onSave: () => void;
  mode: "edit" | "split" | "preview";  // 書く / 半分 / 読む
};
// MarkdownPreview.tsx:  { value: string }   languages.ts: languageForFilename(name) → { id, label, extension?: Extension } 
```
- **CodeMirror 6**(`@codemirror/*` は導入済み)を、薄い React コンポーネントで包む(`@uiw/react-codemirror` は使わない)。`EditorView` は、コンポーネントの生存中ずっと1つ。外から `value` が変わったとき(再読み込みなど)だけ、文書を差し替える(自分の入力による変更では、カーソルが飛ばない)。**日本語入力(IME)の変換中(`view.composing`)は、外からの文書の差し替えをしない。装飾(decoration)を、変換中に動かさない**(IMEの不具合を避けるため)。
- 機能: 行番号、現在行のごく薄い強調、括弧の対応、履歴(Ctrl+Z / Ctrl+Y)、検索(Ctrl+F。`@codemirror/search`)、Tab でインデント(`indentWithTab`)、Ctrl+S で `onSave`。合字(リガチャ)は無効(`font-variant-ligatures: none`)。
- 言語(拡張子): TypeScript/TSX・JavaScript/JSX(`@codemirror/lang-javascript`)、Python、SQL(`.sql`。Jinja入りのdbtは `lang-jinja` で `{{ }}` `{% %}` を色分け。`jinja({ base: sql() })` を試し、うまくいかなければ SQL のみ)、YAML、JSON、CSS、HTML、Markdown、Rust、Shell(`.sh`、`@codemirror/legacy-modes` の shell)、TOML(legacy-modes)、その他はプレーンテキスト。`languageForFilename` は純粋関数で、**テストする**。
- 見た目: **CSS変数**で作る(色・書体・行間)。文字色・背景・行番号・選択色・カーソルは、`:root` の変数(`--ink` `--soft` `--line` `--white` `--mono` と、プロジェクト色 `--proj` `--proj-d`。無ければ `--sky` `--sky-d`)から。**プロジェクトを切り替えても、エディタを作り直さずに色が変わる**こと(`--proj` の変更だけで反映される作りにする)。コードの色分けは、36の見本の `.tk-*`(キーワード=紫、文字列=緑、コメント=灰、数字=琥珀、関数=青)の系統で、淡い面の上でも読める濃さ。フォントは 13px、行間 1.7、タブ幅は言語ごと(py/rs/sql=4、他=2)。コードの背景は、読みやすいよう、ほぼ白(36の見本のエディタ本文と同じ)。
- マークダウン: `edit` = 折り返しありの CodeMirror(Markdown)、`preview` = `MarkdownPreview`、`split` = 左右 50/50(スクロールの同期は、MVPでは不要)。`MarkdownPreview` は **react-markdown + remark-gfm**(導入済み)。見た目は36の見本のエディタのマークダウン(`.ml-md-out`)に倣う: 見出し(h1/h2/h3)、段落、箇条書き・番号つき、**タスクリスト(`- [ ]` `- [x]` を、チェックの丸で表示。操作はできない)**、引用(プロジェクト色の左の線+淡い面)、表、コード(インライン・ブロック。ブロックは等幅で枠つき)、水平線、リンク。生のHTMLは描画しない(react-markdown の既定のまま)。**リンクは、画面を遷移させない**: http(s) は、Tauri内では `@tauri-apps/plugin-opener` の `openUrl`(導入済み)、ブラウザでは `window.open(..., "noopener")`。相対リンクは、MVPでは何もしない。画像は、altテキストの表示でよい。
- テスト(Vitest): `languageForFilename`(拡張子の対応、大文字・複数ドット・拡張子なし・`.d.ts`・`Dockerfile` 等)。画面は、ブラウザでのスクリーンショットで確認する(開発用のデモ: `import.meta.env.DEV` のときだけ `?demo=cm` で、各言語のサンプル文書+マークダウン3モードを並べて見られるページを用意してよい)。

## 6. エディタ画面の本体の要件(フロントエンド、`src/features/editor/`。部品の完成後に作る)
- 画面の切り替え: ストアに `view: "board" | "editor"` と `editorProjectId`。カードのクリックで開く(ドラッグ・メモ編集・×ボタンのクリックでは開かない)。戻る = ボタンと Esc(ただし、エディタ内の検索ボックスやダイアログ操作中の Esc は、そちらを優先)。切り替えにアニメーションは付けない。ボードの状態(ズーム・パン・手書き)は、戻ったとき、そのまま。
- ヘッダー: 戻るボタン、プロジェクト名、パス、言語バー、GitHubチップ、ブランチ、ひと言メモ(ボードのカードと**同じ部品**を使う)。**REVIEW チップは置かない**。
- ツリー: `list_dir` で、フォルダを開いたときに読む(開閉の状態は、プロジェクトごとにメモリで保持)。アイコンは拡張子ごとに、言語色(36の見本)。選択中のファイルは、プロジェクト色で強調。「再読み込み」ボタン。
- タブ: 開いたファイルを並べる。アクティブ強調(プロジェクト色)、閉じる ×、未保存は ●。未保存のタブを閉じる/ボードへ戻る/別のプロジェクトを開くときは、「保存して閉じる / 保存せず閉じる / やめる」を確認。タブの状態は、プロジェクトごとにメモリで保持(再起動での復元は、3b)。
- 本文: `read_file` の `kind` に応じて表示。`text` → マークダウン(`.md` `.mdx`。「書く/半分/読む」の切り替え。既定は半分)またはコード。`binary` / `tooLarge` / `unsupportedEncoding` → 「このファイルは開けません(理由)」の表示(編集不可)。保存 = Ctrl+S と、ヘッダー付近の「保存」ボタン。保存中・保存済み・失敗(日本語のメッセージ)を、控えめに表示。**競合**(`競合:` で始まるエラー)は、ダイアログ「ほかのアプリで変更されています。上書きする / 読み込み直す / やめる」。
- 右の AI 枠: 畳んだ状態が既定。細い縦のタブ「AI会話(準備中)」を押すと開き、「AI会話は後のバージョンで追加します」と出す。
- ファイルを開いたまま、ウィンドウに戻ってきたとき(focus)の外部変更の検出は、3b(MVPでは、保存時の競合検出のみ)。
- ブラウザ(Tauri外)でも動くよう、モックを拡張(5プロジェクトのサンプルのファイル群。ツリー・読み書きがメモリ上で動く)。

## 7. テスト・確認
- Rust: 上の §4。フロント: 純粋関数(Vitest)、画面のスクリーンショット(ボード/エディタ/マークダウン3モード/コード)。実機でしか確認できないこと(日本語入力・実際のファイル保存・ウィンドウ上の操作)は、PR に「未確認」と書き、ユーザーに確認してもらう。
