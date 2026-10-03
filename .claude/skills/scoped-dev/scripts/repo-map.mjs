// Repo map generator. Node built-ins only.
//   --write   regenerate the marked regions of references/repo-map.md and references/map-index.json
//   --status  one-glance freshness (always exits 0; safe for skill injection)
//   --check   exit 1 if the map is stale
//   --describe <path> <purpose>   set a file's purpose in the file index (the map lives under .claude/, which edit tools may not write)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SKILL_DIR, buildGraph, listFiles, read, sha1, sortStr } from './scan.mjs';

const MAP = join(SKILL_DIR, 'references/repo-map.md');
const INDEX = join(SKILL_DIR, 'references/map-index.json');
const REGIONS = ['files', 'modules', 'tests', 'routes', 'db', 'env', 'scripts', 'i18n', 'templates'];
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;
const tick = (s) => `\`${s}\``;

function hashes(files) {
  const out = {};
  for (const f of files) out[f] = sha1(read(f));
  return out;
}

function diffIndex(prev, next) {
  const added = Object.keys(next).filter((f) => !(f in prev));
  const removed = Object.keys(prev).filter((f) => !(f in next));
  const changed = Object.keys(next).filter((f) => f in prev && prev[f] !== next[f]);
  return { added, removed, changed };
}

const loadIndex = () => (existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : null);

// ---------------------------------------------------------------- generated regions
function genFiles(files, oldMap) {
  const purpose = {};
  for (const m of oldMap.matchAll(/^\| `([^`]+)` \| \d+ \| (.*) \|$/gm)) purpose[m[1]] = m[2];
  const rows = files.map((f) => `| ${tick(f)} | ${read(f).replace(/\n$/, '').split('\n').length} | ${purpose[f] ?? 'TODO: describe'} |`);
  return ['| file | lines | purpose |', '|---|---|---|', ...rows].join('\n');
}

function closure(start, edges) {
  const seen = new Set();
  const stack = [...(edges[start] ?? [])];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    stack.push(...(edges[f] ?? []));
  }
  return [...seen].sort(sortStr);
}

function genModules(g) {
  const rows = g.code
    .filter((f) => g.exports[f].length || g.importers[f])
    .map((f) => {
      const direct = [...(g.importers[f] ?? [])].sort(sortStr);
      const more = closure(f, g.importers).length - direct.length;
      return `| ${tick(f)} | ${g.exports[f].join(', ') || '-'} | ${direct.join(', ') || '-'}${more ? ` (+${more} transitive)` : ''} |`;
    });
  return ['| module | exports | changing it affects: direct importers (+transitive) |', '|---|---|---|', ...rows].join('\n');
}

function genTests(files, g) {
  const fwd = Object.fromEntries(g.code.map((f) => [f, g.deps[f].map((d) => d.target)]));
  return files
    .filter((f) => /\.test\.(ts|tsx)$/.test(f))
    .map((f) => `- ${tick(`npx vitest run ${f}`)} reaches: ${closure(f, fwd).join(', ')}`)
    .join('\n');
}

function genRoutes(g) {
  const out = [];
  for (const f of g.code) {
    const text = read(f);
    if (text.includes('new Hono')) {
      const base = {};
      const parent = {};
      for (const m of text.matchAll(/(?:const|let)\s+(\w+)\s*=\s*new Hono[^(]*\([^)]*\)(?:\.basePath\(\s*['"]([^'"]+)['"]\s*\))?/g)) base[m[1]] = m[2] ?? '';
      for (const m of text.matchAll(/(\w+)\.route\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\)/g)) parent[m[3]] = [m[1], m[2]];
      const prefix = (v, depth = 0) => (parent[v] && depth < 10 ? prefix(parent[v][0], depth + 1) + parent[v][1] : '') + (base[v] ?? '');
      for (const m of text.matchAll(/^[ \t]*(\w+)\.(get|post|put|patch|delete|all)\(\s*['"]([^'"]+)['"]/gm)) {
        if (!(m[1] in base)) continue;
        const path = (prefix(m[1]) + (m[3] === '/' ? '' : m[3])).replace(/\/+/g, '/') || '/';
        out.push(`| ${m[2].toUpperCase()} | ${tick(path)} | ${f}:${lineOf(text, m.index)} |`);
      }
    }
    for (const m of text.matchAll(/<Route\s+path="([^"]+)"/g)) out.push(`| SPA | ${tick(m[1])} | ${f}:${lineOf(text, m.index)} |`);
  }
  return ['| method | path | where |', '|---|---|---|', ...out].join('\n');
}

function genDb(files) {
  if (!files.includes('schema.sql')) return '(no schema.sql)';
  const text = read('schema.sql');
  const out = [];
  for (const m of text.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)) {
    const cols = [];
    for (const raw of m[2].split('\n')) {
      const line = raw.replace(/--.*$/, '').trim();
      const c = line.match(/^(\w+)\s+(\w+)/);
      if (!c || /^(primary|unique|constraint|check|foreign)$/i.test(c[1])) continue;
      const fk = line.match(/references (\w+)/);
      cols.push(`${c[1]} ${c[2]}${fk ? `→${fk[1]}` : ''}`);
    }
    out.push(`- **${m[1]}** (schema.sql:${lineOf(text, m.index)}): ${cols.join(', ')}`);
  }
  const idx = [...text.matchAll(/create index if not exists (\w+) on (\w+)/g)].map((m) => `${m[1]}(${m[2]})`);
  if (idx.length) out.push(`- indexes: ${idx.join(', ')}`);
  return out.join('\n');
}

function genEnv(files, g) {
  const out = [];
  for (const f of g.code) {
    for (const m of read(f).matchAll(/interface (\w*Env)\b([^{]*)\{([^}]*)\}/g)) {
      const names = [...m[3].matchAll(/^\s*([A-Z_][A-Z0-9_]*)\??:/gm)].map((x) => x[1]);
      const ext = m[2].match(/extends\s+(.+)/);
      out.push(`- ${tick(m[1])} (${f})${ext ? ` extends ${ext[1].trim()}` : ''}: ${names.join(', ') || '-'}`);
    }
  }
  for (const f of files.filter((x) => x.endsWith('.toml'))) {
    let section = '';
    const keys = {};
    for (const line of read(f).split('\n')) {
      const s = line.match(/^\s*\[\[?([\w.]+)\]\]?/);
      if (s) section = s[1];
      const k = line.match(/^\s*(\w+)\s*=/);
      if (k && section && (section === 'vars' || k[1] === 'binding' || k[1] === 'crons')) (keys[section] ??= []).push(k[1] === 'binding' ? line.split('=')[1].trim().replace(/"/g, '') : k[1]);
    }
    for (const [s, k] of Object.entries(keys)) out.push(`- ${f} [${s}]: ${k.join(', ')}`);
  }
  for (const f of files.filter((x) => x.endsWith('.example'))) {
    out.push(`- ${f}: ${[...read(f).matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]).join(', ')}`);
  }
  const vite = new Set();
  for (const f of g.code) for (const m of read(f).matchAll(/import\.meta\.env\.(VITE_\w+)/g)) vite.add(`${m[1]} (${f})`);
  if (vite.size) out.push(`- browser (Vite): ${[...vite].sort(sortStr).join(', ')}`);
  return out.join('\n');
}

function genScripts() {
  const pkg = JSON.parse(read('package.json'));
  return Object.entries(pkg.scripts ?? {}).map(([k, v]) => `- ${tick(`npm run ${k}`)}: ${v}`).join('\n');
}

function genI18n(files) {
  const locales = files.filter((f) => /locales\/\w+\.json$/.test(f));
  const keys = Object.fromEntries(locales.map((f) => [f, Object.keys(JSON.parse(read(f)))]));
  const base = locales.find((f) => f.endsWith('/en.json'));
  return locales
    .map((f) => {
      const missing = base ? keys[base].filter((k) => !keys[f].includes(k)) : [];
      const extra = base ? keys[f].filter((k) => !keys[base].includes(k)) : [];
      return `- ${f}: ${keys[f].length} keys${missing.length || extra.length ? ` — missing: ${missing.join(', ') || '-'}; extra: ${extra.join(', ') || '-'}` : ' (parity ok)'}`;
    })
    .join('\n');
}

function genTemplates(files) {
  if (!files.includes('shared/packs.ts')) return '(no shared/packs.ts)';
  const text = read('shared/packs.ts');
  const chunks = text.split(/\bid: '/).slice(1);
  return chunks
    .map((c) => {
      const id = c.slice(0, c.indexOf("'"));
      const items = c.match(/\bit\('/g)?.length ?? 0;
      const optional = c.match(/\bit\([^\n]*,\s*false\),?\s*$/gm)?.length ?? 0;
      const rule = c.match(/type: '(\w+)'/)?.[1] ?? '?';
      return `${id} (${items} items, ${optional} optional, ${rule})`;
    })
    .join(' · ');
}

// ---------------------------------------------------------------- assemble
const HEADER = `# Repo map (DocChase)

Generated regions are owned by \`scripts/repo-map.mjs --write\` (heuristic regex parsing). The map says where; the source says what. If they disagree, trust the source and refresh the map. Everything outside the markers is hand-written and preserved.
`;

function render(oldMap, files, g) {
  const body = {
    files: genFiles(files, oldMap),
    modules: genModules(g),
    tests: genTests(files, g),
    routes: genRoutes(g),
    db: genDb(files),
    env: genEnv(files, g),
    scripts: genScripts(),
    i18n: genI18n(files),
    templates: genTemplates(files),
  };
  let out = oldMap || HEADER;
  for (const r of REGIONS) {
    const start = `<!-- gen:${r}:start -->`;
    const end = `<!-- gen:${r}:end -->`;
    const block = `${start}\n${body[r]}\n${end}`;
    const re = new RegExp(`${start}[\\s\\S]*?${end}`);
    out = re.test(out) ? out.replace(re, () => block) : `${out.trimEnd()}\n\n## ${r}\n${block}\n`;
  }
  return out.endsWith('\n') ? out : `${out}\n`;
}

function status() {
  try {
    if (!existsSync(MAP) || !existsSync(INDEX)) return console.log('repo-map: MISSING — run repo-map.mjs --write');
    const d = diffIndex(loadIndex(), hashes(listFiles()));
    const lines = readFileSync(MAP, 'utf8').split('\n').length;
    const n = d.added.length + d.changed.length + d.removed.length;
    if (!n) return console.log(`repo-map: fresh (${lines} lines) — read references/repo-map.md`);
    console.log(`repo-map: STALE (${d.changed.length} changed, ${d.added.length} added, ${d.removed.length} removed; ${lines} lines) — trust source over map for these, refresh with repo-map.mjs --write`);
    const list = [...d.added.map((f) => `+ ${f}`), ...d.changed.map((f) => `~ ${f}`), ...d.removed.map((f) => `- ${f}`)];
    for (const l of list.slice(0, 8)) console.log(`  ${l}`);
    if (list.length > 8) console.log(`  … ${list.length - 8} more`);
  } catch (err) {
    console.log(`repo-map: status unavailable (${err instanceof Error ? err.message : err})`);
  }
}

function write() {
  const files = listFiles();
  const next = hashes(files);
  const d = diffIndex(loadIndex() ?? {}, next);
  const old = existsSync(MAP) ? readFileSync(MAP, 'utf8').replace(/\r\n/g, '\n') : '';
  const out = render(old, files, buildGraph(files));
  writeFileSync(MAP, out);
  writeFileSync(INDEX, `${JSON.stringify(next, null, 1)}\n`);
  const todo = out.match(/TODO: describe/g)?.length ?? 0;
  console.log(`repo-map: wrote ${out.split('\n').length} lines; files +${d.added.length} ~${d.changed.length} -${d.removed.length}${old === out ? ' (map unchanged)' : ''}`);
  for (const f of [...d.added, ...d.removed].slice(0, 8)) console.log(`  ${d.added.includes(f) ? '+' : '-'} ${f}`);
  if (todo) console.log(`  ${todo} file purpose(s) say "TODO: describe" — fill them in`);
}

function describe(path, purpose) {
  const map = readFileSync(MAP, 'utf8');
  const re = new RegExp(`^(\\| \`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\` \\| \\d+ \\| ).*( \\|)$`, 'm');
  if (!purpose || !re.test(map)) {
    console.log(`repo-map: no file-index row for ${path} (run --write first) or empty purpose`);
    process.exitCode = 1;
    return;
  }
  writeFileSync(MAP, map.replace(re, (_, a, b) => `${a}${purpose.replace(/\|/g, '/')}${b}`));
  console.log(`repo-map: described ${path}`);
}

const mode = process.argv[2];
if (mode === '--write') write();
else if (mode === '--describe') describe(process.argv[3] ?? '', process.argv.slice(4).join(' ').trim());
else if (mode === '--check') {
  const stale = !existsSync(INDEX) || Object.values(diffIndex(loadIndex(), hashes(listFiles()))).some((a) => a.length);
  console.log(stale ? 'repo-map: STALE' : 'repo-map: fresh');
  process.exitCode = stale ? 1 : 0;
} else if (mode === '--status' || mode === undefined) status();
else {
  console.log('usage: repo-map.mjs --write | --status | --check | --describe <path> <purpose>');
  process.exitCode = 2;
}
