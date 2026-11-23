# DL_Assistant 安全規則

> 本文件是 [SPEC.md](../SPEC.md) 的一部分。章節編號沿用 SPEC.md，文中的「§x.y」可能在 SPEC.md 或 `docs/` 的其他檔案裡（對照見 SPEC.md 開頭）。

## 3. 非功能需求（安全部分）

### 3.2 安全

DLsite 頁面是已登入的狀態，DLWatcher 是第三方網站，優惠券說明是 DLsite 營運人員或合作網站填寫的 HTML。這些都當成**不可信的外部資料**。

#### 3.2.1 外部資料只當純文字
- 外部資料只用 `textContent` 或 React 的預設跳脫顯示。
- 禁止把任何外部字串指派給**屬於目前文件的元素**的 `innerHTML`、`outerHTML`、`insertAdjacentHTML`，**即使元素還沒插入頁面**（在 content script 裡，`<img onerror>` 會在 DLsite 頁面執行）。也禁止 `document.write`、`Range.createContextualFragment`、`dangerouslySetInnerHTML`。
- 含 HTML 的欄位（`condition_info`）只在 content script 用 `new DOMParser().parseFromString(html, 'text/html')` 解析（`DOMParser` 產生的是惰性文件，不執行腳本、不載入圖片），先移除 `script, style, template, noscript, iframe, object` 元素，再取 `doc.body.textContent`，空白正規化、截斷到 2,000 字後存成 `conditionText`。**原始 HTML 不儲存、不傳給 background。** Service worker 沒有 `DOMParser`，這一步不能搬到 background。
- `lib/text.ts` 的 `htmlToText()` 是唯一使用 `DOMParser` 的地方，回傳型別是 `string`。解析出的節點不能 `append`、`importNode`、`adoptNode` 到任何文件（節點一進入活的文件，`<img onerror>` 就會執行），只能讀 `textContent`。
- v1 不保留說明裡的 `<a href>` 連結，只顯示文字。
- Chart.js 只用內建的 canvas tooltip；要自訂 tooltip 就用 React 元件渲染，不用 `innerHTML`。
- ESLint 加上 `eslint-plugin-no-unsanitized` 與 `react/no-danger`，CI 失敗就不能合併。

#### 3.2.2 URL 一律由程式自己組
- 外部資料不准放進 `href`、`src`、`srcset`、`style`、`action`、`formaction` 和 `on*` 屬性。
- **作品編號**：統一用 `lib/ids.ts` 的 `isWorkId(s) = /^(RJ|RE|BJ|VJ)(\d{6}|\d{8})$/.test(s)`（前綴清單見 §10.3）。不用沒有錨定的 regex 掃整段字串。
- **作品頁連結**：只用 `https://www.dlsite.com/${site}/work/=/product_id/${id}.html` 組出。`site` 必須是列舉值（`maniax`、`home`、`books`、`pro`、`soft`、`girls`、`girls-pro`、`girls-drama`、`bl`、`bl-pro`、`bl-drama`、`appx`；2026-11-23 實測，§10.3），取 API 的 `site_id`，不在列舉內就用 `maniax`（實測 `maniax` 路徑也能開 `home` 的作品）；`id` 必須通過 `isWorkId()`。`comic` 會轉址到站外（`www.comipo.app`），**不列入**。
- **從網址取作品編號**（F1、F13）：先 `new URL(url)`，要求 `protocol === 'https:'` 且 `host === 'www.dlsite.com'`，再用 `^/[a-z]+(-[a-z]+)?/(work|announce)/=/product_id/([A-Z]{2}\d{6,8})(\.html)?(/|$)` 比對 `pathname`，取出的編號再過 `isWorkId()`。其他網址一律不處理。（分站名稱可能含一個連字號，例如 `girls-pro`、`bl-drama`，M1 實測；手機版 `touch` 作品頁的網址格式仍待確認，見 §10.3。）
- **圖片**：`//` 開頭的協定相對網址先補 `https:`（否則在擴充功能頁面會變成 `chrome-extension://img.dlsite.jp/...`），再用 `new URL()` 解析，要求 `origin === 'https://img.dlsite.jp'` 且 `username`、`password` 為空。不符的一律換成內建的預設圖。擴充功能頁面的圖片只能用 `components/WorkImage.tsx` 顯示：它在顯示前再跑一次 `normalizeImageUrl()`（storage 讀回的 `imageUrl` 只驗證長度），載入失敗也換成預設圖（inline SVG，不發請求），並設 `referrerPolicy="no-referrer"`。ESLint `react/forbid-elements` 在其他檔案禁止 `<img>`、`<picture>`、`<source>`、`<video>`、`<audio>`、`<image>`（v0.12）。DLWatcher 和匯入檔案裡的圖片網址一律不用。
- **開啟網頁**（分頁、視窗、連結、通知點擊）的規則見 §3.4「導覽與資源載入」。
- 擴充功能頁面的 CSP 在 MV3 預設值上再收緊（§7.1），讓瀏覽器擋住白名單以外的連線與圖片，作為 §3.4 的第二道防線。

#### 3.2.3 回應驗證
- 所有 API 回應先用 zod 驗證再使用。schema 只列出要用的欄位（未列出的欄位會被去掉）。
- **禁止使用 `z.coerce`**（`null`、`""` 會變成 0，`true` 會變成 1）。字串數字用帶範圍的工廠函式（字串分支限 9 碼，避免超長字串變成 `1e20` 或 `Infinity`）：
  `const intIn = (min: number, max: number) => z.union([z.number().int(), z.string().max(9).regex(/^\d+$/).transform(Number)]).pipe(z.number().int().min(min).max(max));`
  可為空的欄位明確寫 `.nullable()`。`null` 在轉成本機模型時變成 `undefined`（代表「沒有這個條件」），不是 0。
- 數字都加範圍：價格 `intIn(0, 1_000_000)`，折扣率 `intIn(0, 100)`，定額券面額 `intIn(1, 100_000)`，`limit_date` 見 §5.5。字串欄位有長度上限（標題 300 字）。
- `campaign_id`、`discount_end_date` 等可選的字串欄位，空字串與只有空白的字串一律轉成 `undefined`（`??` 不會跳過空字串）。
- **外部字串不能直接當一般物件的 key。** API 回應、匯入檔、storage 讀回的資料，凡是以作品編號或券的識別為 key 的，一律轉成 `Map`（或 `Object.create(null)`），避免 `"__proto__"` 之類的 key 改到原型。
  - 商品 API 的回應用 `Object.entries()` 逐筆處理，key 必須通過 `isWorkId()` **而且是這次請求的編號之一**，不符的整筆丟棄。
  - 用 `z.record()` 時，key 的 schema 必須是作品編號的 regex。
  - 禁止用 `Object.assign` 或深層合併函式把外部資料併入既有物件。
  - 測試加入 `"__proto__"`、`"constructor"`、`"prototype"` 三種 key。
- **逐筆驗證**：先驗證最外層是陣列（或物件），再對每一筆 `safeParse`。成功的保留，失敗的記下編號與原因（「哪個欄位不符」），只讓那一筆失敗。商品 API 一次 100 件，其中 1 件怪異只影響那一件；優惠券有 1 張解析失敗，popup 顯示「有 N 張券無法解析」。
- 不認得的 `condition_type`、`discount_type`：保留這張券供顯示，但標記 `plannerUsable: false`，試算不用它，畫面上說明原因。
- **回應大小上限**：DLWatcher 2 MB、DLsite 商品 API 5 MB、優惠券 API 1 MB。超過就中止讀取並當作失敗。

#### 3.2.4 訊息與事件
DLsite 頁面上有廣告與追蹤腳本。它們不能直接呼叫 `chrome.runtime`，但能產生假的點擊、改寫 DOM，讓 content script 讀到假資料。
- content script 只在 isolated world 執行。不注入 main world 腳本，不監聽 `window` 的 `message` 事件，不監聽也不派送自訂 DOM 事件，不讀取頁面的 JS 變數。
- 所有點擊處理都檢查 `event.isTrusted === true`。
- 訊息依方向與來源分三組，其他來源一律忽略。**訊息清單是完整的**：新增訊息要改規格，訊息的 zod schema 與這張表用快照測試鎖住。

| 方向 | 判斷方式 | 只能送的訊息 |
|---|---|---|
| content script → background | `sender.id === chrome.runtime.id`、`sender.origin === 'https://www.dlsite.com'`、`sender.frameId === 0`、`sender.tab !== undefined`；`sender.documentLifecycle` 有值時必須是 `'active'` | `cartClicked {id}`、`cartSnapshot {ids}`、`track {id}`、`badgeInfo {id}`（只回本機資料，不發請求；同一個 `documentId` 只回一次）、`lookup {id}`（只在點擊後送）、`openPage {page: 'dashboard' 或 'lookup', id?}`、`shouldSyncCoupons`、`couponSyncResult {token, result}` |
| 擴充功能頁面 → background | `sender.id === chrome.runtime.id`、`sender.origin === EXT_ORIGIN`、`sender.url` 以 `chrome.runtime.getURL('')` 開頭；`EXT_ORIGIN = \`chrome-extension://${chrome.runtime.id}\`` | `track {id, from: 'manual' 或 'lookup'}`（content script 送的 `track` 一律記成 `source: 'page'`，來源由 background 依 sender 決定）、`untrack {id}`、`setPaused {id, paused}`、`setTarget {id, price?}`、`lookup {id}`、`recheck {ids}`（1～100 件）、`syncCouponsNow`、`clearCoupons`、`setCouponReserved {key, reserved}`、`setSettings {partial}`、`resumeDlwatcher` |
| background → content script | content script 的 `onMessage` 只接受 `sender.id === chrome.runtime.id` 而且**沒有** `sender.tab` 的訊息 | `syncNow` |

- 匯出是讀取：擴充功能頁面直接讀 storage 組成檔案，不經過訊息。
- **訊息參數的驗證**（每種訊息都有 `.strict()` 的 zod schema）：
  - `setSettings {partial}` 只接受使用者可編輯的欄位：`checkIntervalHours`（1～24 的整數）、`dlwatcherEnabled`、`usePointPaymentMethod`、`treatUnknownDiscountedAsUsable`、`hideTitlesInNotifications`、`showBadge`、`rules`（5 個布林，也是 strict）。`dlwatcherAutoPausedAt` 只由 background 與 `resumeDlwatcher` 改，`reservedCouponKeys` 只由 `setCouponReserved` 改。改 `checkIntervalHours` 時重建 alarm。
  - `setTarget {id, price?}`：`id` 必須在追蹤清單裡，`price` 用 `intIn(0, 1_000_000)`。
  - `setCouponReserved {key, reserved}`：`key` 必須是目前 `coupons` 裡的 key，長度 ≤ 300。
  - `recheck {ids}`：`ids` 都必須在追蹤清單裡。
- **回覆的形狀**（和請求一樣用快照測試鎖住）：
  ```ts
  // content script → background 的 couponSyncResult.result
  type CouponSyncResult =
    | { status: 'ok'; coupons: CouponInput[]; total: number; invalid: { index: number; path: string; code: string }[] }
    | { status: 'notLoggedIn' }                       // opaqueredirect
    | { status: 'failed'; httpStatus?: number }       // 例外、非 200、超過 1 MB、最外層不是陣列
    | { status: 'unparsable' };                       // JSON.parse 失敗
  // CouponInput = Coupon 去掉 key 與 syncedAt；background 重新驗證，重新產生 key 與 syncedAt
  type BadgeInfoReply = { tracked: false } | { tracked: true; paused: boolean; lowest?: { price: number; start: string; end: string; source: 'dlwatcher' | 'own' } };
  type LookupReply = { ok: true; snapshot: PriceSnapshot; history: HistoryRecord | null; fetchedAt: string } | { ok: false; reason: 'rateLimited' | 'notFound' | 'failed' };
  type ShouldSyncReply = { sync: false } | { sync: true; token: string };
  // 其他寫入類訊息一律回覆 { ok: true } 或 { ok: false; reason: string }
  ```
- background 需要非同步回覆的訊息一律在監聽器裡 `return true` 並呼叫 `sendResponse()`，不依賴「回傳 Promise」（WXT 0.20 起不再預設使用 polyfill）。service worker 休眠時，訊息會喚醒它；監聽器在最上層同步註冊（§4.1），訊息不會遺失。
- content script 送訊息時處理 `chrome.runtime.lastError` 與 `undefined` 回覆。擴充功能更新後，舊分頁的 content script 會失去連線（「Extension context invalidated」），這時不顯示徽章、不報錯，最多重試一次。

- 擴充功能頁面的來源判斷**不用** `new URL(...).origin`（非特殊 scheme 依 URL 標準會得到 `"null"`，在測試環境就是如此），也不能用「有沒有 `sender.tab`」分辨（儀表板與 `lookup.html` 開在分頁裡，也會帶 `tab`）。判斷函式寫在 `lib/messages.ts`，單元測試用固定的假 `runtime.id`，`origin` 為 `"null"`、`https://www.dlsite.com.evil.example`、`http://www.dlsite.com`、`frameId: 1` 的訊息全部要被拒絕。
- 擴充功能頁面**讀取**資料時直接讀 `chrome.storage.local` 與 IndexedDB，不經過訊息；**寫入**一律送訊息給 background（§4.2）。
- 每種訊息都用 zod 驗證，作品編號都要通過 `isWorkId()`。來自 content script 的優惠券資料，background 要再跑一次完整的 zod 驗證，並檢查同步 token（§5.4）。
- background 不提供「幫我抓這個網址」之類的通用訊息。content script 只送作品編號，網址由 background 自己組。`openPage` 只能開擴充功能自己的儀表板或 `lookup.html`。
- `cartSnapshot` 只接受 `sender.url` 的路徑是購物車頁（`/<分站>/cart` 或 `/<分站>/cart/`，各分站共用同一個購物車；M2 實測，寫在 `selectors.ts`）的訊息，同一個 `sender.documentId` 只接受一次（沒有 `documentId` 也拒絕）。`sender.url` 是文件載入時的網址，頁面 `history.pushState` 之後不會改變（M2 實測），所以頁面腳本無法把作品頁偽裝成購物車頁。
- 「同一個 `documentId` 只接受一次」的紀錄存在 `storage.session` 的 `seenDocuments`（`{ badge, cart, track }` 各是 `[documentId, at][]`，各保留最近 500 筆，超過 1 小時的刪除），service worker 重啟後仍然有效。
- **數量與頻率上限**（計數存在 `storage.session` 的 `rateCounters`）：
  - 一次 `cartSnapshot` 最多 200 個編號，其中最多新增 50 件到追蹤清單。
  - content script 的 `cartClicked`、`cartSnapshot`、`track` 合計每天最多自動新增 200 件（計數在 `storage.local` 的 `dailyAutoAdd`），超過就忽略，popup 顯示「有 N 件作品沒有自動加入，請到購物車頁確認」。content script 的 `track` 另外限同一個 `documentId` 一次。
  - 追蹤清單總數上限 1,000 件。
  - `lookup`：content script 每分鐘最多 10 次；擴充功能頁面每分鐘最多 30 次（試算頁手動輸入 15 件未追蹤作品時需要）。
  - `openPage` 每分鐘最多 5 次；`badgeInfo` 每個分頁每分鐘最多 30 次。
  - `syncCouponsNow`：距離上次「立即同步」不到 1 分鐘，或 `pendingManual` 還沒過期時，直接回覆「同步進行中」。
  - `recheck`：同一件作品 10 分鐘內只重新查價一次；放進 §4.1 的 `productInfo` 佇列執行（照樣套用間隔與退避），不另開請求。
  - 超過上限的訊息回覆 `{ ok: false, reason: 'rateLimited' }`，不報錯（追蹤清單滿 1,000 件時是 `'limit'`）。`cartSnapshot` 只要有任何一件加入或已在清單裡就回 `ok`。
- 程式裡不註冊 `(chrome|browser).runtime.onMessageExternal`／`onConnectExternal`（ESLint 全面禁止；manifest 也鎖住，見 §7.1）。

#### 3.2.5 content script 範圍與注入的 UI
- content script 的 `matches` 為 `https://www.dlsite.com/*`，`exclude_matches` 排除結帳、付款、帳號設定相關路徑：`https://www.dlsite.com/*/pay*`（立即購買與付款）、`*/mypage*`（マイページ，含帳號設定與優惠券）、`*/login*`、`*/regist*`（M2 實測，§10.3；值在 `scripts/manifest-policy.ts`，`check-manifest` 確認完全一致）。路徑結尾不要求斜線：v0.10 的 `*/mypage/*` 擋不到 `/home/mypage`（M2 審查重現）；代價是名稱相近的頁面（例如 `/home/guide/payment`）也被排除，只是少了 content script。購物車頁要讀作品清單（F2），不排除；結帳由購物車頁的表單 POST 到 `/<分站>/cart` 進入付款流程。`all_frames: false`。

**content script 只放最少的程式碼。** content script 是唯一帶登入 cookie 的環境，它的請求以 DLsite 頁面的來源送出，**不受擴充功能 CSP 的 `connect-src` 約束**。打包進 content script 的任何相依套件，只要有一個被植入惡意版本，就能以登入狀態呼叫 `/home/mypage/coupon` 等帳號端點。所以：
- content script 的進入點是 `src/entrypoints/dlsite-content.ts`，用 WXT 的 `defineUnlistedScript` 打包，`content_scripts` 由 `wxt.config.ts` 自己寫進 manifest。**不用** WXT 的 `defineContentScript`：它的 `ContentScriptContext` 會對頁面 `document` 派送 `CustomEvent`、呼叫 `window.postMessage(..., '*')`（事件名稱含擴充功能 ID），並監聽頁面上的同名事件。頁面腳本因此能得知擴充功能 ID，也能派送假事件讓 content script 自我停用（M1 從打包結果確認）。`check-manifest` 確認 content script 打包檔不含 `postMessage`、`CustomEvent`、`dispatchEvent`、`addEventListener('message')`。
- `dlsite-content.ts` 不使用 React、Tailwind、Chart.js。徽章與按鈕用原生 DOM（`createElement`＋`textContent`）建立。
- 注入的 UI 由 content script 自己 `attachShadow({ mode: 'closed' })`，不依賴 WXT 的 `createShadowRootUi`。樣式寫成一段字串放進 shadow root 的 `<style>`（不含 `url()`、`@import`），不 import CSS 檔，所以不需要 `web_accessible_resources`，content script 裡也沒有載入 CSS 的網路請求（WXT 的 `createShadowRootUi` 會透過網路載入 CSS）。
- content script 可以 import 的模組用 ESLint `no-restricted-imports` 列白名單：`lib/ids.ts`、`lib/text.ts`、`lib/selectors.ts`、`lib/messages.ts`、`lib/zod-setup.ts`、`lib/api/endpoints.ts`（content script 只用 `couponList`，其他端點有呼叫環境檢查）、`lib/coupons/parse.ts`、`lib/dates.ts`、`lib/schema.ts`（`intIn` 等 zod 工具，`coupons/parse.ts` 也要用）、`lib/badge-style.ts`（注入徽章的樣式字串）、`src/content/` 底下的 UI 檔案、zod、`wxt/utils/define-unlisted-script`。新增項目要改規格。（v0.8 加入 `schema.ts`、`badge-style.ts`：v0.7 的清單漏了它們。）（v0.10 曾加入 `wxt/browser`，v0.11 移除，理由見下一條。）
- **DOM clobbering**：頁面的具名元素會變成 isolated world 的全域。`<form id="browser"><input name="runtime">` 讓 `globalThis.browser` 變成那個表單（`wxt/browser` 會選錯物件），`<form id="chrome">` 連 `chrome` 都能蓋掉（M2 審查後實測，Chrome 157），content script 的訊息全部失效，等於頁面能讓 content script 停用。所以 content script 的 `run_at` 是 `document_start`：頁面還沒有任何元素時先取出 `chrome.runtime.sendMessage` 保存起來，DOM 相關的工作等 `DOMContentLoaded`。content script 不 import `wxt/browser`、不用 `browser` 全域（ESLint `no-restricted-globals`）；`check-manifest` 確認 `run_at` 並確認打包檔不含 `globalThis.browser`。`verify:m2` 的每一頁都放這兩種陷阱。
- 白名單裡的「`src/content/` 底下的 UI 檔案」：`src/content/` 裡的檔案可以用 `./xxx` 互相 import；入口檔 `dlsite-content.ts` 在 `src/entrypoints/`，`./xxx` 會指到 `background` 等其他入口，所以只能用 `../content/xxx`。（v0.9：M1 審查發現入口檔寫 `import './background'` 不會被擋。）
- content script 禁止使用 `chrome.storage`、`browser.storage` 與 `wxt/storage`（ESLint；`storage.local` 也已鎖住，§4.2），需要的資料一律由 background 回覆。v0.11 起 content script 裡任何物件的 `.storage`、字串 `'storage'`、`.chrome`、`Reflect`、`new Audio`／`Image`／`FontFace`／`Worker`／`Request`／`DOMParser` 等會載入資源的建構式、`createContextualFragment`、`insertAdjacentHTML`、動態 `import()` 都由 ESLint 禁止（M2 審查發現 `chrome!.storage`、`(chrome as S).storage`、`Reflect.get(chrome, 'stor' + 'age')`、`new Audio(url)` 都能繞過名稱比對；`storage.sync` 沒有被 `setAccessLevel` 鎖住）。
- 建置時由 `scripts/content-modules-plugin.ts`（Vite plugin）在 `generateBundle` 讀取 content script chunk 的 `modules` 清單，輸出 `.output/content-modules.json`（不放進擴充功能，也不需要 source map；M2 實測可行）。`scripts/check-manifest.ts` 讀它列出 content script 包含的套件，和 `scripts/content-modules.baseline.json` 比對：套件只能是 `wxt`、`zod`，專案內的檔案只能是入口檔、`src/content/` 與上面白名單裡的 lib 檔案（v0.11：間接 import 進來的 lib 檔案 lint 看不到，所以也比對）。出現清單外的就失敗，要人工確認後才加進清單。清單記下 content script 打包檔的 SHA-256（在 `writeBundle` 讀實際寫出的檔案；WXT 在 `generateBundle` 之後還會改寫），和這一次的打包檔不符就失敗，避免本機殘留的舊清單讓檢查誤判通過。也確認打包檔不含 `react`、`storage.local`。
- **content script 的 DOM 寫法另有 ESLint 規則**（只套用在 `dlsite-content.ts` 與 `src/content/` 底下的 UI 檔案）。原生 DOM 沒有 React 的保護，以下寫法都會以登入狀態對 DLsite 發 GET，而 §7.1 的 CSP 管不到 content script：
  - `document.createElement` 只能用 `div`、`span`、`button`、`style`；`createElementNS` 只能用 SVG 的 `svg`、`path`、`circle`、`rect`、`g`（不能用 `use`、`image`、`feImage`）。
  - 禁止 `setAttribute` 的第一個參數（`setAttributeNS` 的第二個參數）不是字面值，或是 `src`、`href`、`srcset`、`poster`、`data`、`action`、`formaction`、`ping`、`xlink:href`、`style` 或 `on` 開頭；禁止 `setAttributeNode`、`createAttribute`；禁止對 `src`、`href`、`srcset`、`action`、`style`、`cssText`、`innerHTML`、`outerHTML`、`adoptedStyleSheets` 屬性指派；禁止對 `element.style.*` 指派、`style.setProperty`、`insertRule`、`new CSSStyleSheet()`；字串與樣板字串不能含 `url(`、`@import`、`image-set(`（樣式一律放 `badge-style.ts`）。清空元素用 `replaceChildren()`。
  - 禁止設定 `on*` 事件處理屬性（`window.onmessage = …`、`el.onclick = …`），監聽一律用 `addEventListener`；禁止用字串或樣板字串當屬性名稱取用（`obj['x']`），因為靠名稱比對的規則看不到。
  - `check-manifest` 另外確認 content script 打包檔不含 `url(`、`@import`、`image-set(`、`setAttributeNode`、`createAttribute`、`insertRule`、`CSSStyleSheet`、`adoptedStyleSheets`、`.onmessage =` 等。（v0.9：M1 審查發現 `el.style.backgroundImage = 'url(…)'`、`setAttributeNS(null, 'style', …)`、`styleEl.textContent = '…url(…)'` 都能繞過 v0.8 的規則。）
  - 禁止呼叫 `.click()`、`.submit()`、`.requestSubmit()`、`.dispatchEvent()`、`.focus()`。content script 不操作 DLsite 頁面既有的元素，只讀選擇器取到的元素的 `textContent` 與 `href` 字串。
  - 注入的樣式字串定義在 `lib/badge-style.ts` 的單一常數，`check-manifest` 確認這段字串不含 `url(`、`@import`、`image-set(`。
  - `tests/lint-fixtures/content/` 放上面每一種寫法的範例檔。

**注入的 UI**
- 宿主元素一律由 content script 自己 `document.createElement('div')` 建立，插在價格區塊的後面；不對 DLsite 既有的元素呼叫 `attachShadow`（`attachShadow` 只能用在 `div`、`span` 等特定元素，元素已有 shadow root 時會丟例外）。宿主元素不加任何 id 或 class（減少被頁面樣式與腳本選中的機會）。
- **頁面 DOM 裡只放公開資訊**：史低、價格走勢、「追蹤中」狀態。優惠券、試算結果、追蹤清單的其他作品，只在擴充功能自己的頁面（popup、儀表板、試算頁、`lookup.html`）顯示。
- 擴充功能頁面不用 iframe 嵌進 DLsite 頁面。
- **注入的 UI 裡不放任何網址**：沒有 `<img src>`、`<link>`、CSS `url()`，也沒有 `<a href>`。這些元素在 DLsite 頁面裡載入時是同站請求、會帶 cookie，而且 §7.1 的 CSP 管不到它們。圖示用 inline SVG。
- 注入的按鈕放在徽章容器內，不浮動、不覆蓋 DLsite 原本的元素。徽章被點擊（`isTrusted`）時，content script 送 `openPage`，由 background 開啟擴充功能自己的頁面看完整資料。擴充功能的 HTML 頁面一律不放進 `web_accessible_resources`（放進去的話任何 DLsite 頁面都能用 iframe 嵌入）。
- 使用說明寫「以擴充功能頁面為準」（頁面腳本可以畫一個假徽章，擴充功能擋不住）。
- **作品編號在文件載入時決定一次**（取 `document.URL`），之後不跟著 `history.pushState` 或 location 變化改變。頁面腳本可以用 `pushState` 逐一換網址，從徽章外觀測出你追蹤了哪些作品。
- 徽章不論是否追蹤都用相同的外框大小，「追蹤中」的資訊放在固定大小的容器裡。等 `badgeInfo` 回覆時（service worker 冷啟動可能要數百毫秒）先顯示空的固定大小外框。
- 從作品頁按「加入追蹤」的作品，`source: 'page'`、`autoAdded: true`，追蹤清單顯示「從作品頁加入」並可一鍵移除（頁面可以把徽章移到你下一次點擊的位置，讓你誤按）。
- 設定頁提供「不在作品頁顯示徽章」（`Settings.showBadge`）。

#### 3.2.6 頁面文字解析
- 只用 `selectors.ts` 裡的選擇器讀取特定元素，不讀 `document.body.innerText`／`outerHTML`，不把整段頁面文字送給 background（頁面上有帳號 email 等個人資料）。
- 價格一律來自商品 API，v1 不解析頁面上的價格文字。
- 取到元素文字後先截斷到 200 字，再用沒有巢狀量詞的 regex 解析。目前規格用到的 regex 只有作品編號與網址（§3.2.2）和日期（§5.5）；實作時新增的 regex 一律寫進 `selectors.ts` 旁邊，數字結果再套 `intIn()` 的範圍檢查。
- 單元測試直接對 **regex 函式本身**（不經截斷）餵 10 萬字的惡意字串，必須在 50 ms 內完成；截斷只是第二道防線。

### 3.4 對外請求與帳號操作的邊界
**原則**：DLsite 有些 GET 網址也會改變帳號狀態，例如 `/home/mypage/coupon`（領券）。真正的風險是**帶 cookie 的請求**，所以除了只發 GET，還要限制哪些請求可以帶 cookie、從哪裡發。

- 所有對外請求只能透過 `lib/api/endpoints.ts` 匯出的 `apiGet(key, params)`。其他檔案禁止直接用 `fetch`、`XMLHttpRequest`、`navigator.sendBeacon`、`EventSource`、`WebSocket`，ESLint 以 `no-restricted-globals`／`no-restricted-properties` 強制，只有 `endpoints.ts` 例外。
- `apiGet` 不接受外部傳入的 URL 或路徑，只接受端點代號與驗證過的參數（作品編號要先通過 `isWorkId()`）。組出 URL 後用 `new URL()` 解析，由內部的 `assertAllowed()` 檢查 `origin` 與 `pathname` **完全相等**（不用 `startsWith`、`includes`），查詢參數也只能是該端點允許的那幾個。不符就丟例外。
- 每個端點的設定固定如下：

| 代號 | 網址 | `credentials` | `redirect` | 可呼叫的地方 |
|---|---|---|---|---|
| `productInfo` | `https://www.dlsite.com/maniax/product/info/ajax`（參數只有 `product_id`、`cdn_cache_min`） | `omit` | `error` | **只有** background |
| `couponList` | `https://www.dlsite.com/home/mypage/coupon/list/ajax`（沒有參數） | `same-origin` | `manual` | **只有** content script |
| `dlwatcher` | `https://dlwatcher.com/product/{id}.json` | `omit` | `error` | **只有** background |

  - `dlwatcher` 的路徑用 `^/product/(RJ|RE|BJ|VJ)(\d{6}|\d{8})\.json$` 整段比對。
  - `productInfo`、`dlwatcher` 加上 `referrerPolicy: 'no-referrer'`；`couponList` 維持瀏覽器預設，和頁面自己發的請求一致。
  - `couponList`、`dlwatcher` 加上 `cache: 'no-store'`（DLWatcher 的 24 小時快取由我們自己管）。
  - `couponList` 加上 `mode: 'same-origin'`：萬一 content script 跑在別的來源（例如 `matches` 寫錯），請求會直接失敗，不會變成跨來源請求。從擴充功能頁面或 background 呼叫時來源是 `chrome-extension://`，`same-origin` 也不會帶 DLsite 的 cookie。
  - `productInfo`、`dlwatcher` 的 `credentials: 'omit'` 是必要的：有 host permission 的擴充功能請求，可能被當成同站而帶上 DLsite 的登入 cookie。
- `assertAllowed()` 也檢查**參數值**：`product_id` 以 `,` 分開後 1～100 個、每個都通過 `isWorkId()`、沒有重複；`cdn_cache_min === '1'`；每個參數名稱只出現一次；`username`、`password`、`hash` 都是空字串。
- `apiGet` 檢查**呼叫環境**：`couponList` 要求 `globalThis.location?.origin === 'https://www.dlsite.com'`；`productInfo`、`dlwatcher` 要求在 service worker 裡執行（`typeof ServiceWorkerGlobalScope !== 'undefined' && globalThis instanceof ServiceWorkerGlobalScope`，而且 `location.protocol === 'chrome-extension:'`）。不符就丟例外。環境判斷寫成可注入的 `getRuntimeEnv()`，Vitest 測試時替換它（要在 Vitest 裡讓 `instanceof ServiceWorkerGlobalScope` 成立很麻煩）。
- 擴充功能頁面需要查價時送訊息（`lookup`、`recheck`），由 background 套用頻率限制與快取後回覆（§3.1）。
- `product_id` 的逗號被 `URLSearchParams` 編碼成 `%2C`：2026-11-23 實測 DLsite 接受，結果和未編碼相同。
- **只有 `couponList` 會帶 cookie。** 其他 DLsite 路徑（購物車、結帳、領券、帳號設定）一律不發請求。F2 購物車同步只讀你自己打開的購物車頁面 DOM。
- 單元測試測**行為**：對 `/home/mypage/coupon`、`/home/mypage/coupon?x=1`、`/home/mypage/coupon/`、`/home/mypage/coupon/list`、`/home/cart`、`/home/buy`、`https://login.dlsite.com/` 呼叫 `assertAllowed()`，每一個都要丟例外；`product_id` 含非法編號、重複參數、帶 `#hash` 的網址也要丟例外。白名單的筆數用快照測試鎖住，新增端點必須同時改測試。

**導覽與資源載入也算帶 cookie 的 GET。** 開分頁、點連結、載入圖片都會以登入狀態對 DLsite 發 GET，不經過 `apiGet`，擴充功能頁面的 CSP 也管不到導覽。
- 擴充功能開啟 DLsite 網址（開分頁、開視窗、連結、通知點擊）只能用兩種來源：`lib/ids.ts` 的 `buildWorkUrl(site, id)`，以及 `lib/nav.ts` 裡固定的常數。常數目前只有購物車頁 `https://www.dlsite.com/home/cart/`（M2 確認；打開購物車頁只是瀏覽，加入／移除購物車是別的路徑）。
- **不提供優惠券管理頁的連結**：它和領券端點只差 `/list`，而導覽一定會跟隨轉址。需要引導你看券時，畫面用文字說明「DLsite → マイページ → クーポン管理」。日後真的要加，先在 §10.3 確認這個頁面在未登入與登入時都不會轉址到 `/home/mypage/coupon`。
- 這條規則用四層防線**降低機率**。四層都只檢查我們自己的原始碼，以及打包結果裡完整出現的字串；CSP 管不到導覽，所以**相依套件被植入惡意版本時仍能導覽到任何網址**（列在 §11 風險表）：
  1. **型別**：`lib/nav.ts` 匯出品牌型別 `type DlsiteNavUrl = string & { readonly __brand: 'DlsiteNavUrl' }`，只有 `buildWorkUrl()` 與 `nav.ts` 的常數能產生這個型別。`nav.ts` 的 `openTab(url: DlsiteNavUrl | ExtPageUrl)` 與 `openPopupWindow(...)` 是開分頁與視窗的唯一函式（`ExtPageUrl` 只能由 `chrome.runtime.getURL()` 組出的擴充功能頁面網址產生）。
  2. **元件**：擴充功能頁面一律用 `components/WorkLink.tsx`（參數是 `site`、`id`）與 `components/NavLink.tsx`（參數是 `nav.ts` 的常數名稱）產生連結，匯出下載用 `components/ExportButton.tsx`（§3.7）。只有這三個元件檔案例外：
     - `react/forbid-elements` 禁止 `<a>`、`<area>`、`<form>`、`<meta>`、`<link>`、`<base>`、`<iframe>`、`<object>`、`<embed>`（`<meta http-equiv="refresh">` 以程式插入時也會導覽，CSP 擋不住）。三個連結元件可以寫 `<a>`，但不能寫 `<img>`；`WorkImage` 可以寫 `<img>`，但不能寫連結（§3.2.2）。
     - `react/forbid-dom-props` 禁止 `href`、`action`、`formAction`、`httpEquiv`、`xlinkHref`、`ping`。
     - `react/jsx-props-no-spreading`（`html: 'enforce'`、`custom: 'ignore'`）禁止在 DOM 元素上展開 props（`forbid-dom-props` 看不到 `{...props}`）。
     - `no-restricted-imports` 禁止 import `react/jsx-runtime`、`react/jsx-dev-runtime`（直接呼叫 `jsx('a', { href })` 不會被 `forbid-elements` 認出）。
  3. **語法規則**（`no-restricted-syntax`，只有 `nav.ts` 例外）：
     - 禁止 `(chrome|browser).tabs.(create|update|duplicate)`、`(chrome|browser).windows.(create|update)`、`window.open`、`navigation.navigate`、`clients.openWindow`。
     - 禁止對 `location`、`location.href`、`document.location`、`top.location`、`self.location`、`globalThis.location` 指派，以及呼叫它們的 `assign`／`replace`。
     - `no-restricted-globals` 禁止裸的 `open`、`location`、`navigation`。
     - 禁止把 `chrome.tabs`、`chrome.windows`、`browser.tabs`、`browser.windows` 指派給變數或解構（`const { tabs } = browser` 這類別名）。
     - 上面的規則靠名稱比對，所以**全部檔案**（含 `nav.ts`）都禁止：改名 import `browser`（`import { browser as b }`）、`import * as w from 'wxt/browser'`、把 `chrome`／`browser` 指派給變數或解構、用 `[...]` 取 `chrome`／`browser` 底下三層內的屬性（`chrome['tabs']`、`chrome.tabs['create']`）、`window['open']` 這類 `window`／`globalThis`／`self` 的 `[...]` 取用、`globalThis.chrome`。（v0.9：M1 審查發現這些寫法都能繞過。）
     - 禁止 `as DlsiteNavUrl`／`as ExtPageUrl` 這類型別斷言（`TSAsExpression`、`TSTypeAssertion`），品牌型別擋不住斷言。斷言的型別裡任何位置出現品牌型別都算（`as N.DlsiteNavUrl`、`as import('./nav').DlsiteNavUrl`、聯集）；品牌型別也不能改名 import 或另取型別別名。
     - `z.coerce` 的禁止涵蓋任何物件的 `.coerce`、`import { coerce }` 與字串 `'coerce'`；`onMessageExternal`／`onConnectExternal` 也禁止以字串出現。
     - 禁止 `document.createElement('a'|'form'|'area'|'meta'|'link'|'base'|'iframe')`。
     - `chrome.` 和 WXT 慣用的 `browser.` 都要涵蓋。
  4. **打包掃描**：`scripts/check-manifest.ts` 對 `.output/chrome-mv3/**/*.js` 檢查 `/mypage\/coupon(?!\/list\/ajax)/`、`/home/buy`，以及加入購物車的實際路徑：列表頁的 GET 連結 `/<分站>/cart/=/product_id/<ID>.html` 與作品頁按鈕的 `POST /api/cart/<分站>/add`（M2 實測；購物車頁的移除連結 `/<分站>/cart/ajax/=/mode/cart_remove/…` 也是 GET），掃描 `/cart/=/product_id`、`/api/cart/`，出現就失敗（`selectors.ts` 的 regex 寫成跳脫的斜線，不會被掃到）。字串拼接或編碼過的網址掃不到，這一層只是最後的保險。
- **規則自我測試**：`tests/lint-fixtures/` 對每一種違規寫法各放一個範例檔，並在檔名或檔頭註明**應該擋下它的規則**，CI 確認 ESLint 對每個檔案都以那條規則報錯（避免規則寫錯而永遠不觸發，也避免「沒有任何規則會擋」的範例讓 CI 一直失敗）。至少包含：

  | 範例 | 擋下的規則 |
  |---|---|
  | `<a href="…">`、`<form action>`、`<meta httpEquiv="refresh">`、`<link>` | `react/forbid-elements` |
  | `<div {...props}>`、`<button {...props}>` | `react/jsx-props-no-spreading` |
  | `<button formAction="…">` | `react/forbid-dom-props` |
  | `import { jsx } from 'react/jsx-runtime'` | `no-restricted-imports` |
  | `React.createElement('a', …)` | `react/forbid-elements` |
  | `WorkImage` 以外的 `<img src>` | `react/forbid-elements` |
  | `browser.tabs.create(…)`、`chrome.tabs.update(…)`、`navigation.navigate(…)`、`location.href = …`、`open(…)` | `no-restricted-syntax`／`no-restricted-globals` |
  | `const { tabs } = browser` | `no-restricted-syntax` |
  | `'https://…' as DlsiteNavUrl` | `no-restricted-syntax` |
  | `import { browser as b }`、`chrome['tabs'].create(…)`、`window['open'](…)`、`as N.DlsiteNavUrl`、`type U = DlsiteNavUrl`、`import { coerce } from 'zod'` | `no-restricted-syntax` |
  | content script 的 `img.src = …`、`el.setAttribute('href', …)`、`el.click()`、`document.createElement('img')`、`chrome.storage.local.get(…)` | `no-restricted-syntax`（content script 專用設定，§3.2.5） |
  | content script 的 `el.style.x = …`、`setAttributeNS(null, 'style', …)`、`setAttributeNode`、含 `url(` 的字串、`new CSSStyleSheet()`、`window.onmessage = …`、`const c = chrome`、`chrome['storage']` | `no-restricted-syntax` |
  | `dlsite-content.ts` 的 `import './background'` | `no-restricted-imports` |
- 單元測試：`buildWorkUrl` 對所有分站列舉值、`nav.ts` 的每個常數，都不能產生 `/home/mypage/coupon`、加入購物車的路徑、`/buy` 或任何帳號設定路徑。
- 注入 DLsite 頁面的 UI 不放任何網址（§3.2.5）。
- 擴充功能不提供「一鍵加入購物車」「前往結帳」「套用優惠券」這類按鈕。

> ⚠️ **不要呼叫 `GET /home/mypage/coupon`**（少了 `/list/ajax`）。這是**領券**端點，實測打開會嘗試發券。

## 7. 技術棧（安全相關）

### 7.1 Manifest
```json
{
  "minimum_chrome_version": "120",
  "permissions": ["storage", "alarms", "notifications", "unlimitedStorage", "contextMenus"],
  "host_permissions": ["https://www.dlsite.com/*", "https://dlwatcher.com/*"],
  "content_security_policy": {
    "extension_pages": "default-src 'self'; script-src 'self'; object-src 'none'; img-src 'self' https://img.dlsite.jp data:; connect-src 'self' https://www.dlsite.com/maniax/product/info/ajax https://dlwatcher.com/product/; style-src 'self'; font-src 'self'; frame-src 'none'; form-action 'none'; base-uri 'none'"
  },
  "externally_connectable": { "ids": [], "matches": [] }
}
```
- `minimum_chrome_version: "120"`：規格依賴 `MessageSender.documentId`／`documentLifecycle`（Chrome 106）、`storage.session` 10 MB（Chrome 112）、`alarms` 最短 30 秒（Chrome 120）。舊版 Chrome 上，§3.2.4 的 `documentLifecycle` 檢查會靜默跳過、`drain` alarm 會被拉長。
- CSP 說明：
  - `default-src 'self'` 讓沒有列出的資源類型（字型、媒體、`@import` 的 CSS 等）都只能來自擴充功能本身；`form-action 'none'` 讓擴充功能頁面的 `<form>` 無法送到任何網址；`frame-src 'none'`、`base-uri 'none'` 一併鎖住。
  - `connect-src` 寫到**路徑**：擴充功能環境只能連到商品 API 那一個路徑與 DLWatcher 的 `/product/`，瀏覽器直接擋住 `/home/mypage/coupon` 等其他 DLsite 路徑。兩個端點的 `redirect` 都是 `error`，不受「轉址後忽略路徑」的規則影響。
  - `object-src 'none'` 比 MV3 最低要求的 `'self'` 更嚴格；`style-src 'self'` 不擋 React 透過 CSSOM 設定的 `style` 屬性。
  - 這條 CSP **不約束 content script**（§3.2.5）。
- `host_permissions` 只開這兩個網域。Chrome 對 `host_permissions` 的路徑部分不一定生效，所以帳號頁面的保護靠 §3.4 的 `apiGet` 與導覽規則，不靠權限。
- `unlimitedStorage`：`priceLog` 與 `history` 會長期累積在 IndexedDB（1,000 件 × 多年的紀錄），沒有這個權限時可能被瀏覽器清掉。
- CSP 依 Chrome 文件也適用於 service worker，所以 `connect-src` 同時擋住 background 對白名單以外的連線。MV3 的最低要求是 `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`，這裡不含 `'wasm-unsafe-eval'`，比最低要求更嚴格。
- `web_accessible_resources`：**不宣告**。徽章圖示用 inline SVG，樣式是 content script 自己放進 shadow root 的 `<style>` 文字（§3.2.5），擴充功能的 HTML 頁面一律不列。`check-manifest` 檢查輸出的 manifest 沒有這個欄位（任何網站都能用這些檔案偵測使用者是否安裝本擴充功能）。
- `externally_connectable` 的 `ids`、`matches` 留空，依 Chrome 文件代表沒有任何擴充功能或網頁能連線。
- 右鍵選單：`chrome.contextMenus.create` 設定 `contexts: ['link']`、`documentUrlPatterns: ['https://www.dlsite.com/*']`、`targetUrlPatterns: ['https://www.dlsite.com/*/work/=/product_id/*']`。只查史低，不自動加入追蹤，也絕不 fetch `linkUrl` 本身。
- F13 的小視窗由 `lib/nav.ts` 用 `chrome.windows.create({ type: 'popup', url: 'lookup.html?id=…', width: 420, height: 520 })` 開啟，作品編號依 §3.2.2 驗證後才放進查詢參數；`lookup.html` 讀取參數時再驗證一次，並要求 `searchParams.getAll('id').length === 1`。
- 這整條 CSP 被 Chrome 157 接受並生效：`<form>` 送出、外部 CSS、`img.dlsite.jp` 以外的圖片、對 `/home/mypage/coupon` 的 fetch 都被擋，service worker 對白名單外路徑的 fetch 也被擋（M1，`tests/e2e/verify-m1.ts`）。
- **開發模式**（`wxt` 開發伺服器）：上面的 CSP 會擋住 HMR 的 WebSocket（`connect-src`）與 Vite 注入的 `<style>`（`style-src`），M1 實測。所以只有 `command === 'serve'` 時改用 `scripts/manifest-policy.ts` 的 `DEV_MANIFEST_CSP`（`connect-src` 加 `http://localhost:3000 ws://localhost:3000`、`style-src` 加 `'unsafe-inline'`）。`check-manifest` 確認正式建置沒有 `'unsafe-inline'` 與 `localhost`。
- Chrome 137 起正式版不支援 `--load-extension`，所以關閉 WXT 自動開瀏覽器的功能（`webExt.disabled`）；開發時到 `chrome://extensions` 手動載入 `.output/chrome-mv3-dev`。
- manifest 的固定值（權限、CSP、content script）集中在 `scripts/manifest-policy.ts`，`wxt.config.ts` 與 `check-manifest` 共用同一份。

### 7.2 建置與供應鏈
- zod：使用 zod 4。zod 4 原始碼的 `$ZodConfig` 有 `jitless` 選項，`allowsEval` 是第一次需要時才計算並快取，所以只要在**第一次 parse 之前**呼叫 `z.config({ jitless: true })` 就有效。`lib/zod-setup.ts` 只做這件事，每個進入點（background、content script、各個擴充功能頁面、worker）的第一個 import 就是它。M1 在擴充功能頁面監聽 `securitypolicyviolation` 事件、background 看 console，跑一次完整的解析測試，確認沒有任何 CSP 違規。
- 發佈前檢查 `.output/chrome-mv3/manifest.json`：沒有 `localhost`、沒有 `unsafe-eval`、`content_security_policy` 與 §7.1 一致、`minimum_chrome_version` 存在、沒有 `web_accessible_resources`。這一步寫成 `scripts/check-manifest.ts` 放在 CI（WXT 開發模式會放寬 CSP，不能把 dev build 拿去發佈）。
- 同一支腳本也掃描 `.output/chrome-mv3/**/*.js`：
  - 不能出現 `Function(...)`（有沒有 `new` 都算）、`eval(`。唯一例外是 zod 偵測 eval 能否使用的空字串探測 `Function("")`（不執行程式碼，jitless 下也不會被呼叫）。`[].constructor.constructor` 這類間接取得掃不到，靠 CSP（沒有 `unsafe-eval`）擋。
  - 字串裡出現的 `https://` 網域只能是 `www.dlsite.com`、`img.dlsite.jp`、`dlwatcher.com`（套件內建的說明網址另列白名單）。
  - 不能出現 `/mypage\/coupon(?!\/list\/ajax)/`、`/home/buy` 與加入購物車的路徑（§3.4 第 4 層）。
  - content script 打包檔的套件清單與上一版比對（§3.2.5）。
- `package.json` 用 `packageManager` 固定 pnpm 版本：**`pnpm@12.21.0`**（M1 決定）。以下設定在 12.21 都實際生效：`trustPolicy` 在 M1 就擋下了 puppeteer 的相依套件 `chromium-bidi` 的信任降級，所以實機驗證改用 Node 內建功能走 CDP，不裝 puppeteer、也不加 `trustPolicyExclude`。本機沒有全域 pnpm 時用 `corepack pnpm …`；`pnpm ci` 是 pnpm 內建指令（乾淨安裝），不能當 script 名稱，整套檢查用 `pnpm check:all`。`pnpm-lock.yaml` 進版控；CI 用 `pnpm install --frozen-lockfile`；每次升級套件跑 `pnpm audit`。
- `pnpm-workspace.yaml` 明確寫出：
  - `minimumReleaseAge: 1440`（發佈未滿 1 天的版本不安裝，降低剛被植入的惡意版本被升級進來的機會；pnpm 11 預設就是 1440，明確寫出避免日後預設改變）。
  - `trustPolicy: no-downgrade`（套件的信任等級下降時安裝失敗，例如原本有 provenance、新版沒有；預設是 `off`，所以一定要明確寫）。某個套件因此安裝失敗時，用 `trustPolicyExclude` 列出，並在 PR 說明原因。
  - `strictDepBuilds: true`，需要 build script 的套件寫進 `allowBuilds`（pnpm 11 以此取代 `onlyBuiltDependencies`）。
  - 若最後固定在 pnpm 10，改用 `onlyBuiltDependencies`，並確認 `minimumReleaseAge`、`trustPolicy` 的最低支援版本（§10.3）。
- GitHub Actions 的 action 一律用 commit SHA 固定版本。
- 不使用任何從 CDN 或遠端載入程式碼的功能（包含 WXT 的遠端模組匯入）。
- 第二階段的 GitHub Actions 若要推播到 Discord／Telegram，webhook 網址存在 repo secrets，不寫進程式碼。
