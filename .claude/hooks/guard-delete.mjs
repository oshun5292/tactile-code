// 安全ガード(PreToolUse フック): 削除系・push系のコマンドを、実行の直前に検査する。
//
// 方針(ユーザー決定):
//   - 機能ブランチ(feat/ など)の commit・push・PR作成は許可。main への push、強制push、PRのマージはブロック
//   - プロジェクトの内側の削除は許可する(ビルド成果物などの片付けのため)
//   - 次は禁止する: .git の削除 / プロジェクトの外の削除 / 変数や曖昧な場所の削除
//   - 安全装置自体(.claude)の削除も禁止する
//
// 限界: コマンド「文字」の解析なので、うっかり事故の防止が目的。意図的に紛らわしく書かれた削除は防げない。
// 判断がつかないときは、安全側でブロックする(exit 2。理由は stderr に出し、モデルに返る)。
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// このファイルは <project>/.claude/hooks/ にある。プロジェクトのルートは2つ上。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEP = path.sep;
const norm = (p) => path.resolve(p).toLowerCase();
const ROOT_N = norm(ROOT);
const PROTECTED_NAMES = new Set(['.git', '.claude']);

const block = (why) => {
  process.stderr.write(`[削除ガード] ブロックしました: ${why}\n` +
    `  許可されるのは「プロジェクト(${ROOT})の内側」の、絶対パスで明示した削除です。` +
    `.git と .claude、変数・ワイルドカードだけの指定、プロジェクトの外は禁止です。\n`);
  process.exit(2);
};

const readStdin = () => new Promise((resolve) => {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (data += c));
  process.stdin.on('end', () => resolve(data));
});

let input = {};
try { input = JSON.parse((await readStdin()) || '{}'); } catch { block('フックの入力を読めませんでした'); }
const cmd = String(input.tool_input?.command ?? '');
const cwd = input.cwd || process.cwd();
if (!cmd.trim()) process.exit(0);

// --- 常にブロックする、危険な削除手段 ---
if (/\[\s*(system\.)?io\.(directory|file)\s*\]\s*::\s*delete/i.test(cmd) || /\b(directory|file)\.delete\s*\(/i.test(cmd)) {
  block('.NET の Delete 呼び出しは、場所を検査できないため使えません(Remove-Item を絶対パスで使ってください)');
}
if (/\bgit\s+clean\b/i.test(cmd)) block('git clean は、追跡外のファイルを消すため、ユーザーに確認してください');
if (/\brobocopy\b[^\n;|&]*\s\/(mir|purge)\b/i.test(cmd)) block('robocopy の /MIR・/PURGE は削除を伴うため使えません');

// --- main への push・PRのマージは、ユーザーだけが行う(機能ブランチの push は許可) ---
if (/\bgh\s+pr\s+merge\b/i.test(cmd)) block('PRのマージは、ユーザーが GitHub 上で行います');
if (/\bgit\s+push\b/i.test(cmd)) {
  const pushPart = cmd.split(/\bgit\s+push\b/i)[1].split(/;|&&|\|\||\||\r?\n/)[0];
  if (/(^|[\s:])(main|master)(\s|$)/i.test(pushPart)) block('main への push は、ユーザーが行います(機能ブランチへ push して、PRにしてください)');
  if (/(^|\s)(--force\b|-f\b|--force-with-lease\b|--delete\b|-d\b|--mirror\b|--all\b)/i.test(pushPart)) block('強制 push・ブランチ削除・全ブランチ push は禁止です');
  try {
    const cur = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (/^(main|master)$/i.test(cur)) block('いまのブランチが main です。機能ブランチに切り替えてから push してください');
  } catch { block('現在のブランチを確認できませんでした'); }
}

// --- 削除コマンドの検出 ---
const DEL_VERB = /(^|[\s;&|({])(remove-item|ri|rm|del|erase|rd|rmdir|rimraf)(?=[\s;&|)}]|$)/i;
if (!DEL_VERB.test(cmd)) process.exit(0); // 削除ではない → 通常の権限確認へ

const hasChdir = /(^|[\s;&|({])(cd|chdir|set-location|sl|push-location|pushd|pop-location|popd)(?=[\s;&|)}]|$)/i.test(cmd);
const segments = cmd.split(/;|&&|\|\||\||\r?\n/);
const TOKEN = /"([^"]*)"|'([^']*)'|(\S+)/g;
const VALUE_FLAGS = new Set(['-include', '-exclude', '-filter', '-credential', '-stream', '-erroraction', '-ea',
  '-warningaction', '-wa', '-informationaction', '-errorvariable', '-ev', '-outvariable', '-ov', '-depth']);
const PATH_FLAGS = new Set(['-path', '-literalpath', '-lp']);

let checked = 0;
for (const seg of segments) {
  const m = DEL_VERB.exec(seg);
  if (!m) continue;
  const rest = seg.slice(m.index + m[0].length);
  const tokens = [];
  for (const t of rest.matchAll(TOKEN)) tokens.push(t[1] ?? t[2] ?? t[3]);

  const targets = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const low = tok.toLowerCase();
    if (/^\d?>/.test(tok) || /^&?>/.test(tok)) continue;       // リダイレクト
    if (PATH_FLAGS.has(low)) { if (tokens[i + 1] != null) targets.push(tokens[++i]); continue; }
    if (/^-(path|literalpath):/i.test(tok)) { targets.push(tok.replace(/^-[a-z]+:/i, '')); continue; }
    if (VALUE_FLAGS.has(low)) { i++; continue; }                // 値をとるオプション
    if (tok.startsWith('-')) continue;                          // その他のオプション(-Recurse, -rf など)
    targets.push(tok);
  }
  if (targets.length === 0) block('削除する場所を解析できませんでした(パイプで渡す形などは使えません)');

  for (const t of targets) {
    if (!t) continue;
    if (/[`$%]/.test(t)) block(`変数を含む場所は削除できません: ${t}`);
    if (t.startsWith('~')) block(`ホームを指す場所は削除できません: ${t}`);
    const isAbs = path.isAbsolute(t);
    if (!isAbs && hasChdir) block(`ディレクトリ移動と相対パスの併用は禁止です。絶対パスで書いてください: ${t}`);

    const wild = t.search(/[*?[]/);
    let resolved;
    if (wild >= 0) {
      const base = t.slice(0, wild);
      const baseDir = /[\\/]$/.test(base) ? base : (base.includes('\\') || base.includes('/') ? path.dirname(base) : '.');
      resolved = path.resolve(cwd, baseDir);
      if (norm(resolved) === ROOT_N) block(`プロジェクト直下のワイルドカード削除は禁止です: ${t}`);
    } else {
      resolved = path.resolve(cwd, t);
    }

    const rn = norm(resolved);
    if (rn === ROOT_N) block('プロジェクトのフォルダそのものは削除できません');
    if (!rn.startsWith(ROOT_N + SEP)) block(`プロジェクトの外は削除できません: ${resolved}`);
    const rel = path.relative(ROOT, resolved).split(/[\\/]/);
    const hit = rel.find((p) => PROTECTED_NAMES.has(p.toLowerCase()));
    if (hit) block(`${hit} は削除できません: ${resolved}`);
    checked++;
  }
}
if (checked === 0) block('削除する場所を確認できませんでした');
process.exit(0); // すべて「プロジェクトの内側」→ 通常の権限確認へ
