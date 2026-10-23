# 段階3b-3 契約書(UTF-8 以外の文字コード)

方針: VSCode と同じ体験 — 自動判定して開く / 状態バーで文字コードを見る / 「エンコード付きで再度開く」「エンコード付きで保存」。
コードが正。依存 `encoding_rs` は追加済み(Cargo.toml)。他の依存は追加しない。

## 1. 扱う文字コード
`utf-8, shift_jis, euc-jp, utf-16le, utf-16be, windows-1252, gbk, big5, euc-kr`(`src/api/types.ts` の `ENCODINGS`。作成済み。変えない)。

## 2. API の変更(types.ts / tauri.ts は作成済み)
- `FileContent.encoding: EncodingName` を追加。
- `readFile(projectId, relPath, encoding?)`: 指定があれば自動判定せず、その文字コードで読む(不正な並びがあれば、置換文字にせず `unsupportedEncoding` として返す)。
- `writeFile(..., eol, hasBom, encoding, force)`: `encoding` を追加(`hasBom` の次、`force` の前)。

## 3. バックエンド(Rust。src-tauri/ のみ)
- 自動判定の順序: ①BOM(UTF-8 / UTF-16LE / UTF-16BE。`hasBom` を true に) ②NUL バイトを含む(UTF-16 の BOM が無いもの含む)→ 従来どおり `binary` ③UTF-8 として正しい → `utf-8` ④ `shift_jis` で、エラー(不正バイト)なしにデコードできる → `shift_jis` ⑤ `euc-jp` で同様 → `euc-jp` ⑥ どれでもない → `unsupportedEncoding`。
  (`windows-1252/gbk/big5/euc-kr` は自動判定の対象外。ユーザーが「再度開く」で指定したときだけ使う)
- UTF-16 は encoding_rs ではエンコードできないので、デコード・エンコードとも手書き(`u16` 変換)。BOM は `hasBom` で再現。UTF-16 は、BOM が無い保存を許さない(`hasBom` を強制 true)。
- `write_file`: 本文を指定の文字コードへ変換。**変換できない文字があれば、書かずに `変換:` で始まるエラー**(例: 「変換: 一部の文字が shift_jis で表せません」)。既存の競合検出・原子的書き込み・EOL 復元・2MB 制限はそのまま。
- 文字コードを変えて保存した場合も、同じ経路(`encoding` 引数が新しい文字コード)。
- テスト: 判定(BOM 3種・UTF-8・Shift_JIS・EUC-JP・判定不能・バイナリ)、往復(読んで保存して、バイト列が同じ)、変換不能、UTF-16 の往復、「指定して読む」、IPC 契約テストの更新。既存テストのシグネチャ変更も直す。
- 完了条件: `cargo test` / `cargo clippy -- -D warnings` / `cargo fmt --check` が通る。

## 4. フロントエンド(src/ のみ。api/types.ts と tauri.ts は変更しない)
- `mock.ts`: 新シグネチャに合わせる。モックのファイルに、Shift_JIS 扱いのサンプルを1つ入れてよい(判定は固定値でよい)。
- タブ(`editorLogic.ts` の `Tab`)に `encoding` を持たせ、保存時に渡す。
- 状態バー(またはヘッダーの保存状態の近く)に、現在の文字コードを表示(`UTF-8` など。表示名は大文字)。クリックでメニュー: 「エンコード付きで再度開く」「エンコード付きで保存」→ 文字コードの一覧(`ENCODINGS`)。メニューは `src/shared/ui/ContextMenu.tsx` を再利用。
  - 再度開く: 未保存の変更があれば、破棄の確認(既存 `ChoiceDialog`)。その後 `readFile(..., encoding)` で読み直す。
  - 保存: 選んだ文字コードで `writeFile`。成功したらタブの `encoding` を更新。`変換:` エラーは、保存失敗の表示(既存)に出す。
- `unsupportedEncoding` のタブは、「文字コードを判別できません」と、「エンコード付きで再度開く」の導線を出す(既存の「開けない理由」の表示に追加)。
- 純粋関数+Vitest。完了条件: `pnpm build` と `pnpm test`。可能ならブラウザ(モック)で確認し、dev サーバーは止める(ポート 1420 を空ける)。
