// ESLint 設定：§3.2.1、§3.2.3、§3.2.4、§3.2.5、§3.4、§5.5 要求的規則。
// 每條安全規則在 tests/lint-fixtures/ 都有違規範例，由 tests/lint-selftest.test.ts 確認會報錯。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import globals from 'globals';

const sel = (selector, message) => ({ selector, message });
const CHROME = '/^(chrome|browser)$/';

// ---- no-restricted-syntax 的規則組（同一條規則在不同檔案要用不同組合，所以拆開組裝）----

/** §3.4 第 3 層：導覽。只有 src/lib/nav.ts 例外。 */
const NAV_SYNTAX = [
  sel(
    `CallExpression[callee.object.object.name=${CHROME}][callee.object.property.name='tabs'][callee.property.name=/^(create|update|duplicate)$/]`,
    '§3.4：開分頁只能用 lib/nav.ts 的 openTab()',
  ),
  sel(
    `CallExpression[callee.object.object.name=${CHROME}][callee.object.property.name='windows'][callee.property.name=/^(create|update)$/]`,
    '§3.4：開視窗只能用 lib/nav.ts 的 openPopupWindow()',
  ),
  sel(`CallExpression[callee.object.name=/^(window|globalThis|self|top|parent)$/][callee.property.name='open']`, '§3.4：禁止 window.open'),
  sel(`CallExpression[callee.property.name='navigate'][callee.object.name='navigation']`, '§3.4：禁止 navigation.navigate'),
  sel(`CallExpression[callee.property.name='navigate'][callee.object.property.name='navigation']`, '§3.4：禁止 navigation.navigate'),
  sel(`CallExpression[callee.property.name='openWindow']`, '§3.4：禁止 clients.openWindow'),
  sel(`AssignmentExpression[left.type='Identifier'][left.name='location']`, '§3.4：禁止對 location 指派'),
  sel(`AssignmentExpression[left.type='MemberExpression'][left.property.name='location']`, '§3.4：禁止對 *.location 指派'),
  sel(`AssignmentExpression[left.type='MemberExpression'][left.object.name='location']`, '§3.4：禁止對 location.* 指派'),
  sel(`AssignmentExpression[left.type='MemberExpression'][left.object.property.name='location']`, '§3.4：禁止對 *.location.* 指派'),
  sel(`CallExpression[callee.property.name=/^(assign|replace)$/][callee.object.name='location']`, '§3.4：禁止 location.assign／replace'),
  sel(
    `CallExpression[callee.property.name=/^(assign|replace)$/][callee.object.property.name='location']`,
    '§3.4：禁止 *.location.assign／replace',
  ),
  sel(
    `VariableDeclarator[init.type='MemberExpression'][init.object.name=${CHROME}][init.property.name=/^(tabs|windows)$/]`,
    '§3.4：禁止把 tabs／windows 指派給變數',
  ),
  sel(`VariableDeclarator[init.name=${CHROME}] > ObjectPattern > Property[key.name=/^(tabs|windows)$/]`, '§3.4：禁止解構 tabs／windows'),
  sel(
    `AssignmentExpression[right.type='MemberExpression'][right.object.name=${CHROME}][right.property.name=/^(tabs|windows)$/]`,
    '§3.4：禁止把 tabs／windows 指派給變數',
  ),
  sel(
    `CallExpression[callee.property.name='createElement'][arguments.0.value=/^(a|form|area|meta|link|base|iframe)$/i]`,
    '§3.4：禁止以程式建立會導覽的元素',
  ),
];

/** §3.4 第 3 層：品牌型別不能用斷言產生。只有 nav.ts 與 ids.ts（buildWorkUrl）例外。 */
const BRAND_SYNTAX = [
  sel(`TSAsExpression[typeAnnotation.typeName.name=/^(DlsiteNavUrl|ExtPageUrl)$/]`, '§3.4：禁止 as DlsiteNavUrl／ExtPageUrl'),
  sel(`TSTypeAssertion[typeAnnotation.typeName.name=/^(DlsiteNavUrl|ExtPageUrl)$/]`, '§3.4：禁止 <DlsiteNavUrl> 型別斷言'),
];

/** §5.5：只有 src/lib/dates.ts 可以用單一參數的 new Date(x)。 */
const DATE_SYNTAX = [sel(`NewExpression[callee.name='Date'][arguments.length=1]`, '§5.5：日期請用 lib/dates.ts')];

/** 全部檔案都適用。 */
const COMMON_SYNTAX = [
  sel(`MemberExpression[property.name=/^on(Message|Connect)External$/]`, '§3.2.4：禁止 onMessageExternal／onConnectExternal'),
  sel(`MemberExpression[object.name='z'][property.name='coerce']`, '§3.2.3：禁止 z.coerce'),
];

/** §3.2.4、§3.2.5：content script 專用。 */
const CONTENT_SYNTAX = [
  sel(
    `CallExpression[callee.property.name='createElement']:not([arguments.0.value=/^(div|span|button|style)$/])`,
    '§3.2.5：content script 只能建立 div、span、button、style',
  ),
  sel(
    `CallExpression[callee.property.name='createElementNS']:not([arguments.1.value=/^(svg|path|circle|rect|g)$/])`,
    '§3.2.5：content script 的 SVG 只能用 svg、path、circle、rect、g',
  ),
  sel(
    `CallExpression[callee.property.name=/^setAttribute(NS)?$/]:not([arguments.0.type='Literal'])`,
    '§3.2.5：setAttribute 的屬性名稱必須是字面值',
  ),
  sel(
    `CallExpression[callee.property.name=/^setAttribute(NS)?$/][arguments.0.value=/^(src|href|srcset|poster|data|action|formaction|ping|xlink:href|style|on.*)$/i]`,
    '§3.2.5：禁止設定會載入資源或執行程式的屬性',
  ),
  sel(
    `AssignmentExpression[left.property.name=/^(src|href|srcset|action|cssText|innerHTML|outerHTML)$/]`,
    '§3.2.5：禁止指派 src、href、cssText、innerHTML 等屬性',
  ),
  sel(
    `AssignmentExpression[left.computed=true][left.property.value=/^(src|href|srcset|action|cssText|innerHTML|outerHTML)$/]`,
    '§3.2.5：禁止指派 src、href、cssText、innerHTML 等屬性',
  ),
  sel(`CallExpression[callee.property.name='setProperty']`, '§3.2.5：禁止 style.setProperty'),
  sel(`CallExpression[callee.property.name=/^(click|submit|requestSubmit|dispatchEvent|focus)$/]`, '§3.2.5：content script 不操作頁面元素'),
  sel(`MemberExpression[object.name=${CHROME}][property.name='storage']`, '§3.2.5：content script 禁止使用 storage'),
  sel(`CallExpression[callee.property.name='addEventListener'][arguments.0.value='message']`, '§3.2.4：content script 不監聽 message 事件'),
  sel(`CallExpression[callee.property.name='postMessage']`, '§3.2.4：content script 不使用 postMessage'),
  sel(`NewExpression[callee.name='CustomEvent']`, '§3.2.4：content script 不派送自訂 DOM 事件'),
];

const syntax = (...groups) => ['error', ...groups.flat()];

// ---- no-restricted-globals ----
const NET_GLOBALS = [
  { name: 'XMLHttpRequest', message: '§3.4：對外請求只能用 apiGet' },
  { name: 'EventSource', message: '§3.4：對外請求只能用 apiGet' },
  { name: 'WebSocket', message: '§3.4：對外請求只能用 apiGet' },
];
const FETCH_GLOBAL = [{ name: 'fetch', message: '§3.4：對外請求只能用 lib/api/endpoints.ts 的 apiGet' }];
const NAV_GLOBALS = [
  { name: 'open', message: '§3.4：禁止 open()' },
  { name: 'location', message: '§3.4：禁止直接使用 location' },
  { name: 'navigation', message: '§3.4：禁止直接使用 navigation' },
];

// ---- no-restricted-properties ----
const NET_PROPS = [
  { object: 'navigator', property: 'sendBeacon', message: '§3.4：禁止 sendBeacon' },
  { object: 'window', property: 'fetch', message: '§3.4：對外請求只能用 apiGet' },
  { object: 'globalThis', property: 'fetch', message: '§3.4：對外請求只能用 apiGet' },
  { object: 'self', property: 'fetch', message: '§3.4：對外請求只能用 apiGet' },
  { object: 'document', property: 'write', message: '§3.2.1：禁止 document.write' },
  { object: 'document', property: 'writeln', message: '§3.2.1：禁止 document.writeln' },
  { object: 'Object', property: 'assign', message: '§3.2.3：禁止 Object.assign 合併外部資料' },
];
const DATE_PROPS = [{ object: 'Date', property: 'parse', message: '§5.5：日期請用 lib/dates.ts' }];

// ---- no-restricted-imports ----
const JSX_RUNTIME_PATHS = [
  { name: 'react/jsx-runtime', message: '§3.4：禁止直接呼叫 jsx()' },
  { name: 'react/jsx-dev-runtime', message: '§3.4：禁止直接呼叫 jsx()' },
];
/** §3.2.5 content script 可以 import 的模組（白名單以外一律禁止）。 */
const CONTENT_ALLOWED = 'ids|text|selectors|messages|zod-setup|api/endpoints|coupons/parse|dates|schema|badge-style';
const CONTENT_IMPORT_REGEX = `^(?!(?:(?:\\.\\.?/)+lib/|@/lib/)(?:${CONTENT_ALLOWED})$)(?!(?:\\.\\./)+content/[a-z-]+$)(?!\\./[a-z-]+$)(?!zod$)(?!wxt/utils/define-unlisted-script$)`;

const CONTENT_FILES = ['src/entrypoints/dlsite-content.ts', 'src/content/**/*.ts'];
const LINK_COMPONENTS = ['src/components/WorkLink.tsx', 'src/components/NavLink.tsx', 'src/components/ExportButton.tsx'];

export default tseslint.config(
  { ignores: ['.output/**', '.wxt/**', 'node_modules/**', 'tests/lint-fixtures/**', 'tests/e2e/.profile/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // ---- 擴充功能原始碼（src/）----
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { react, 'no-unsanitized': noUnsanitized },
    settings: { react: { version: '19.0' } },
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      // §3.2.1
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
      'react/no-danger': 'error',
      // §3.4 第 2 層
      'react/forbid-elements': [
        'error',
        {
          forbid: ['a', 'area', 'form', 'meta', 'link', 'base', 'iframe', 'object', 'embed'].map((element) => ({
            element,
            message: '§3.4：連結只能用 WorkLink／NavLink／ExportButton',
          })),
        },
      ],
      'react/forbid-dom-props': [
        'error',
        {
          forbid: ['href', 'action', 'formAction', 'httpEquiv', 'xlinkHref', 'ping'].map((propName) => ({
            propName,
            message: '§3.4：禁止這個屬性',
          })),
        },
      ],
      'react/jsx-props-no-spreading': ['error', { html: 'enforce', custom: 'ignore' }],
      'no-restricted-imports': ['error', { paths: JSX_RUNTIME_PATHS }],
      // §3.4 第 3 層、§5.5、§3.2.3、§3.2.4
      'no-restricted-syntax': syntax(NAV_SYNTAX, BRAND_SYNTAX, DATE_SYNTAX, COMMON_SYNTAX),
      'no-restricted-globals': ['error', ...FETCH_GLOBAL, ...NET_GLOBALS, ...NAV_GLOBALS],
      'no-restricted-properties': ['error', ...NET_PROPS, ...DATE_PROPS],
    },
  },
  // 可以寫 <a href> 的三個元件（§3.4 第 2 層）
  {
    files: LINK_COMPONENTS,
    rules: { 'react/forbid-elements': 'off', 'react/forbid-dom-props': 'off' },
  },
  // 唯一可以導覽的檔案
  {
    files: ['src/lib/nav.ts'],
    rules: { 'no-restricted-syntax': syntax(DATE_SYNTAX, COMMON_SYNTAX) },
  },
  // buildWorkUrl 產生品牌型別
  {
    files: ['src/lib/ids.ts'],
    rules: { 'no-restricted-syntax': syntax(NAV_SYNTAX, DATE_SYNTAX, COMMON_SYNTAX) },
  },
  // 唯一可以解析日期字串的檔案
  {
    files: ['src/lib/dates.ts'],
    rules: {
      'no-restricted-syntax': syntax(NAV_SYNTAX, BRAND_SYNTAX, COMMON_SYNTAX),
      'no-restricted-properties': ['error', ...NET_PROPS],
    },
  },
  // 唯一可以呼叫 fetch 的檔案
  {
    files: ['src/lib/api/endpoints.ts'],
    rules: { 'no-restricted-globals': ['error', ...NET_GLOBALS, ...NAV_GLOBALS] },
  },
  // content script（§3.2.5）
  {
    files: CONTENT_FILES,
    rules: {
      'no-restricted-syntax': syntax(NAV_SYNTAX, BRAND_SYNTAX, DATE_SYNTAX, COMMON_SYNTAX, CONTENT_SYNTAX),
      'no-restricted-imports': [
        'error',
        {
          paths: JSX_RUNTIME_PATHS,
          patterns: [{ regex: CONTENT_IMPORT_REGEX, message: '§3.2.5：content script 只能 import 白名單內的模組' }],
        },
      ],
    },
  },
);
