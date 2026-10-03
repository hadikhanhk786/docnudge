// Mechanical gate for a change. Node built-ins only. Exit 1 on findings.
//   node check.mjs [--allow <comma-separated paths or globs>]
// 1. typecheck every tsconfig in `npm run typecheck` with --noUnusedLocals --noUnusedParameters (changed files only)
// 2. heuristic unused-export scan (exports nothing imports)
// 3. changed files outside --allow
// 4. diff stat + export lines added, so each addition gets a named caller
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { CODE, ROOT, buildGraph, listFiles, read, sortStr } from './scan.mjs';

// Entry points whose exports are consumed by a runtime, not an import.
const ENTRY_EXPORTS = new Set(['functions/api/[[route]].ts:onRequest', 'cron/src/index.ts:default', 'vite.config.ts:default']);
const ENTRY_FILES = new Set(['src/main.tsx']);
// Map refreshes are part of every structural change, so they never count as out of scope.
const ALWAYS_ALLOWED = ['.claude/skills/scoped-dev/references/repo-map.md', '.claude/skills/scoped-dev/references/map-index.json'];

const git = (...args) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
};

function changedFiles() {
  if (git('rev-parse', 'HEAD') === null) return null;
  const tracked = git('diff', '--name-only', 'HEAD') ?? '';
  const untracked = git('ls-files', '--others', '--exclude-standard') ?? '';
  return [...new Set(`${tracked}\n${untracked}`.split('\n').filter(Boolean))].sort(sortStr);
}

const globRe = (g) =>
  new RegExp(`^${g.trim().replace(/\/$/, '/**').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);

const args = process.argv.slice(2);
const allowArg = args.includes('--allow') ? args[args.indexOf('--allow') + 1] ?? '' : null;
const changed = changedFiles();
const inScope = (f) => changed === null || changed.includes(f);
let findings = 0;

// ---------------------------------------------------------------- 1. typecheck
const pkg = JSON.parse(read('package.json'));
const projects = [...(pkg.scripts?.typecheck ?? '').matchAll(/-p\s+(\S+)/g)].map((m) => m[1]);
const tsc = join(ROOT, 'node_modules/typescript/bin/tsc');
const errors = new Set();
for (const p of projects) {
  const r = spawnSync(process.execPath, [tsc, '-p', p, '--noEmit', '--noUnusedLocals', '--noUnusedParameters', '--pretty', 'false'], { cwd: ROOT, encoding: 'utf8' });
  if (r.error) {
    console.log(`typecheck: could not run tsc (${r.error.message})`);
    findings++;
  }
  for (const line of `${r.stdout}`.split('\n')) if (/error TS\d+/.test(line)) errors.add(line.replace(/\\/g, '/').trim());
}
const tcNew = [...errors].filter((e) => inScope(e.slice(0, e.indexOf('('))));
console.log(`typecheck (${projects.join(', ')}; +unused flags): ${tcNew.length} in changed files, ${errors.size - tcNew.length} pre-existing elsewhere`);
for (const e of tcNew) console.log(`  ${e}`);
findings += tcNew.length;

// ---------------------------------------------------------------- 2. unused exports
const g = buildGraph(listFiles());
const unused = [];
for (const f of g.code) {
  if (ENTRY_FILES.has(f) || /\.test\.(ts|tsx)$/.test(f)) continue;
  const used = g.used[f] ?? new Set();
  for (const name of g.exports[f]) {
    if (!used.has('*') && !used.has(name) && !ENTRY_EXPORTS.has(`${f}:${name}`)) unused.push([f, name]);
  }
}
const unusedNew = unused.filter(([f]) => inScope(f));
console.log(`unused exports (heuristic): ${unusedNew.length} in changed files, ${unused.length - unusedNew.length} pre-existing elsewhere`);
for (const [f, n] of unusedNew) console.log(`  ${f}: ${n}`);
findings += unusedNew.length;

// ---------------------------------------------------------------- 3. scope
if (allowArg !== null) {
  if (changed === null) console.log('scope: no git history, cannot compare');
  else {
    const pats = [...allowArg.split(','), ...ALWAYS_ALLOWED].filter((s) => s.trim()).map(globRe);
    const outside = changed.filter((f) => !pats.some((re) => re.test(f)));
    console.log(`scope: ${outside.length} changed file(s) outside --allow`);
    for (const f of outside) console.log(`  ${f}`);
    findings += outside.length;
  }
}

// ---------------------------------------------------------------- 4. diff summary
if (changed !== null) {
  const stat = (git('diff', '--stat', 'HEAD') ?? '').trimEnd();
  const untracked = (git('ls-files', '--others', '--exclude-standard') ?? '').split('\n').filter(Boolean);
  console.log(`diff: ${changed.length} file(s) changed`);
  if (stat) console.log(stat.replace(/^/gm, '  '));
  for (const f of untracked) console.log(`  (new) ${f}`);
  const added = [];
  let file = '';
  for (const line of (git('diff', '-U0', 'HEAD') ?? '').split('\n')) {
    if (line.startsWith('+++ ')) file = line.slice(6);
    else if (/^\+\s*export\b/.test(line) && CODE.test(file)) added.push(`${file}: ${line.slice(1).trim().slice(0, 100)}`);
  }
  for (const f of untracked.filter((x) => CODE.test(x))) {
    for (const line of read(f).split('\n')) if (/^\s*export\b/.test(line)) added.push(`${f}: ${line.trim().slice(0, 100)}`);
  }
  console.log(`export lines added: ${added.length}${added.length ? ' (name a caller for each)' : ''}`);
  for (const a of added) console.log(`  ${a}`);
}

console.log(findings ? `check: ${findings} finding(s)` : 'check: OK');
process.exitCode = findings ? 1 : 0;
