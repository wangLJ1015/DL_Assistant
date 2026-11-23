// §7.2 發佈前檢查：manifest 與打包結果。用 `node scripts/check-manifest.ts` 執行（Node 22.18+ 直接執行 TS）。
// 只檢查正式建置（`wxt build`）；WXT 開發模式會放寬 CSP，不能拿去發佈。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  CONTENT_SCRIPT_FILE,
  CONTENT_SCRIPT_MATCHES,
  MANIFEST_CSP,
  MANIFEST_HOST_PERMISSIONS,
  MANIFEST_PERMISSIONS,
  MINIMUM_CHROME_VERSION,
} from './manifest-policy.ts';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, process.argv[2] ?? '.output/chrome-mv3');

const errors: string[] = [];
const fail = (msg: string) => errors.push(msg);
const sameList = (a: unknown, b: readonly string[]) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

// ---- manifest.json ----
const manifestPath = join(OUT, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`check-manifest: ${relative(ROOT, manifestPath)} not found. Run \`pnpm build\` first.`);
  process.exit(1);
}
const manifestText = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestText) as Record<string, unknown>;

if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
if (manifest.minimum_chrome_version !== MINIMUM_CHROME_VERSION) fail(`minimum_chrome_version must be "${MINIMUM_CHROME_VERSION}"`);
if (!sameList(manifest.permissions, MANIFEST_PERMISSIONS)) fail(`permissions must be exactly ${JSON.stringify(MANIFEST_PERMISSIONS)}`);
if (!sameList(manifest.host_permissions, MANIFEST_HOST_PERMISSIONS))
  fail(`host_permissions must be exactly ${JSON.stringify(MANIFEST_HOST_PERMISSIONS)}`);
if ('optional_permissions' in manifest || 'optional_host_permissions' in manifest) fail('optional permissions are not allowed');

const csp = manifest.content_security_policy as { extension_pages?: unknown; sandbox?: unknown } | undefined;
if (csp?.extension_pages !== MANIFEST_CSP) fail('content_security_policy.extension_pages differs from §7.1');
if (csp && Object.keys(csp).some((k) => k !== 'extension_pages')) fail('content_security_policy has unexpected keys');
if (/localhost|127\.0\.0\.1/.test(manifestText)) fail('manifest mentions localhost (dev build?)');
if (/unsafe-eval|unsafe-inline|wasm-unsafe-eval/.test(manifestText)) fail('manifest allows unsafe-eval / unsafe-inline');
if ('web_accessible_resources' in manifest) fail('web_accessible_resources must not be declared (§7.1)');
if ('sandbox' in manifest) fail('sandbox pages are not allowed');

const ec = manifest.externally_connectable as { ids?: unknown; matches?: unknown } | undefined;
if (!ec || !sameList(ec.ids, []) || !sameList(ec.matches, []) || Object.keys(ec).length !== 2) {
  fail('externally_connectable must be { ids: [], matches: [] }');
}

const cs = manifest.content_scripts as
  { matches?: unknown; js?: unknown; css?: unknown; all_frames?: unknown; world?: unknown }[] | undefined;
if (!Array.isArray(cs) || cs.length !== 1) {
  fail('exactly one content_scripts entry is expected');
} else {
  const [c] = cs;
  if (!sameList(c!.matches, CONTENT_SCRIPT_MATCHES)) fail('content script matches differ');
  if (!sameList(c!.js, [CONTENT_SCRIPT_FILE])) fail(`content script must be ${CONTENT_SCRIPT_FILE}`);
  if (c!.css !== undefined) fail('content script must not load CSS files (§3.2.5)');
  if (c!.all_frames !== false) fail('content script must set all_frames: false');
  if (c!.world !== undefined && c!.world !== 'ISOLATED') fail('content script must run in the isolated world');
}

// ---- 打包結果 ----
const files = listFiles(OUT);
const jsFiles = files.filter((f) => f.endsWith('.js'));

if (files.some((f) => f.endsWith('.map'))) fail('source maps must not be shipped');

/** 套件內建的說明網址（不會被請求，只是字串）。 */
const ALLOWED_DOC_HOSTS = new Set(['react.dev', 'json-schema.org', 'www.w3.org']);
const ALLOWED_HOSTS = new Set(['www.dlsite.com', 'img.dlsite.jp', 'dlwatcher.com']);

for (const file of jsFiles) {
  const rel = relative(OUT, file).replaceAll('\\', '/');
  const text = readFileSync(file, 'utf8');
  if (/new\s+Function\s*\(/.test(text)) fail(`${rel}: contains new Function`);
  if (/(^|[^.\w$])eval\s*\(/.test(text)) fail(`${rel}: contains eval(`);
  if (/mypage\/coupon(?!\/list\/ajax)/.test(text)) fail(`${rel}: contains /mypage/coupon (coupon issue endpoint)`);
  if (text.includes('/home/buy')) fail(`${rel}: contains /home/buy`);
  if (/localhost|127\.0\.0\.1/.test(text)) fail(`${rel}: contains localhost`);
  for (const m of text.matchAll(/https:\/\/([a-zA-Z0-9.-]+)/g)) {
    const host = m[1]!.toLowerCase();
    if (!ALLOWED_HOSTS.has(host) && !ALLOWED_DOC_HOSTS.has(host)) fail(`${rel}: unexpected https host ${host}`);
  }
}

// content script 打包檔（§3.2.4、§3.2.5）
const contentPath = join(OUT, CONTENT_SCRIPT_FILE);
if (!existsSync(contentPath)) {
  fail(`${CONTENT_SCRIPT_FILE} not found`);
} else {
  const text = readFileSync(contentPath, 'utf8');
  const forbidden: [RegExp, string][] = [
    [/storage\.local/, 'storage.local'],
    [/\bchrome\.storage\b|\bbrowser\.storage\b/, 'storage API'],
    [/react/i, 'react'],
    [/postMessage/, 'postMessage'],
    [/CustomEvent/, 'CustomEvent'],
    [/dispatchEvent/, 'dispatchEvent'],
    [/addEventListener\(\s*[`'"]message[`'"]/, "addEventListener('message')"],
    [/\bimport\s*\(/, 'dynamic import'],
    [/\.css\b/, 'CSS file reference'],
  ];
  for (const [re, name] of forbidden) if (re.test(text)) fail(`${CONTENT_SCRIPT_FILE}: contains ${name}`);
}

// 注入徽章的樣式（M6 才會出現；有的話檢查，§3.2.5）
const badgeStylePath = join(ROOT, 'src/lib/badge-style.ts');
if (existsSync(badgeStylePath)) {
  const text = readFileSync(badgeStylePath, 'utf8');
  if (/url\(|@import|image-set\(/i.test(text)) fail('src/lib/badge-style.ts contains url( / @import / image-set(');
}

if (errors.length > 0) {
  console.error(`check-manifest: ${errors.length} problem(s) in ${relative(ROOT, OUT)}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`check-manifest: OK (${jsFiles.length} js files, manifest ${relative(ROOT, manifestPath)})`);
