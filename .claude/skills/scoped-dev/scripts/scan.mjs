// Shared, heuristic (regex) source scanner for repo-map.mjs and check.mjs. Node built-ins only.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['node_modules', 'dist', '.wrangler', '.git', '.claude']);
// Never read real secrets files; lockfiles are noise.
const SKIP_FILES = new Set(['package-lock.json', '.dev.vars', '.env']);
const EXTS = /\.(ts|tsx|mjs|js|css|sql|toml|json|md|html)$/;
const EXTRA = new Set(['.dev.vars.example', '.env.example', '_headers', '_redirects']);
export const CODE = /\.(ts|tsx|mjs|js)$/;

export const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
export const sortStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Repo-relative POSIX paths of every mapped source file, sorted. */
export function listFiles(dir = '') {
  const out = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) out.push(...listFiles(rel));
    } else if (!SKIP_FILES.has(e.name) && (EXTS.test(e.name) || EXTRA.has(e.name))) out.push(rel);
  }
  return out.sort(sortStr);
}

export const sha1 = (text) => createHash('sha1').update(text).digest('hex');

const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?([\w\s{},*$]*?)\s*from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|(?:import|vi\.mock)\(\s*['"]([^'"]+)['"]/g;

function resolveSpec(fromRel, spec) {
  if (!spec.startsWith('.')) return null;
  const base = posix.normalize(posix.join(posix.dirname(fromRel), spec));
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(join(ROOT, c)) && /\.[a-z]+$/.test(c)) return c;
  }
  return null;
}

/** Names a clause like `X, { a, b as c, type d }` or `* as ns` pulls in. '*' means the whole module. */
function clauseNames(clause, isExport) {
  const names = [];
  if (!clause || /\*/.test(clause)) return ['*'];
  const braces = clause.match(/\{([^}]*)\}/);
  if (braces) {
    for (const part of braces[1].split(',')) {
      const n = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (n) names.push(n);
    }
  }
  const def = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
  if (def && !isExport) names.push('default');
  return names;
}

/** Local imports of a file: [{ target, names }]. */
function importsOf(rel, text) {
  const out = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[2] ?? m[3] ?? m[4];
    const target = resolveSpec(rel, spec);
    if (!target) continue;
    const names = m[2] ? clauseNames(m[1], m[0].startsWith('export')) : m[4] && m[0].startsWith('vi.mock') ? [] : ['*'];
    out.push({ target, names });
  }
  return out;
}

/** Exported symbol names of a code file ('default' for a default export). */
export function exportsOf(text) {
  const names = new Set();
  for (const m of text.matchAll(/^export\s+(?:declare\s+)?(default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1] ? 'default' : m[2]);
  }
  if (/^export\s+default\b/m.test(text)) names.add('default');
  for (const m of text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim();
      if (n) names.add(n);
    }
  }
  return [...names].sort(sortStr);
}

/** Import graph over all code files: { files, exports, importers: target -> Set(from), used: target -> Set(name) }. */
export function buildGraph(files) {
  const code = files.filter((f) => CODE.test(f));
  const exports = {};
  const deps = {};
  const importers = {};
  const used = {};
  for (const f of code) {
    const text = read(f);
    exports[f] = exportsOf(text);
    deps[f] = importsOf(f, text);
    for (const { target, names } of deps[f]) {
      (importers[target] ??= new Set()).add(f);
      for (const n of names) (used[target] ??= new Set()).add(n);
    }
  }
  return { code, exports, deps, importers, used };
}
