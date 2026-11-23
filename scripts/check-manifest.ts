// §7.2 發佈前檢查：manifest 與打包結果。用 `node scripts/check-manifest.ts` 執行（Node 22.18+ 直接執行 TS）。
// 只檢查正式建置（`wxt build`）；WXT 開發模式會放寬 CSP，不能拿去發佈。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { sha256 } from './content-modules-plugin.ts';
import {
  CONTENT_SCRIPT_EXCLUDE_MATCHES,
  CONTENT_SCRIPT_FILE,
  CONTENT_SCRIPT_MATCHES,
  CONTENT_SCRIPT_RUN_AT,
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
  | { matches?: unknown; exclude_matches?: unknown; run_at?: unknown; js?: unknown; css?: unknown; all_frames?: unknown; world?: unknown }[]
  | undefined;
if (!Array.isArray(cs) || cs.length !== 1) {
  fail('exactly one content_scripts entry is expected');
} else {
  const [c] = cs;
  if (!sameList(c!.matches, CONTENT_SCRIPT_MATCHES)) fail('content script matches differ');
  if (!sameList(c!.exclude_matches, CONTENT_SCRIPT_EXCLUDE_MATCHES)) fail('content script exclude_matches differ (§3.2.5)');
  if (!sameList(c!.js, [CONTENT_SCRIPT_FILE])) fail(`content script must be ${CONTENT_SCRIPT_FILE}`);
  if (c!.css !== undefined) fail('content script must not load CSS files (§3.2.5)');
  if (c!.run_at !== CONTENT_SCRIPT_RUN_AT) fail(`content script must run at ${CONTENT_SCRIPT_RUN_AT} (DOM clobbering, §3.2.5)`);
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
  // Function 建構子（含沒有 new 的 Function(...)）。唯一允許的是 zod 偵測 eval 是否可用的空字串探測 Function("")，
  // 它不執行任何程式碼，而且 jitless 下不會被呼叫（§3.2.3）。
  for (const m of text.matchAll(/(?<![.\w$])Function\s*\(([^)]*)\)/g)) {
    if (!/^\s*(``|""|'')\s*$/.test(m[1]!)) fail(`${rel}: contains Function(${m[1]!.slice(0, 40)})`);
  }
  if (/(^|[^.\w$])eval\s*\(/.test(text)) fail(`${rel}: contains eval(`);
  if (/mypage\/coupon(?!\/list\/ajax)/.test(text)) fail(`${rel}: contains /mypage/coupon (coupon issue endpoint)`);
  if (text.includes('/home/buy')) fail(`${rel}: contains /home/buy`);
  // 加入購物車的實際路徑（§3.4 第 4 層，2026-11-23 實測）：列表頁的 GET 連結與作品頁按鈕的 POST。
  // selectors.ts 的 regex 寫成 cart\/=\/product_id（跳脫的斜線），不會被這條掃到。
  if (/\/cart\/=\/product_id|\/api\/cart\//.test(text)) fail(`${rel}: contains an add-to-cart path`);
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
    // 樣式裡的 url() 等會以 DLsite 頁面的身分發出帶 cookie 的請求（§3.2.5）
    // CSS 的 url() 不分大小寫；JS 的 new URL(...) 不算
    [/(?<!new\s+)url\s*\(|@import|image-set\s*\(/i, 'url( / @import / image-set('],
    [/setAttributeNode|createAttribute|insertRule|CSSStyleSheet|adoptedStyleSheets/, 'attribute node / stylesheet API'],
    [/\.on(message|click|error|load)\s*=/, 'on* event handler property'],
    // isolated world 沒有 browser 全域，頁面能用 <form id="browser"> 蓋掉它（v0.11，M2 審查）；content script 一律用 chrome
    [/globalThis\.browser|\bbrowser\??\.runtime/, 'browser global (DOM clobbering; use chrome)'],
  ];
  for (const [re, name] of forbidden) if (re.test(text)) fail(`${CONTENT_SCRIPT_FILE}: contains ${name}`);
}

// content script 的模組清單（§3.2.5）：由 scripts/content-modules-plugin.ts 在建置時輸出，
// 和 scripts/content-modules.baseline.json 比對，出現沒列過的套件就失敗。
const modulesPath = join(dirname(OUT), 'content-modules.json');
const contentPackages: string[] = [];
if (!existsSync(modulesPath)) {
  fail(`${relative(ROOT, modulesPath)} not found (content-modules plugin did not run)`);
} else {
  const report = JSON.parse(readFileSync(modulesPath, 'utf8')) as {
    file?: string;
    sha256?: string;
    modules?: { id: string; pkg: string | null; bytes: number }[];
  };
  const baseline = JSON.parse(readFileSync(join(ROOT, 'scripts/content-modules.baseline.json'), 'utf8')) as {
    packages: string[];
    files: string;
  };
  const allowedFile = new RegExp(baseline.files);
  if (report.file !== CONTENT_SCRIPT_FILE || !Array.isArray(report.modules)) fail('content-modules.json is malformed');
  // 清單必須是這一次建置的結果（本機殘留的舊檔不算）
  if (existsSync(contentPath) && report.sha256 !== sha256(readFileSync(contentPath, 'utf8')))
    fail('content-modules.json does not match the built content script (stale report; rebuild)');
  for (const m of report.modules ?? []) {
    if (m.pkg !== null && !contentPackages.includes(m.pkg)) contentPackages.push(m.pkg);
    if (m.pkg !== null && !baseline.packages.includes(m.pkg))
      fail(`${CONTENT_SCRIPT_FILE}: new package "${m.pkg}" (${m.id}); review it, then add it to scripts/content-modules.baseline.json`);
    // 專案內的檔案也比對（間接 import 進來的 lib 檔案，lint 的白名單看不到）
    if (m.pkg === null && !allowedFile.test(m.id)) fail(`${CONTENT_SCRIPT_FILE}: unexpected project module ${m.id} (§3.2.5 whitelist)`);
  }
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
console.log(
  `check-manifest: OK (${jsFiles.length} js files, manifest ${relative(ROOT, manifestPath)}, content script packages: ${contentPackages.join(', ') || 'none'})`,
);
