# DL_Assistant 專案規格書

> 版本：v0.6（草案）　日期：2026-11-23
> 一句話說明：Chrome 擴充功能。把 DLsite 加入購物車的作品自動列入追蹤，定時查價、顯示史低與價格走勢，出現優惠時跳出通知；也能隨時查任一作品的史低，並依你手上的優惠券算出最划算的買法。
>
> v0.2 變更：新增「臨時查史低」（F12～F13）、「優惠券同步」（F14）、「購買試算」（F15～F16）與 §12 試算演算法。
> v0.3 變更：依 DLsite 官方說明與實測的優惠券 API 確認用券規則（§5.4、§10.1、§10.2）；演算法改為支援可重複使用的券；新增「會改變帳號狀態的 GET 網址」白名單規則（§3.4）。
> v0.4 變更：依 `SPEC_REVIEW.md` 的審查意見修正。重點：試算演算法把可重複使用與限次的券分開計算（§12.2）；外部資料只當純文字、URL 一律由程式自己組（§3.2）；對外請求只能透過唯一的包裝函式，路徑完全比對（§3.4）；新增訊息白名單（§3.2.4）、日期解析規則（§5.5）、背景工作（§4.1）、匯入規則（§3.7）；通知改成狀態轉換才發（§6）；清掉章節之間的矛盾。
> v0.5 變更：依 `SPEC_REVIEW_v0.4.md`（第二輪審查）修正。重點：試算的「到期分數」改成只有用掉一次性券才計成本，避免拆單（§12.2）；導覽與注入 UI 的資源載入也納入帶 cookie 的 GET 管制（§3.4）；補年份改成三個候選取最接近（§5.5）；通知規則表加上條件欄、修正空字串與連續活動（§6）；`priceLog` 遇到查價空白就新增一筆（§5.3）；徽章不主動發請求（§3.5）；空的優惠券回應不清空本機資料（§5.4）。試算 v1 上限 15 件，近似解移到第二階段。
> v0.6 變更：依 `SPEC_REVIEW_v0.5.md`（第三輪審查）修正。重點：導覽改成品牌型別＋連結元件＋擴大的語法規則＋打包掃描＋規則自我測試（§3.4）；content script 最小化、不用 React（§3.2.5）；商品 API 與 DLWatcher 只由 background 呼叫，列出完整訊息清單（§3.2.4）；新增 `Settings` 與 storage key 一覽（§5.3）；CSP 加上 `default-src`、`form-action` 並把 `connect-src` 寫到路徑（§7.1）；通知改寫成有順序的處理步驟（§6.1）；`priceLog`、優惠券同步、DLWatcher 合理性檢查的邊界修正；刪掉試算捷徑與優惠券管理頁的導覽常數。

---

## 1. 目標與範圍

### 1.1 目標
1. **自動追蹤**：在 DLsite 把作品加入購物車時，自動加入追蹤清單，不用另外操作。
2. **史低資訊**：每個追蹤作品都要看得到歷史最低價、最低價出現的期間，以及過去的價格走勢。
3. **優惠通知**：開始打折、低於目標價或達到史低時，跳出桌面通知。
4. **視覺化**：用一個儀表板頁面集中顯示所有追蹤作品的現價、史低和走勢圖。
5. **臨時查詢**：瀏覽任何作品時都能查史低，不必先加入追蹤清單。
6. **購買試算**：讀取自己帳號裡的優惠券，輸入想買的作品後，算出「怎麼分單、每單用哪張券」最便宜。

### 1.2 不做的事（v1 範圍外）
- 不自動下單、不操作結帳流程，也不替你在購物車套用優惠券。試算只給建議，實際套用由你自己操作。
- 優惠券只讀不寫：不領券、不兌換、不改帳號設定。
- 帳號資料只讀兩樣：**購物車裡的作品編號**（只讀你自己打開的購物車頁面）和**持有的優惠券**（§5.4 API）。地址、付款方式、購買紀錄、點數餘額一律不讀。
- 不爬整個 DLsite，只查追蹤清單裡的作品。
- 瀏覽器關閉時不查價（24 小時監控放在第二階段，見 §9）。

---

## 2. 功能需求

| 編號 | 功能 | 說明 | 優先度 |
|---|---|---|---|
| F1 | 加入購物車自動追蹤 | content script 偵測「カートに入れる」按鈕被點擊，取出作品編號並加入追蹤清單（偵測方式見下方） | P0 |
| F2 | 購物車同步 | 你打開購物車頁面時，讀取頁面 DOM 裡的作品編號，把漏抓的作品補進追蹤清單（F1 的備援）。**不發 fetch 讀購物車** | P1 |
| F3 | 手動管理 | 在作品頁或 popup 一鍵加入追蹤；在 popup 或儀表板移除、暫停追蹤、設定目標價 | P0 |
| F4 | 定時查價 | 每 6 小時批次查詢 DLsite 現價（可在設定調整，最短 1 小時） | P0 |
| F5 | 史低與歷史 | 從 DLWatcher 取得史低、特價紀錄和每年走勢，一天最多更新一次；設定頁可以關閉 DLWatcher，只用自己的查價紀錄 | P0 |
| F6 | 優惠通知 | 依通知規則（§6）跳出 Windows 通知。點擊後，單一作品開啟作品頁；多件合併的通知開啟 `dashboard.html?n=<notificationId>`，儀表板從 `recentNotifications` 讀出這則通知的作品並篩選（網址裡不放作品編號） | P0 |
| F7 | 儀表板 | 追蹤清單表格（現價、原價、折扣、史低、距史低差距、折扣截止）＋單一作品的價格走勢圖＋最近的通知 | P0 |
| F8 | 作品頁徽章 | 已追蹤的作品：在 DLsite 作品頁的價格區塊下方用**本機資料**顯示「史低 ¥xxx（期間）」和「追蹤中」狀態，並標示「資料來源：DL_Assistant」。未追蹤的作品只顯示「查史低」按鈕（F12）。徽章本身不發任何網路請求 | P1 |
| F9 | Popup | 點擊擴充功能圖示，顯示目前有優惠的追蹤作品摘要和最近的通知 | P1 |
| F10 | 匯入／匯出 | 追蹤清單與查價紀錄匯出成 JSON，可以匯入還原（限制見 §3.7） | P2 |
| F11 | 台幣參考價 | 用 API 的 `locale_price` 顯示台幣約略價格 | P2 |
| F12 | 臨時查史低 | 在**尚未追蹤**的作品頁，點擊頁面上的「查史低」按鈕或 popup 的「查詢這個作品」，顯示史低、期間、最近特價和走勢小圖。**不會加入追蹤清單**，結果旁邊另有「加入追蹤」按鈕可以選擇加入 | P0 |
| F13 | 從連結查史低 | 在搜尋結果、排行榜等列表頁，對作品連結按右鍵 →「DL_Assistant：查史低」，開啟擴充功能自己的小視窗（`lookup.html`）顯示結果，一樣不加入追蹤 | P1 |
| F14 | 優惠券同步 | 在 DLsite 頁面上（已登入時），content script 以同源請求呼叫優惠券 API（§5.4），把持有的券存到本機；6 小時最多同步一次，popup 也有「立即同步」按鈕（流程見下方） | P0 |
| F15 | 購買試算 | 選擇想買的作品（從購物車、追蹤清單或手動輸入編號，最多 15 件），算出最便宜的「分單＋用券」組合，並列出每一單要放哪些作品、用哪張券、付多少 | P0 |
| F16 | 試算比較 | 同時列出「全部一起買不用券」「全部一起買用最好的一張券」和「最佳方案」的金額，讓你看出省了多少；也可以勾選「這張券留著不用」再重算 | P1 |

**F1 偵測方式**
- content script 在 `document` 上以 capture 階段監聽 `click` 與 `auxclick`（中鍵、Ctrl＋點擊開新分頁也要偵測），用 `selectors.ts` 的選擇器判斷目標是不是加入購物車按鈕。用事件委派，動態載入的按鈕也偵測得到。只處理 `event.isTrusted === true` 的事件。
- 作品編號優先從按鈕的 `href` 或 data 屬性用 §3.2.2 的規則取出；取不到再用頁面網址；都取不到就放棄，不掃頁面文字。
- 點擊就當作「想買」並加入追蹤（`source: 'cart'`），不等待加入成功。漏掉的由 F2 在你打開購物車頁面時補上。從購物車移除作品不會自動取消追蹤。
- F1／F2 自動加入的作品在追蹤清單標示「自動加入」，提供一鍵移除（頁面腳本可以在你點擊前改寫按鈕，讓清單多出你沒看過的作品）。
- 儀表板說明：在其他裝置或 App 加入購物車的作品，要打開一次網頁版購物車才會同步。

**F14「立即同步」流程**
- popup 送 `syncCouponsNow` 給 background。background 找已開啟的 `https://www.dlsite.com/*` 分頁（`chrome.tabs.query`），依序嘗試 `status === 'complete'`、`discarded === false` 的分頁（目前視窗的作用中分頁優先）。
- 對選到的分頁，background 先在 `chrome.storage.session` 記下 `pendingManual: { tabId, expiresAt: 現在 + 1 分鐘 }`，再送 `chrome.tabs.sendMessage(tabId, { type: 'syncNow' }, { frameId: 0 })`。收到「Receiving end does not exist」（例如 `exclude_matches` 排除的頁面沒有 content script）就試下一個。
- content script 收到 `syncNow` 後照一般流程送 `shouldSyncCoupons`。「略過 6 小時」的授權只來自 background 自己記下的 `pendingManual`，content script 不能自己要求略過（§5.4「同步排程」）。
- 全部失敗或沒有 DLsite 分頁時，popup 顯示「請先開啟任一 DLsite 頁面再同步」。不自動開分頁，也**不從 background 發帶 cookie 的請求**。
- 自動同步的時機由 background 決定（§5.4「同步排程」）。

---

## 3. 非功能需求

### 3.1 對外請求的節制
- DLsite 商品 API 一次最多查 100 個作品 ID，請求之間間隔至少 1 秒。
- DLWatcher 每個作品 24 小時內最多請求一次（對方回傳 `Cache-Control: max-age=86400`），請求之間間隔至少 2 秒。每件作品最近一次請求 DLWatcher 的時間存在 `chrome.storage.local` 的 `dlwatcherLastRequest`（只存編號與時間），追蹤查價與臨時查詢都先檢查它，瀏覽器重開也不會在 24 小時內重複請求。
- 商品 API 與 DLWatcher **只由 background 呼叫**，頻率限制、退避與快取才能集中管理（§3.4）。
- 不自訂 User-Agent（瀏覽器不允許 fetch 改這個標頭，也不值得為此多要權限）。用頻率限制與快取節制流量。
- 遇到 HTTP 429 或 5xx 就用指數退避（1 分、2 分、4 分），連續失敗 3 次就暫停該來源 6 小時。退避狀態存在 `chrome.storage.local`，service worker 重啟後還記得（§4.1）。

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
- **作品頁連結**：只用 `https://www.dlsite.com/${site}/work/=/product_id/${id}.html` 組出。`site` 必須是列舉值（`maniax`、`home`、`books`、`pro`、`soft`…，完整清單見 §10.3），取 API 的 `site_id`，不在列舉內就用 `maniax`；`id` 必須通過 `isWorkId()`。
- **從網址取作品編號**（F1、F13）：先 `new URL(url)`，要求 `protocol === 'https:'` 且 `host === 'www.dlsite.com'`，再用 `^/[a-z]+/(work|announce)/=/product_id/([A-Z]{2}\d{6,8})(\.html)?(/|$)` 比對 `pathname`，取出的編號再過 `isWorkId()`。其他網址一律不處理。（手機版 `touch` 作品頁的網址若含連字號，regex 改成 `^/[a-z]+(-touch)?/…`，見 §10.3。）
- **圖片**：`//` 開頭的協定相對網址先補 `https:`（否則在擴充功能頁面會變成 `chrome-extension://img.dlsite.jp/...`），再用 `new URL()` 解析，要求 `origin === 'https://img.dlsite.jp'` 且 `username`、`password` 為空。不符的一律換成內建的預設圖。DLWatcher 和匯入檔案裡的圖片網址一律不用。
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
| 擴充功能頁面 → background | `sender.id === chrome.runtime.id`、`sender.origin === EXT_ORIGIN`、`sender.url` 以 `chrome.runtime.getURL('')` 開頭；`EXT_ORIGIN = \`chrome-extension://${chrome.runtime.id}\`` | `track {id, from: 'manual' 或 'lookup'}`（content script 送的 `track` 一律記成 `source: 'page'`，來源由 background 依 sender 決定）、`untrack {id}`、`setPaused {id, paused}`、`setTarget {id, price?}`、`lookup {id}`、`recheck {ids}`（1～100 件）、`syncCouponsNow`、`clearCoupons`、`setCouponReserved {key, reserved}`、`setSettings {partial}`、`resumeDlwatcher`、`importPreview {text}`、`importCommit {previewId}` |
| background → content script | content script 的 `onMessage` 只接受 `sender.id === chrome.runtime.id` 而且**沒有** `sender.tab` 的訊息 | `syncNow` |

- 匯出是讀取：擴充功能頁面直接讀 storage 組成檔案，不經過訊息。
- background 需要非同步回覆的訊息一律在監聽器裡 `return true` 並呼叫 `sendResponse()`，不依賴「回傳 Promise」（WXT 0.20 起不再預設使用 polyfill）。service worker 休眠時，訊息會喚醒它；監聽器在最上層同步註冊（§4.1），訊息不會遺失。
- content script 送訊息時處理 `chrome.runtime.lastError` 與 `undefined` 回覆。擴充功能更新後，舊分頁的 content script 會失去連線（「Extension context invalidated」），這時不顯示徽章、不報錯，最多重試一次。

- 擴充功能頁面的來源判斷**不用** `new URL(...).origin`（非特殊 scheme 依 URL 標準會得到 `"null"`，在測試環境就是如此），也不能用「有沒有 `sender.tab`」分辨（儀表板與 `lookup.html` 開在分頁裡，也會帶 `tab`）。判斷函式寫在 `lib/messages.ts`，單元測試用固定的假 `runtime.id`，`origin` 為 `"null"`、`https://www.dlsite.com.evil.example`、`http://www.dlsite.com`、`frameId: 1` 的訊息全部要被拒絕。
- 擴充功能頁面**讀取**資料時直接讀 `chrome.storage.local` 與 IndexedDB，不經過訊息；**寫入**一律送訊息給 background（§4.2）。
- 每種訊息都用 zod 驗證，作品編號都要通過 `isWorkId()`。來自 content script 的優惠券資料，background 要再跑一次完整的 zod 驗證，並檢查同步 token（§5.4）。
- background 不提供「幫我抓這個網址」之類的通用訊息。content script 只送作品編號，網址由 background 自己組。`openPage` 只能開擴充功能自己的儀表板或 `lookup.html`。
- `cartSnapshot` 只接受 `sender.url` 的路徑是購物車頁（實際路徑 M2 確認後寫進 `selectors.ts`）的訊息，同一個 `sender.documentId` 只接受一次。
- 數量上限：一次 `cartSnapshot` 最多 200 個編號，其中最多新增 50 件到追蹤清單；`cartClicked` 與 `cartSnapshot` 合計每天最多自動新增 200 件，超過就忽略，popup 顯示「有 N 件購物車作品沒有自動加入，請到購物車頁確認」；追蹤清單總數上限 1,000 件；`lookup` 每分鐘最多 10 次。
- 程式裡不註冊 `(chrome|browser).runtime.onMessageExternal`／`onConnectExternal`（ESLint 全面禁止；manifest 也鎖住，見 §7.1）。

#### 3.2.5 content script 範圍與注入的 UI
- content script 的 `matches` 為 `https://www.dlsite.com/*`，`exclude_matches` 排除結帳、付款、帳號設定相關路徑（實際路徑見 §10.3）；`all_frames: false`。

**content script 只放最少的程式碼。** content script 是唯一帶登入 cookie 的環境，它的請求以 DLsite 頁面的來源送出，**不受擴充功能 CSP 的 `connect-src` 約束**。打包進 content script 的任何相依套件，只要有一個被植入惡意版本，就能以登入狀態呼叫 `/home/mypage/coupon` 等帳號端點。所以：
- `dlsite.content.ts` 不使用 React、Tailwind、Chart.js。徽章與按鈕用原生 DOM（`createElement`＋`textContent`）建立。
- 注入的 UI 由 content script 自己 `attachShadow({ mode: 'closed' })`，不依賴 WXT 的 `createShadowRootUi`。樣式寫成一段字串放進 shadow root 的 `<style>`（不含 `url()`、`@import`），不 import CSS 檔，所以不需要 `web_accessible_resources`，content script 裡也沒有載入 CSS 的網路請求（WXT 的 `createShadowRootUi` 會透過網路載入 CSS）。
- content script 可以 import 的模組用 ESLint `no-restricted-imports` 列白名單：`lib/ids.ts`、`lib/text.ts`、`lib/selectors.ts`、`lib/messages.ts`、`lib/zod-setup.ts`、`lib/api/endpoints.ts`（content script 只用 `couponList`，其他端點有呼叫環境檢查）、`lib/coupons/parse.ts`、`lib/dates.ts`、zod、WXT 的 content script 定義工具。新增項目要改規格。
- `scripts/check-manifest.ts` 從 source map 列出 content script 打包檔包含的套件與大小，和上一版相比有新增套件就失敗，要人工確認。

**注入的 UI**
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

### 3.3 隱私
- 所有資料只存在本機（`chrome.storage.local` / IndexedDB），不上傳到任何伺服器。
- 優惠券資料**永遠不離開本機**：不送給 DLWatcher，也不匯出（F10 匯入時本來就不接受券，匯出沒有用途）。
- 讀取帳號資料只用你瀏覽器裡已登入的狀態。擴充功能不保存、不讀取 cookie 或密碼。
- `encrypted_code` 不在 schema 裡，不儲存。原始回應字串只存在於解析函式的區域變數，**不 log、不存、不放進錯誤訊息**。錯誤訊息只記錄「哪個欄位不符」與 HTTP 狀態碼。
- 測試 fixture 進 repo 前必須去掉 `encrypted_code`、任何帳號 ID、email、暱稱和個人時間戳。另加一個測試掃描 `tests/fixtures/**`，出現 `encrypted_code` 或 email 格式的字串就失敗。
- zod 解析不使用 `reportInput` 之類會把原始值帶進錯誤物件的選項；錯誤只記錄 `issue.path` 與 `issue.code`。
- 送給 DLWatcher 的只有作品編號，不送 cookie、帳號、購物車或優惠券內容。但對方仍會知道：你的 IP、查詢的作品編號與時間，也可能從請求辨識出這是本擴充功能；網域日後若換了持有者，新的持有者也會知道。設定頁寫明：「只有你按『查史低』或作品在追蹤清單裡時，才會把作品編號送給 DLWatcher。」並提供「關閉 DLWatcher」選項。
- 設定頁也寫明 DLsite 與頁面腳本能知道的事：
  - DLsite 每次查價會收到追蹤清單的作品編號（商品 API 不帶登入資訊，但 IP 和你瀏覽時相同），也可能從請求認出這是本擴充功能。
  - 頁面上的廣告與分析腳本可能偵測到本擴充功能已安裝（徽章的外框在頁面 DOM 裡；content script 的優惠券請求可能出現在頁面的 Resource Timing 紀錄，見 §10.3）。關閉徽章可以減少這類資訊。
- 瀏覽作品頁本身不會發出任何請求（§3.5）。
- 匯出時提醒「這份檔案包含你的追蹤清單（可能含 R18 作品）」。

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
- `apiGet` 檢查**呼叫環境**：`couponList` 要求 `globalThis.location?.origin === 'https://www.dlsite.com'`；`productInfo`、`dlwatcher` 要求在 service worker 裡執行（`typeof ServiceWorkerGlobalScope !== 'undefined' && globalThis instanceof ServiceWorkerGlobalScope`，而且 `location.protocol === 'chrome-extension:'`）。不符就丟例外。Vitest 裡沒有這些全域物件，測試要自己提供。
- 擴充功能頁面需要查價時送訊息（`lookup`、`recheck`），由 background 套用頻率限制與快取後回覆（§3.1）。
- `product_id` 的逗號被 `URLSearchParams` 編碼成 `%2C`；DLsite 是否接受在 M1 確認，不接受就由 `apiGet` 自己組查詢字串（編號都通過 `isWorkId()`，不含需要編碼的字元）。
- **只有 `couponList` 會帶 cookie。** 其他 DLsite 路徑（購物車、結帳、領券、帳號設定）一律不發請求。F2 購物車同步只讀你自己打開的購物車頁面 DOM。
- 單元測試測**行為**：對 `/home/mypage/coupon`、`/home/mypage/coupon?x=1`、`/home/mypage/coupon/`、`/home/mypage/coupon/list`、`/home/cart`、`/home/buy`、`https://login.dlsite.com/` 呼叫 `assertAllowed()`，每一個都要丟例外；`product_id` 含非法編號、重複參數、帶 `#hash` 的網址也要丟例外。白名單的筆數用快照測試鎖住，新增端點必須同時改測試。

**導覽與資源載入也算帶 cookie 的 GET。** 開分頁、點連結、載入圖片都會以登入狀態對 DLsite 發 GET，不經過 `apiGet`，擴充功能頁面的 CSP 也管不到導覽。
- 擴充功能開啟 DLsite 網址（開分頁、開視窗、連結、通知點擊）只能用兩種來源：`lib/ids.ts` 的 `buildWorkUrl(site, id)`，以及 `lib/nav.ts` 裡固定的常數。常數目前只有購物車頁（實際網址 M2 確認）。
- **不提供優惠券管理頁的連結**：它和領券端點只差 `/list`，而導覽一定會跟隨轉址。需要引導你看券時，畫面用文字說明「DLsite → マイページ → クーポン管理」。日後真的要加，先在 §10.3 確認這個頁面在未登入與登入時都不會轉址到 `/home/mypage/coupon`。
- 這條規則用四層防線保證：
  1. **型別**：`lib/nav.ts` 匯出品牌型別 `type DlsiteNavUrl = string & { readonly __brand: 'DlsiteNavUrl' }`，只有 `buildWorkUrl()` 與 `nav.ts` 的常數能產生這個型別。`nav.ts` 的 `openTab(url: DlsiteNavUrl | ExtPageUrl)` 與 `openPopupWindow(...)` 是開分頁與視窗的唯一函式（`ExtPageUrl` 只能由 `chrome.runtime.getURL()` 組出的擴充功能頁面網址產生）。
  2. **元件**：擴充功能頁面一律用 `components/WorkLink.tsx`（參數是 `site`、`id`）與 `components/NavLink.tsx`（參數是 `nav.ts` 的常數名稱）產生連結。ESLint 用 `react/forbid-elements` 禁止 `<a>`、`<form>`、`<area>`，用 `react/forbid-dom-props` 禁止 `href`、`action`、`formAction`，只有這兩個元件檔案例外。
  3. **語法規則**（`no-restricted-syntax`，只有 `nav.ts` 例外）：禁止 `(chrome|browser).tabs.(create|update|duplicate)`、`(chrome|browser).windows.(create|update)`、`window.open`、`location.assign`／`location.replace`、對 `location` 或 `location.href` 指派，以及 `document.createElement('a'|'form'|'area')`。`chrome.` 和 WXT 慣用的 `browser.` 都要涵蓋。
  4. **打包掃描**：`scripts/check-manifest.ts` 對 `.output/chrome-mv3/**/*.js` 檢查 `/mypage\/coupon(?!\/list\/ajax)/`、`/home/buy`，以及加入購物車的實際路徑（M2 確認後補上），出現就失敗。
- **規則自我測試**：`tests/lint-fixtures/` 放每一種違規寫法的範例檔（含 `browser.tabs.create`、`location.href =`、`<a href>`、`<form action>`、`{...props}` 展開、`React.createElement('a')`），CI 確認 ESLint 對每個檔案都報錯，避免規則寫錯而永遠不觸發。
- 單元測試：`buildWorkUrl` 對所有分站列舉值、`nav.ts` 的每個常數，都不能產生 `/home/mypage/coupon`、加入購物車的路徑、`/buy` 或任何帳號設定路徑。
- 注入 DLsite 頁面的 UI 不放任何網址（§3.2.5）。
- 擴充功能不提供「一鍵加入購物車」「前往結帳」「套用優惠券」這類按鈕。

> ⚠️ **不要呼叫 `GET /home/mypage/coupon`**（少了 `/list/ajax`）。這是**領券**端點，實測打開會嘗試發券。

### 3.5 臨時查詢的資料處理
- 臨時查史低（F12、F13）的結果只放在 `chrome.storage.session`（瀏覽器關閉就清空），快取 24 小時，**不寫進追蹤清單和查價紀錄**。
- 作品頁徽章**不主動發任何網路請求**。已追蹤的作品，徽章只用本機資料（`snapshots`、`history`、`priceLog`）；未追蹤的作品，徽章只顯示「查史低」按鈕。
- 只有你真的點擊「查史低」（`isTrusted`）時，content script 才送 `lookup {id}`，background 才查 DLsite 與 DLWatcher。
- `chrome.storage.session` 維持預設存取層級（content script 讀不到），只有 background 讀寫；查詢結果由 background 回覆給 content script。
- 快取存在 `chrome.storage.session` 的 `lookupCache`，形狀是 `Array<{ id, snapshot: PriceSnapshot, history: HistoryRecord | null, fetchedAt }>`（載入後放進 `Map`），最多保留 200 件，超過時刪掉最舊的（session 配額 10 MB）。
- 使用者按「加入追蹤」時，才把快取結果轉存為正式資料。

### 3.6 容錯
- DLsite 和 DLWatcher 都是非官方介面，隨時可能改版。任一來源壞掉時，其他功能要能繼續運作。
- **自己的價格紀錄**：每次查價（F4 排程、手動重新查價）都寫進 `priceLog`（§5.3），不論 DLWatcher 是否可用。DLWatcher 停止服務或被關閉時：
  - 史低 = 自己紀錄的最低價，畫面標示「自 YYYY-MM-DD 開始追蹤以來的最低價」（自己的紀錄只從加入追蹤那天開始）。
  - 走勢圖改用 `priceLog` 畫階梯折線；沒有查價的期間（上一筆的 `lastSeenAt` 到下一筆的 `at`）畫成虛線，不假裝價格沒變。
  - 史低與通知基準只計算 `status`、`origin` 都為空的紀錄（排除「查不到」與匯入的紀錄）。
- **DLWatcher 的歷史保留在本機**：`HistoryRecord` 只在新的回應驗證成功、而且通過下面的合理性檢查時才覆蓋；請求失敗、404、驗證失敗或檢查不通過時，保留上一次的資料並標示取得時間，不能用空資料或可疑資料蓋掉。保留下來的資料照常算進史低基準，畫面標示「DLWatcher 資料取得於 YYYY-MM-DD」；只有在設定裡關閉 DLWatcher 時才完全不用。
- **DLWatcher 資料的合理性檢查**（防「格式正確但內容是假的」資料，例如網域換了持有者）：
  - `lowest.price ≤ max(regularPrice, 自己紀錄裡見過的最大 officialPrice)`（原價可能調降過），而且 `lowest.price ≥ floor(regularPrice × 0.05)`。
  - `start ≤ end`、`start ≤ 現在 + 1 天`、`end ≤ 現在 + 400 天`（進行中的特價，`end` 可能是未來的結束時間；實際意義 M3 確認，§10.3）。走勢點的 `x`、`y` 都在 0～1。
  - 新的 `lowest.price` 比上次低超過 50%，而且自己的 `priceLog` 沒有看過差距 5% 以內的價格時，標示「DLWatcher 資料與自己的紀錄差異很大」。
- 畫面同時顯示「DLWatcher 史低」與「自己紀錄的最低價」兩個數字，不只顯示合併後的值。
- DLWatcher 連續 7 天對所有作品都失敗或都不通過檢查時，自動暫停 DLWatcher，並通知「DLWatcher 似乎已停止服務，已改用自己的紀錄」；要你手動重新開啟。
- 臨時查詢（F12、F13）的結果不寫進 `priceLog`；按「加入追蹤」時，把當下查到的價格寫成第一筆。
- F10 匯出包含 `priceLog`，換電腦或重裝時可以帶走自己的紀錄。
- DOM 選擇器集中在 `selectors.ts`，改版時只要改一處。

### 3.7 匯入／匯出（F10）
- 匯出格式帶 `format: "dl-assistant-export"` 與 `version` 欄位；匯入時版本不認得就拒絕。
- 匯入檔上限 5 MB，超過直接拒絕。用 `file.text()` 讀取後 `JSON.parse`，再用 `.strict()` 的 zod schema 驗證整份檔案，任何一筆不符就整份拒絕並顯示錯誤位置。
- 匯出格式一律用陣列（`items: TrackedItem[]`、`priceLog: PriceLogEntry[]`），不用以編號為 key 的物件。
- 可以匯入的只有：追蹤清單（`id`、`targetPrice`、`paused`、`addedAt`）與自己的查價紀錄（`priceLog`）。`id` 必須通過 `isWorkId()`；數字有範圍（價格 0～1,000,000 的整數）。
- **新增的作品**：`source: 'import'`、`autoAdded: false`、`title: ''`、`imageUrl: ''`、`site: 'maniax'`、`baselineAt` 為空（下次查價只建立基準並更新名稱、圖片、分站，§6.1）。
- **已存在的作品**：只覆蓋 `targetPrice`、`paused`；`addedAt` 取兩者中較早的值；`baselineAt` 與其他欄位不變。
- `priceLog` 匯入規則：
  - v1 **只對本機完全沒有紀錄的作品**匯入 `priceLog`。本機已有紀錄的作品整份略過，摘要顯示「N 件已有本機紀錄，未匯入查價紀錄」（避免合併與重疊的邊界問題）。
  - `at`、`lastSeenAt` 必須通過 `lib/dates.ts` 的 `isCanonicalIso(s)`（符合 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`，而且轉回 ISO 字串和原字串相同）；`at ≤ lastSeenAt ≤ 匯入當下`。（格式不一致會打亂 IndexedDB key 的字典序。）
  - 同一作品的紀錄依 `at` 排序後不能重疊；每件作品最多 5,000 筆。
  - 匯入的紀錄一律加上 `origin: 'import'`。史低若來自匯入紀錄，畫面標示「來自匯入的資料」；史低基準與 `lowest` 通知不使用匯入紀錄（一份檔案就能偽造 ¥1 的史低）。
- 匯入分兩步：擴充功能頁面送 `importPreview {text}`，background 驗證後回覆摘要與 `previewId`；你確認後頁面送 `importCommit {previewId}` 才寫入。
- **不匯入**：`title`、`imageUrl`（下次查價時從 API 重新取得）、設定、通知紀錄、**優惠券**。優惠券只能來自 F14 同步，避免假券影響試算。
- 匯入資料一樣適用 §3.2.3 的原型污染規則。
- 匯入前顯示摘要（新增幾件、更新幾件、略過幾件查價紀錄），你確認後才寫入。

---

## 4. 系統架構

```
┌──────────────── DLsite 頁面 ────────────────┐
│ content script（isolated world）            │
│  ├─ 偵測加入購物車 → 傳作品編號給 background│
│  ├─ 購物車頁面：讀 DOM 裡的作品編號         │
│  ├─ 作品頁：史低徽章／「查史低」按鈕        │
│  └─ 任何頁面：呼叫優惠券 API（F14）         │
└──────────────────┬──────────────────────────┘
                   │ chrome.runtime 訊息（§3.2.4 白名單）
┌──────────────────▼──────────────────────────┐
│ background service worker                   │
│  ├─ chrome.alarms 排程＋查價佇列（§4.1）    │
│  ├─ apiGet：商品 API / DLWatcher（只在這裡呼叫）│
│  ├─ 臨時查詢（session 快取，不進追蹤清單）  │
│  ├─ 右鍵選單「查史低」→ 開 lookup.html      │
│  ├─ 通知規則引擎 → chrome.notifications     │
│  └─ storage 存取層（唯一的寫入者）          │
└──────────────────┬──────────────────────────┘
                   │
     ┌─────────────┼──────────────┬────────────────┐
┌────▼─────┐ ┌─────▼──────┐ ┌─────▼──────────┐ ┌───▼────────┐
│ popup    │ │ 儀表板頁面 │ │ 購買試算頁面   │ │ lookup.html│
│ 優惠摘要 │ │ 表格＋走勢 │ │ 分單＋用券建議 │ │ 右鍵查史低 │
│ 查這個作品│ └────────────┘ │（頁面內計算）  │ └────────────┘
└──────────┘                └────────────────┘
```

### 4.1 背景工作
MV3 service worker 閒置 30 秒會被終止，記憶體裡的狀態會消失。
- 查價佇列存在 `chrome.storage.local`，兩個來源各自一條：`queues: { productInfo: { ids[], nextIndex, nextAt }, dlwatcher: { ids[], nextIndex, nextAt } }`，一個來源在退避時不會卡住另一個。每處理完一件（或一批）就把進度寫回 storage。
- 每次被 alarm 喚醒最多處理 60 秒，還有剩就設一次性的 `drain` alarm（`delayInMinutes: 0.5`）繼續。service worker 被終止也能從 `nextIndex` 接著做。
- 退避狀態（每個來源的連續失敗次數、暫停到何時）存在 `chrome.storage.local`。
- 商品 API 若因為其中一個壞編號而整批回傳 4xx（行為見 §10.3），就把這批拆成兩半重試，找出壞的編號並記成 `unavailable`（§5.3），不計入退避。
- 暫停追蹤的作品（`paused: true`）不放進查價佇列。
- `runtime.onInstalled`、`runtime.onStartup`，以及 service worker 每次啟動時，都用 `chrome.alarms.get` 檢查排程是否存在，不在就重建（alarms 在瀏覽器重啟時可能被清除）。另外記錄 `lastRunAt`，啟動時若距離上次超過週期就立刻排一次。
- 所有事件監聽器（`alarms.onAlarm`、`runtime.onMessage`、`contextMenus.onClicked`、`notifications.onClicked`）都在 `background.ts` 最上層同步註冊。
- 右鍵選單在 `runtime.onInstalled` 先 `chrome.contextMenus.removeAll()` 再 `create`，不在 service worker 每次啟動時建立（重複的 `id` 會出錯）。

### 4.2 資料寫入
- 所有寫入都經過 background（單一寫入者）。其他頁面與 content script 用訊息要求修改。background 內部用一個 Promise 佇列讓寫入依序執行，避免「讀 → 改 → 寫」互相覆蓋。
- 擴充功能頁面讀取資料時直接讀 `chrome.storage.local` 與 IndexedDB，並用 `chrome.storage.onChanged` 更新畫面。content script 讀不到 IndexedDB 的擴充功能資料，徽章需要的資料由 background 回覆 `badgeInfo`。
- IndexedDB 連線處理 `versionchange` 事件：收到就關閉連線並提示重新整理頁面。
- 同步鎖與 `syncToken` 的「讀取、判斷、寫入」也放在同一個 Promise 佇列裡執行，兩個分頁同時送 `shouldSyncCoupons` 時只有一個拿到 token。
- **寫入與通知的先後**：每件作品查價處理完，先用**一次** `chrome.storage.local.set({...})` 寫入 `snapshots`、`ruleState`、`notified`、`recentNotifications`，`priceLog` 寫入 IndexedDB，然後才呼叫 `chrome.notifications.create`。service worker 若在中間被終止，寧可漏發也不重複發；漏發的通知仍在「最近的通知」看得到。（一次 `set` 寫多個 key 是否不可分割，見 §10.3。）
- **清理**：移除追蹤時刪掉該作品的 `RuleState`、`snapshots`（`priceLog` 保留，重新追蹤時還能用）；每次同步優惠券後，刪掉已不存在的 `coupon.key` 的 `RuleState` 與 `Settings.reservedCouponKeys`。

---

## 5. 資料來源與資料模型

### 5.1 DLsite 商品資訊 API（現價，已實測）

```
GET https://www.dlsite.com/maniax/product/info/ajax?product_id=RJ001,RJ002,...&cdn_cache_min=1
```
- 不用登入，用逗號分隔可以一次查多個 ID（最多 100 個）。
- 會用到的欄位：

| 欄位 | 範例 | 用途 |
|---|---|---|
| `work_name` | 作品名稱 | 顯示 |
| `work_image` | `//img.dlsite.jp/...` | 縮圖。協定相對網址，存入前依 §3.2.2 正規化 |
| `price` / `official_price` | 1386 / 1980 | 現價、原價（日圓含稅） |
| `discount_rate` | 30 | 折扣 % |
| `is_discount` | true | 是否正在打折 |
| `discount_end_date` | `11/26 13:59` | 折扣截止（沒有年份，日本時間，補年份規則見 §5.5） |
| `campaign_id` | `t825ai` | 判斷是不是同一檔活動；可能是空的（§6） |
| `default_point_rate` | 6 | 點數回饋率 |
| `locale_price` | `{ "en_US": 8.73, ... }` | 各幣別參考價 |
| `is_sold_out` / `sales_end_info` | | 下架或停售判斷 |
| `site_id` / `work_type` | `home` / `SOU` | 樓層與作品形式，用來比對券的適用範圍。試算以這裡的 `site_id` 為準，不用網址判斷的分站 |
| `custom_genres` | `["20261016coupon50", ...]` | **作品被列入哪些活動分類**。券的 `custom_genre` 條件就是比對這裡 |
| `is_noreduction` | false | 推測是「不能用券」，待確認（§10.2 f） |

### 5.2 DLWatcher（史低與歷史，已實測）

```
GET https://dlwatcher.com/product/{作品編號}.json
```
- 不用登入，`robots.txt` 允許 `/product/`，沒有 CORS 標頭（要從 background 發請求）。
- 會用到的欄位：

| 欄位 | 內容 |
|---|---|
| `lowestPrice.priceInfo.price` / `.start` / `.end` | 史低價格與期間 |
| `recentSalePriceLog[]` | 最近 5 次特價（價格、折扣、開始／結束時間） |
| `priceLogGraph.graphs.{年}.points[]` | 每年走勢點：x 是年內進度（0～1），y 是現價除以原價 |
| `priceLogGraph.regularPrice` | 原價 |
| `discountDaysOfLastYear` | 過去一年打折的天數 |
| `ebmInput.sale_count` | 累計打折次數 |

- `priceLogGraph` 的 x 要換算回日期：`日期 = 該年 JST 1/1 00:00 + x × 該年天數`，誤差大約一天。價格 = `Math.round(y × regularPrice)`。
- 日期欄位（`lowestPrice.priceInfo.start／end`、`recentSalePriceLog[].start／end`）的格式與時區在 M3 依實際回應確認，寫進 `lib/dates.ts` 的 `parseDlwatcherDate()`；確認前一律當作解析失敗。
- 不使用 DLWatcher 提供的任何網址（圖片、連結）。

### 5.3 本機資料模型

時間欄位一律存 UTC 的 ISO 字串（`2026-12-02T15:58:36.000Z`），轉換規則見 §5.5。

**storage key 一覽**（寫入者一律是 background，§4.2）

| key | 位置 | 型別 | 匯出 |
|---|---|---|---|
| `settings` | `storage.local` | `Settings` | 否 |
| `items` | `storage.local` | `TrackedItem[]` | 是 |
| `snapshots` | `storage.local` | `PriceSnapshot[]`（載入後放進 `Map`） | 否 |
| `coupons` | `storage.local` | `Coupon[]` | **否** |
| `couponSync` | `storage.local` | `CouponSyncState` | 否 |
| `ruleState` | `storage.local` | `[string, RuleState][]`（載入後放進 `Map`） | 否 |
| `notified` | `storage.local` | `NotifiedKey[]` | 否 |
| `recentNotifications` | `storage.local` | `RecentNotification[]`（最多 50 則） | 否 |
| `queues` | `storage.local` | §4.1 的查價佇列 | 否 |
| `backoff` | `storage.local` | `{ productInfo, dlwatcher }` 各自的 `{ failures: number; pausedUntil?: string }` | 否 |
| `lastRunAt` | `storage.local` | `string` | 否 |
| `dlwatcherHealth` | `storage.local` | `{ allFailingSince?: string }`（§3.6 的 7 天自動暫停） | 否 |
| `dlwatcherLastRequest` | `storage.local` | `[id, at][]`（§3.1） | 否 |
| `dailyAutoAdd` | `storage.local` | `{ date: string; count: number }`（§3.2.4 每日上限） | 否 |
| `lookupCache` | `storage.session` | §3.5 | 否 |
| `couponSyncLock` | `storage.session` | `{ token, tabId, documentId, expiresAt }`（§5.4） | 否 |
| `pendingManual` | `storage.session` | `{ tabId, expiresAt }`（F14） | 否 |
| `history` | IndexedDB | `HistoryRecord` | 否 |
| `priceLog` | IndexedDB | `PriceLogEntry` | 是 |

```ts
// 設定（chrome.storage.local，key: "settings"）
interface Settings {
  checkIntervalHours: number;              // F4，1～24，預設 6
  dlwatcherEnabled: boolean;               // F5 使用者開關，預設 true
  dlwatcherAutoPausedAt?: string;          // §3.6 自動暫停的時間；有值時不請求，直到使用者送 resumeDlwatcher
  usePointPaymentMethod: boolean;          // §10.1 ⑥「我用特定付款方式」，預設 false
  treatUnknownDiscountedAsUsable: boolean; // §12.2 appliesToDiscounted 為 null 時視為可用，預設 false
  hideTitlesInNotifications: boolean;      // §6.2，預設 false
  showBadge: boolean;                      // §3.2.5，預設 true
  rules: { sale: boolean; target: boolean; lowest: boolean; ending: boolean; deeper: boolean; couponExpiring: boolean };  // §6 預設欄
  reservedCouponKeys: string[];            // F16「這張券留著不用」
}

// 追蹤清單（chrome.storage.local，key: "items"）
interface TrackedItem {
  id: string;              // RJ01014447，通過 isWorkId()
  site: string;            // 加入時從網址暫填，第一次查價後改成 API 的 site_id
  title: string;           // 最多 300 字
  imageUrl: string;        // 依 §3.2.2 正規化的 https://img.dlsite.jp/ 網址；不符時為空字串（顯示預設圖）
  addedAt: string;
  source: 'cart' | 'page' | 'manual' | 'lookup' | 'import';
  // cart：F1／F2；page：作品頁徽章的「加入追蹤」；manual：popup 或儀表板；lookup：F12／F13 結果的「加入追蹤」
  autoAdded: boolean;      // cart 與 page 為 true，追蹤清單標示「自動加入」或「從作品頁加入」，可一鍵移除
  baselineAt?: string;     // 建立基準的時間；為空時查價只建立基準、不發通知（§6.1）
  targetPrice?: number;    // 使用者設定的目標價（日圓）
  paused: boolean;         // 暫停 = 不查價、不通知；恢復時清掉 baselineAt，下一次查價重新建立基準
}

// 最新狀態（key: "snapshots"，以 id 為 key；載入後放進 Map）
interface PriceSnapshot {
  id: string;
  available: boolean;      // false：這次查不到（API 沒回傳、is_sold_out），其他價格欄位沿用上一次
  price: number;
  officialPrice: number;
  isDiscount: boolean;
  discountRate: number;
  discountEnd?: string;    // 依 §5.5 補上年份；截止時間不明時省略
  campaignId?: string;
  episode?: { key: string; startedAt: string; maxRate: number };  // 目前這段優惠（§6.1）；key 建立後不重算，規則表的 episodeKey 一律指它；不在打折中（onSale 為 false）時省略
  pointRate: number;
  couponFacts: CouponFacts;
  checkedAt: string;
}

// 作品的用券相關資訊（來自 §5.1 商品 API，存在 PriceSnapshot.couponFacts）
interface CouponFacts {
  siteId: string;          // site_id，例："home"
  workType: string;        // work_type，例："SOU"（音聲）
  customGenres: string[];  // custom_genres，用來比對 custom_genre 型的券
  noReduction: boolean;    // is_noreduction（推測是「不能用券」，待確認）
}

// 史低與歷史（IndexedDB "history"，以 id 為 key）
interface HistoryRecord {
  id: string;
  lowest: { price: number; start: string; end: string } | null;
  sales: { price: number; rate: number; start: string; end: string }[];
  curve: { date: string; ratio: number }[];   // 由 priceLogGraph 換算
  regularPrice: number;    // priceLogGraph.regularPrice，合理性檢查與走勢換算用
  discountDaysLastYear?: number;
  saleCount?: number;      // ebmInput.sale_count，儀表板顯示「累計打折 N 次」
  fetchedAt: string;
}

// 自己的查價紀錄（IndexedDB "priceLog"，key: [id, at]）
// 這份紀錄不依賴 DLWatcher，DLWatcher 停止服務或被關閉時，史低、走勢圖與通知都改用它（§3.6）。
// 作品查不到（API 沒回傳、is_sold_out）時，這次的值是 { status: 'unavailable'，價格等欄位沿用最後一筆 }。
// 以下任一情況新增一筆，否則只更新最後一筆的 lastSeenAt：
//   1. status（有值／沒值）、price、officialPrice、isDiscount、discountRate、campaignId 任一和最後一筆不同
//   2. 這次查價時間 − 最後一筆的 lastSeenAt > 2 × 查價週期（預設 12 小時）
//      → 代表中間有一段沒查價；畫圖時「上一筆 lastSeenAt 到這一筆 at」畫虛線
//   3. 最後一筆是 origin: 'import'（本機查到的價格不併進匯入紀錄）
// 因此連續查不到只更新同一筆的 lastSeenAt；恢復販售時 status 改變，一定新增一筆。
interface PriceLogEntry {
  id: string;
  price: number;
  officialPrice: number;
  isDiscount: boolean;
  discountRate: number;
  campaignId?: string;
  at: string;              // 這一筆第一次被查到的時間（toISOString() 格式）
  lastSeenAt: string;      // 最後一次查到還是同樣內容的時間
  status?: 'unavailable';  // 查不到；不參與史低
  origin?: 'import';       // 匯入的紀錄；不參與史低基準與通知（§3.7）
}

// 持有的優惠券（chrome.storage.local，key: "coupons"）
// 欄位對應 §5.4 優惠券 API 的實際回應
interface Coupon {
  key: string;                   // 本機唯一識別：`${coupon_id}#${limit_date ?? end_date}#${同組序號}`。儲存、「留著不用」、couponExpiring 都用 key
  id: string;                    // coupon_id，例："dojin_30peroff_20261116"；只用來顯示和比對（同一種券可能有多張，見 §10.2 l）
  name: string;                  // coupon_name
  kind: 'rate' | 'price';        // discount_type：折扣率 "rate"／定額 "price"（兩種都已實測）
  value: number;                 // discount：rate 是 1～100 的整數（30 代表 30%）；price 是 1～100,000 的整數（日圓）
  multiUse: boolean;             // is_multiple_use：false 代表每人只能用一次（實測定額券是 false）
  usage?: { count: number; limit: number };   // limited_usage_count / limited_usage_limit，語意待確認（§10.2 i）
  eligibility:
    | { type: 'custom_genre'; genres: string[] }   // 作品的 custom_genres 有交集才適用
    | { type: 'site_ids'; siteIds: string[] }      // 作品的 site_id 在清單內才適用
    | { type: 'payment'; siteIds: string[] };      // 整筆結帳折抵：distribute_targets 的樓層
  affectsPayment: boolean;       // is_affect_to_payment：只用於顯示；試算判斷整筆折抵一律看 eligibility.type === 'payment'（不一致時見 §10.2 n）
  maxItemPrice?: number;         // conditions.maximum_applicable_price；API 為 null 時是 undefined（沒有上限），不是 0
  minSpend: number;              // conditions.price_sum 正規化後的值（§5.4），0 代表沒有門檻
  minItems: number;              // conditions.post_condition.count，沒有就是 1
  workFormats?: string[];        // 指定作品形式的券（實際欄位名待確認，§10.2 j）
  appliesToDiscounted: boolean | null;  // 判斷規則見下方註解
  floors: { doujin: boolean; books: boolean; pc: boolean; app: boolean; ai: boolean; female: boolean; adult: boolean };  // 只用於顯示，不參與 save 與 couponExpiring（§12.2、§10.2 m）
  startsAt: string;              // 由 start_date（JST）轉換
  expiresAt: string;             // min(limit_date, end_date)，規則見 §5.5
  conditionText: string;         // condition_info 轉成的純文字（§3.2.1），最多 2,000 字
  plannerUsable: boolean;        // false：條件無法解析或類型不認得，只顯示、不參與試算
  unusableReason?: string;       // plannerUsable 為 false 的原因，顯示給使用者
  syncedAt: string;
}
// appliesToDiscounted 的判斷（比對前先去掉全形與半形空白）：
//   1. 否定說法 → false：「割引中の作品」（後面可接「に」「には」「は」）之後 3 個字以內緊接「適用出来ません」「適用できません」「対象外」「併用不可」
//      （不能只看「割引中」後 20 字：「割引中の作品にも適用出来ます。※一部対象外の作品があります」會被誤判成 false）
//   2. 肯定說法 → true：「割引中の作品にも適用出来ます」「割引中の作品にも適用できます」，或券名含【割引併用可】
//   3. 其他 → null（未知）
// 一定要先判否定：「割引中の作品にも適用出来ません」也包含「割引中の作品にも適用」。

// 優惠券同步狀態（key: "couponSync"）
interface CouponSyncState {
  lastSuccessAt?: string;
  lastResult: 'ok' | 'empty' | 'notLoggedIn' | 'failed' | 'unreadable';   // empty：讀到 [] 但本機原本有券（§5.4）
  invalidCount: number;          // 這次有幾張券解析失敗
}

// 每個對象每條規則的上次判定結果（key: "ruleState"，載入後放進 Map）
// Map 的 key 為 JSON.stringify([對象種類, 對象編號, rule])，對象種類是 'work' 或 'coupon'
interface RuleState {
  active: boolean;               // 上次判定時條件是否成立
  since?: string;                // 這次成立的開始時間
}

// 已送出的通知（key: "notified"），超過 180 天的在每次排程時刪除
interface NotifiedKey {
  key: string;                   // 依 §6 規則表的去重 key，用 JSON.stringify([...]) 組成，不直接串接字串
  at: string;
}

// 最近的通知（key: "recentNotifications"，保留 50 則），popup 與儀表板顯示
interface RecentNotification {
  notificationId: string;
  ids: string[];                 // 這則通知涵蓋的作品
  rules: string[];
  text: string;
  at: string;
}
```

### 5.4 DLsite 優惠券 API（持有的券，2026-11-23 實測，需登入）

```
GET https://www.dlsite.com/home/mypage/coupon/list/ajax
```
- 優惠券管理頁面（`/home/mypage/coupon/list`）就是呼叫這支 API 拿資料，回傳持有券的陣列。由 content script 以同源請求呼叫（§3.4 的 `couponList`），不用解析 HTML。
- ⚠️ 回應內容是 JSON，但 `Content-Type` 是 `text/html`。程式要用 `response.text()` 再 `JSON.parse`，**不能**用 Content-Type 判斷。
- 一次回傳全部樓層、包含 R18 的券（實測 7 張全部回傳），頁面上的樓層篩選與 R18 勾選只是前端過濾。
- 會用到的欄位：

| 欄位 | 範例 | 說明 |
|---|---|---|
| `coupon_id` / `coupon_name` | `dojin_30peroff_20261116` | 識別碼與名稱 |
| `discount_type` / `discount` | `rate` / `"30"`，`price` / `"400"` | 折扣方式與數值（字串，用 `intIn()` 轉數字） |
| `is_multiple_use` | true / false | true：期間內可以重複使用；false：每人限用一次 |
| `is_affect_to_payment` | true | 折抵整筆結帳金額（定額券實測為 true） |
| `limit_date` | 1796227116 | **實際到期時間**（Unix **秒**，範圍檢查見 §5.5）。定額券是領券後 10 天，比 `end_date` 早 |
| `encrypted_code` | 一串編碼 | 不需要，**不在 schema 裡、不儲存、不記錄** |
| `limited_usage_count` / `limited_usage_limit` | null | 有次數限制的券才有值 |
| `condition_type` | `custom_genre`、`site_ids` 或 `payment` | 適用範圍的判斷方式。`payment` 是整筆結帳折抵 |
| `conditions.custom_genre` | `["20261116coupon30"]` | 對應作品的 `custom_genres` |
| `conditions.site_ids` | `["home", "maniax", ...]` | 對應作品的 `site_id`（含 `touch` 版） |
| `conditions.maximum_applicable_price` | `"2749"` | 單價上限，超過就不適用；可能是 `null` |
| `conditions.price_sum` | `0` 或 `[1200]` | 金額門檻。型別不固定，正規化規則見下方 |
| `conditions.post_condition` | `{ "count": 3, "price": 1 }` | 至少買 3 件適用作品（`price` 的意思待確認） |
| `condition_info` | HTML 文字 | 使用條件說明，例如「割引中の作品にも適用出来ます」。依 §3.2.1 轉成純文字 |
| `start_date` / `end_date` | `2026-11-28 23:59:59` | 有效期間（日本時間，沒有時區標記，解析規則見 §5.5） |
| `is_doujin_coupon` / `is_books_coupon` / `is_pc_coupon` / `is_app_coupon` / `is_ai_coupon` / `is_adult_coupon` / `is_female_coupon` | | 適用樓層旗標 |

**`price_sum` 正規化**：接受 `null`、`intIn(0, 1_000_000)`、`[]`、`[intIn(0, 1_000_000)]`。`null` 或 `[]` 視為 0。陣列超過 1 個元素時，這張券標成 `plannerUsable: false`（「條件無法解析」）。

**判斷同步結果**（請求設定 `redirect: 'manual'`，不會跟隨轉址）：

| 結果 | 判定 | 本機資料 |
|---|---|---|
| `response.type === 'opaqueredirect'` | 未登入 | 保留，標示「未登入，上次同步：…」 |
| fetch 丟例外、HTTP 狀態不是 200、內容超過 1 MB | 同步失敗 | 保留，標示失敗 |
| `JSON.parse` 失敗 | 未登入或 API 改版（兩者無法區分） | 保留，標示「無法讀取」 |
| 最外層是非空陣列，至少一張解析成功 | 成功 | 以解析成功的券**整批取代**本機的券；有失敗的就計數，popup 顯示「有 N 張券無法解析」 |
| 最外層是非空陣列，**全部**解析失敗 | API 可能改版 | **保留**本機的券，標示 `unreadable`，popup 顯示「這次同步讀到 N 張券，但全部無法解析，已保留上次的資料」 |
| 最外層是 `[]`，本機原本有券 | 可能未登入，也可能券都用完了 | **保留**，標示 `empty`；popup 顯示「這次同步沒有讀到任何券。如果你已登入而且券確實都用完了，按『清空本機的券』」 |
| 最外層是 `[]`，本機原本沒有券 | 成功 | 不變 |
| 最外層不是陣列 | API 改版 | 保留，標示失敗 |

> 一次網路錯誤或一次登出，都不能把本機的券清空。未登入時 fetch 的實際行為（HTML、`opaqueredirect`、例外，或 200 加 `[]`）列入 §10.3 驗證。
> 已過期的券在同步時照存（顯示用），試算時才排除（§12.1）。

**同步排程**：background 的 `requestCouponSync(sender)` 處理 `shouldSyncCoupons`，整段在 §4.2 的 Promise 佇列裡執行，步驟如下：
1. `couponSyncLock` 存在而且還沒過期 → 回覆「不同步」（其他分頁正在同步）。
2. `pendingManual` 存在、`tabId === sender.tab.id`、還沒過期 → 這次是「立即同步」，略過第 3 步，並把 `pendingManual` 作廢。`pendingManual` 是唯一能略過 6 小時檢查的來源（F14）。
3. 距離 `couponSync.lastSuccessAt` 不到 6 小時 → 回覆「不同步」。
4. 產生一次性的 `syncToken`（`crypto.randomUUID()`），寫入 `couponSyncLock: { token, tabId: sender.tab.id, documentId: sender.documentId, expiresAt: 現在 + 2 分鐘 }`，回覆 token。這筆紀錄同時就是同步鎖。
- `couponSyncResult` 必須帶同一個 `token`，而且 `sender.tab.id`、`sender.documentId` 一致才接受，接受後立即刪掉 `couponSyncLock`。沒有經過允許、token 不符、或重複送同一個 token 的結果一律丟棄（不影響現有的鎖）。

> ⚠️ **不要呼叫 `GET /home/mypage/coupon`**（少了 `/list/ajax`）。這是**領券**端點，實測打開會嘗試發券（這次因為沒有可領的券而顯示「クーポン発行 エラー」）。§3.4 的行為測試會擋住這個網址。

### 5.5 日期解析規則（`lib/dates.ts`）
- DLsite 的日期字串一律視為 **JST**。`parseJst()` 處理 `YYYY-MM-DD HH:mm:ss`：
  1. 用 `^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$` 嚴格比對。
  2. 用 `Date.UTC(y, m − 1, d, h, mi, s) − 9 × 3,600,000` 算出時間。
  3. 把結果加回 9 小時，用 `getUTC*()` 換算回年月日時分秒，必須和原字串完全相同，而且 `h ≤ 23`；不同就當作解析失敗。（直接交給 `new Date()` 會把 `02-30` 變成 3/1、`24:00` 變成隔天，而且不報錯。）
- **禁止把沒有時區的字串直接丟給 `new Date()`**：在台灣時區，`new Date("2026-11-28 23:59:59")` 會被當成本機時間，比 JST 晚 1 小時。除了 `lib/dates.ts`，其他檔案禁止單一參數的 `new Date(x)` 與 `Date.parse`，用 ESLint `no-restricted-syntax` 強制。
- 本機一律存 UTC 的 ISO 字串，顯示時轉成使用者時區，可以加註「日本時間 12/3 00:58」。
- `limit_date`：Unix 秒，schema 用 `z.number().int().min(946684800).max(4102444800)`（2000～2100 年），乘 1000 後轉 ISO。超出範圍只讓這張券解析失敗，不會讓整次同步失敗。`expiresAt = min(limit_date, end_date)`；`limit_date` 為 `null` 時用 `end_date`；兩者都沒有就當作這張券解析失敗。
- `discount_end_date`（`MM/DD HH:mm`）：
  1. 用 `^(\d{2})\/(\d{2}) (\d{2}):(\d{2})$` 比對。
  2. 以 `checkedAt` 在 JST 的年份 `y` 建立 `y − 1`、`y`、`y + 1` 三個候選，日期不存在的候選直接略過（例如非閏年的 2/29），取**最接近 `checkedAt`** 的一個。
  3. 選出的日期早於 `checkedAt`、而且相差不超過 7 天：這段折扣已經結束（CDN 快取的舊資料）。照存，`onSale` 為 false（§6.1）。
  4. 選出的日期早於 `checkedAt` 超過 7 天，或晚於 `checkedAt + 180 天`，或三個候選都不存在：當作「截止時間不明」，`discountEnd` 省略，不顯示也不觸發 `ending`。（「取最接近」會讓半年以後才結束的長期折扣選到去年的日期，所以早太多的一律當作不明。）
  5. 如果 API 回傳含年份的完整格式，直接用 `parseJst()` 解析。
- DLWatcher 的日期用 `parseDlwatcherDate()`（格式在 M3 確認，§5.2）。
- 單元測試：
  - 2026-12-30 查價看到 `12/31 23:59` → 2026-12-31
  - 2026-12-30 查價看到 `01/02 23:59` → 2027-01-02
  - JST 2027-01-01 00:30 查價看到 `12/31 23:59`（CDN 快取的舊資料）→ 2026-12-31（已結束）
  - 2026-11-23 查價看到 `11/20 13:59` → 2026-11-20（已結束）
  - 2027-12-20 查價看到 `02/29 23:59` → 2028-02-29
  - 2027-03-01 查價看到 `02/29 23:59` → 不明
  - 2026-06-01 查價看到 `12/15 23:59`（197 天後結束的長期折扣）→ 不明
  - `parseJst('2026-02-30 00:00:00')`、`parseJst('2026-11-28 24:00:00')` → 解析失敗
  - `2026-11-28 23:59:59` 在 `TZ=Asia/Taipei` 下解析成 `2026-11-28T14:59:59.000Z`
  - `limit_date: 1796227116` → `2026-12-02T15:58:36.000Z`；`limit_date: 1796227116000`（誤當毫秒）→ 這張券解析失敗

---

## 6. 通知規則

| 規則 | 條件（`RuleState.active`） | 通知時機 | 去重 key | 預設 |
|---|---|---|---|---|
| `sale` | `onSale` | 不成立→成立（新的一段優惠時重新上膛） | `[id, 'sale', episodeKey]` | 開 |
| `target` | 現價 ≤ 目標價 | 不成立→成立 | `[id, 'target', targetPrice, episodeKey ?? 跌破目標價的 JST 日期]` | 開 |
| `lowest` | `onSale` 而且現價 ≤ 史低基準 | 不成立→成立（新的一段優惠時重新上膛） | `[id, 'lowest', episodeKey]` | 開 |
| `ending` | `onSale`、`discountEnd − 現在 ≤ 24 小時`，而且**你開啟的** `sale`／`target`／`lowest` 至少一條的條件成立 | 不成立→成立（新的一段優惠時重新上膛）；**可以單獨發** | `[id, 'ending', episodeKey]` | 開 |
| `deeper` | （事件）`onSale`、不是新的一段優惠，而且 `discountRate` 大於 `episode.maxRate` | 每次創新高 | `[id, 'deeper', episodeKey, discountRate]` | 關 |
| `couponExpiring` | 券在 7 天內到期，而且追蹤清單裡至少一件作品適用這張券（用 §12.2 的 `E(c, {p})` 判斷） | 不成立→成立 | `['coupon', coupon.key, expiresAt]` | 開 |

- 本表與儀表板、試算說的「打折中」都是 `onSale`，由 `lib/rules.ts` 的 `isOnSale(snapshot, now)` 統一計算：`onSale = isDiscount && !(discountEnd && discountEnd ≤ now)`。
- `episodeKey` 一律是 `PriceSnapshot.episode.key`（建立後不重算）。
- 每條規則可在設定裡開關（`Settings.rules`）。

### 6.1 處理步驟
每次查價，每件作品依序處理（`lib/rules.ts`，單元測試照這個順序寫）：
1. 驗證、轉換 API 資料，得到本次快照 `s`。查不到時 `s.available = false`，價格欄位沿用上一次，`onSale` 為 false。
2. 計算 `onSale = isOnSale(s, 現在)`。
3. **決定 `episode`**：
   - `onSale` 為 false → 清掉 `episode`。
   - `onSale` 為 true，而且符合下列任一情況 → **新的一段優惠**，`episode = { key: campaignId ?? discountEnd ?? 'start:' + 這次的 JST 日期, startedAt: 現在, maxRate: s.discountRate }`：
     - 上次沒有 `episode`（打折從無到有）。
     - `campaignId` 兩邊都有值而且不同。DLsite 常有一檔活動結束、下一檔馬上開始，6 小時查一次可能看不到中間沒打折的時刻。
     - `campaignId` 為空，而且 `discountEnd` 往後延超過 7 天。
   - 其他情況沿用上次的 `episode`。
   （`campaignId`、`discountEnd` 的空字串在解析時已轉成 `undefined`，§3.2.3。）
4. **計算每條規則的條件**。`lowest` 的史低基準 = min(DLWatcher 史低, 自己紀錄中 `at` 早於 `episode.startedAt` 的最低價)，只計算 `status`、`origin` 都為空的紀錄（§3.6）。不能把這次的價格算進基準，否則條件永遠成立。沒有任何先前紀錄、DLWatcher 也沒有資料時，`lowest` 不成立。原價永久調降不算 `lowest`，v1 不通知（儀表板照常顯示）。
5. **新的一段優惠時**，`sale`、`lowest`、`ending` 的上次結果一律視為不成立。`target` 不重設，因為它看的是價格，不是活動。
6. **`baselineAt` 為空**（剛加入追蹤，不論從哪裡加入；或暫停後恢復）：把第 3 步的 `episode` 與第 4 步的條件結果寫進 `PriceSnapshot.episode` 與 `RuleState`，設定 `baselineAt`，**不發任何通知**，跳到第 9 步。之後的查價才依狀態轉換通知。
7. **列出候選**：規則開啟、條件成立、上次不成立 → 候選。`deeper`：`onSale`、不是新的一段優惠、`s.discountRate > episode.maxRate` → 候選。最後更新 `episode.maxRate = max(episode.maxRate, s.discountRate)`。
8. **去重與合併**：候選的去重 key（`JSON.stringify([...])`，不直接串接字串，`'1' + '00abc'` 和 `'100' + 'abc'` 會撞在一起）不在 `notified` 裡才送出。同一件作品的多條規則合併成一則，內文列出全部；多件作品再合併成一則（「3 個追蹤作品正在特價」）。
9. **寫回**：依 §4.2「寫入與通知的先後」，先寫入 `snapshots`、`ruleState`、`notified`、`recentNotifications` 與 `priceLog`，再呼叫 `chrome.notifications.create`。

- `couponExpiring` 在每次同步券後與每天的排程各判斷一次，同樣只在不成立→成立時通知。
- `notified` 超過 180 天的紀錄在每次排程時刪除。
- 單元測試至少包含：
  - 加入時已在打折 → 之後兩次查價都沒有通知；打折結束再開始才通知。
  - 原價 ¥2,000；第一檔活動 c1 ¥1,000 → 通知「特價＋史低」；6 小時後接著第二檔 c2 ¥800（新史低）→ 通知「特價＋史低」。
  - 同一段優惠中 `discountRate` 20% → 30% → 30% → 只在第一次變成 30% 時發 `deeper`。
  - 已結束的快取資料（§5.5 第 3 步）→ `onSale` 為 false，不發 `sale`。

### 6.2 通知內容與點擊
- 標題固定為「DL_Assistant」加規則名稱（例如「DL_Assistant：特價」），避免作品名稱冒充系統通知。
- 作品名稱與券名（`couponExpiring` 會顯示合作網站填寫的券名）放進通知前，用 `s.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '').replace(/\s+/g, ' ').trim()` 清理（去掉控制字元，以及 U+202E 從右到左覆寫、零寬字元等格式字元；U+2028／U+2029 在 regex 字面裡一定要用 `\u` 跳脫寫法，直接放字元會是語法錯誤）。再用 `Array.from(s).slice(0, 60).join('')` 截斷到 60 個字元（`s.slice()` 會切斷 emoji 等補充平面字元）。移除 `Cf` 也會拆開用 ZWJ 組成的 emoji，只影響顯示，可以接受。
- 設定頁提供「通知不顯示作品名稱」（只顯示「1 個追蹤作品正在特價」），並提醒 Windows 鎖定畫面與通知中心可能顯示通知內容。
- 內文：作品名稱、現價／原價、折扣、和史低差多少、截止時間。
- 通知一律用擴充功能內建圖示，不顯示作品縮圖（`iconUrl` 用遠端網址不可靠，service worker 也不能產生 blob URL）。
- `notificationId` 對應到 `RecentNotification.ids`。單一作品時用 `buildWorkUrl()` 開啟作品頁（§3.4）；多件合併時開啟 `dashboard.html?n=<notificationId>`，儀表板驗證 `n` 是 `recentNotifications` 裡存在的 ID 後才篩選。
- popup 與儀表板顯示「最近的通知」，系統通知被 Windows 擋掉時也看得到。設定頁加一句：「如果收不到通知，請確認 Windows 設定 → 系統 → 通知裡的 Google Chrome 已開啟。」
- 儀表板提供「等待建議」：如果現價比史低高、而且這個作品一年有超過 150 天在打折，就標示「通常還會更便宜」。

---

## 7. 技術棧

| 類別 | 選擇 | 理由 |
|---|---|---|
| 平台 | Chrome Extension **Manifest V3** | Chrome 現行唯一支援的格式；Edge 也可以直接安裝 |
| 擴充功能框架 | **WXT** | 自動產生 manifest、處理 MV3 service worker、開發時熱重載，比手寫設定省事很多 |
| 語言 | **TypeScript** | 兩個 API 都是非官方的，型別加上 schema 驗證能及早抓出格式變動 |
| UI | **React** | 儀表板有表格、篩選、圖表，用元件寫比較好維護；預設跳脫可以防 XSS |
| 樣式 | **Tailwind CSS** | 快速做出儀表板版面，不用另外寫 CSS 檔 |
| 圖表 | **Chart.js**（＋`chartjs-adapter-date-fns`） | 階梯折線圖很適合畫價格走勢，輕量、文件完整 |
| 資料驗證 | **zod** | 驗證 API 回應，欄位變動時明確報錯 |
| 本機儲存 | `chrome.storage.local`（設定、清單、快照）＋ **IndexedDB**（透過 `idb` 套件，存歷史與查價紀錄） | 小資料用 storage 比較簡單；歷史資料量較大，放 IndexedDB |
| 排程 | `chrome.alarms` | MV3 service worker 會休眠，只能用 alarms 喚醒 |
| 通知 | `chrome.notifications` | 直接顯示 Windows 原生通知 |
| 測試 | **Vitest**（單元測試：API 解析、白名單、通知規則、日期換算、試算） | 和 WXT／Vite 整合，不用額外設定 |
| 套件管理 | **pnpm** | 安裝快、省空間 |
| 程式碼品質 | ESLint ＋ Prettier | 加上 §3.2.1、§3.4、§5.5 要求的規則 |

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
- 這整條 CSP 是否被 Chrome 接受並生效（擋住測試頁裡的 `<form>` 送出、外部 CSS、`/home/mypage/coupon` 的連線），M1 時確認（§10.3）。

### 7.2 建置與供應鏈
- zod：使用 zod 4。zod 4 原始碼的 `$ZodConfig` 有 `jitless` 選項，`allowsEval` 是第一次需要時才計算並快取，所以只要在**第一次 parse 之前**呼叫 `z.config({ jitless: true })` 就有效。`lib/zod-setup.ts` 只做這件事，每個進入點（background、content script、各個擴充功能頁面、worker）的第一個 import 就是它。M1 在擴充功能頁面監聽 `securitypolicyviolation` 事件、background 看 console，跑一次完整的解析測試，確認沒有任何 CSP 違規。
- 發佈前檢查 `.output/chrome-mv3/manifest.json`：沒有 `localhost`、沒有 `unsafe-eval`、`content_security_policy` 與 §7.1 一致、`minimum_chrome_version` 存在、沒有 `web_accessible_resources`。這一步寫成 `scripts/check-manifest.ts` 放在 CI（WXT 開發模式會放寬 CSP，不能把 dev build 拿去發佈）。
- 同一支腳本也掃描 `.output/chrome-mv3/**/*.js`：
  - 不能出現 `new Function`、`eval(`。
  - 字串裡出現的 `https://` 網域只能是 `www.dlsite.com`、`img.dlsite.jp`、`dlwatcher.com`（套件內建的說明網址另列白名單）。
  - 不能出現 `/mypage\/coupon(?!\/list\/ajax)/`、`/home/buy` 與加入購物車的路徑（§3.4 第 4 層）。
  - content script 打包檔的套件清單與上一版比對（§3.2.5）。
- `package.json` 用 `packageManager` 固定 pnpm 11 的某個版本。`pnpm-lock.yaml` 進版控；CI 用 `pnpm install --frozen-lockfile`；每次升級套件跑 `pnpm audit`。
- `pnpm-workspace.yaml` 明確寫出：
  - `minimumReleaseAge: 1440`（發佈未滿 1 天的版本不安裝，降低剛被植入的惡意版本被升級進來的機會；pnpm 11 預設就是 1440，明確寫出避免日後預設改變）。
  - `trustPolicy: no-downgrade`（套件的信任等級下降時安裝失敗，例如原本有 provenance、新版沒有）。
  - `strictDepBuilds: true`，需要 build script 的套件寫進 `allowBuilds`（pnpm 11 以此取代 `onlyBuiltDependencies`）。
  - 若最後固定在 pnpm 10，改用 `onlyBuiltDependencies`，並確認 `minimumReleaseAge`、`trustPolicy` 的最低支援版本（§10.3）。
- GitHub Actions 的 action 一律用 commit SHA 固定版本。
- 不使用任何從 CDN 或遠端載入程式碼的功能（包含 WXT 的遠端模組匯入）。
- 第二階段的 GitHub Actions 若要推播到 Discord／Telegram，webhook 網址存在 repo secrets，不寫進程式碼。

---

## 8. 專案結構（預定）

```
DL_Assistant/
├─ SPEC.md
├─ wxt.config.ts
├─ package.json
├─ eslint.config.js             # §3.2.1、§3.2.5、§3.4、§5.5 要求的規則
├─ scripts/check-manifest.ts    # 發佈前檢查 manifest 與打包結果（§7.2）
├─ src/
│  ├─ entrypoints/
│  │  ├─ background.ts          # 排程、查價佇列、通知、唯一的 storage 寫入者
│  │  ├─ dlsite.content.ts      # 偵測加入購物車、購物車 DOM、作品頁徽章、優惠券同步（不用 React，import 白名單見 §3.2.5）
│  │  ├─ popup/                 # 優惠摘要、查詢這個作品、立即同步、最近的通知
│  │  ├─ dashboard/             # 儀表板（表格＋走勢圖＋最近的通知）
│  │  ├─ planner/               # 購買試算頁面
│  │  └─ lookup/                # 右鍵查史低的小視窗（F13）
│  ├─ lib/
│  │  ├─ zod-setup.ts           # 只做 z.config({ jitless: true })；每個進入點的第一個 import（§7.2）
│  │  ├─ api/endpoints.ts       # apiGet、assertAllowed、端點表、呼叫環境檢查；唯一可以呼叫 fetch 的檔案
│  │  ├─ api/dlsite.ts          # 商品 API 的 zod schema 與轉換
│  │  ├─ api/dlwatcher.ts       # DLWatcher 的 zod schema 與轉換
│  │  ├─ coupons/parse.ts       # 優惠券 API 回應解析（zod、price_sum 正規化、逐筆驗證）
│  │  ├─ coupons/sync.ts        # 同步結果判斷（§5.4 表格）
│  │  ├─ ids.ts                 # isWorkId、從網址取作品編號、buildWorkUrl
│  │  ├─ nav.ts                 # DlsiteNavUrl 品牌型別、openTab、openPopupWindow、固定的網址常數；唯一可以開分頁／視窗的檔案（§3.4）
│  │  ├─ text.ts                # htmlToText（DOMParser，只在 content script 使用）
│  │  ├─ messages.ts            # 訊息的 zod schema 與來源檢查（§3.2.4）
│  │  ├─ lookup.ts              # 臨時查史低（session 快取）
│  │  ├─ queue.ts               # 查價佇列與退避狀態（§4.1）
│  │  ├─ planner/optimize.ts    # 分單＋用券最佳化（§12）
│  │  ├─ planner/worker.ts      # 件數多時在 Web Worker 裡計算
│  │  ├─ storage.ts             # storage / IndexedDB 存取層（寫入只在 background）
│  │  ├─ rules.ts               # isOnSale、通知規則引擎（§6.1 的處理步驟）
│  │  ├─ dates.ts               # parseJst、isCanonicalIso、補年份、parseDlwatcherDate、走勢點換算日期（§5.5）
│  │  └─ selectors.ts           # DLsite DOM 選擇器與頁面文字的 regex（集中管理）
│  └─ components/               # 共用 React 元件（只用於擴充功能頁面）
│     ├─ WorkLink.tsx           # 作品頁連結；唯一可以寫 <a href> 的兩個元件之一（§3.4）
│     └─ NavLink.tsx            # nav.ts 常數的連結
└─ tests/                       # Vitest 測試；fixtures/ 放去識別化的 API 回應範例
   └─ lint-fixtures/            # 每一種違規寫法的範例檔，CI 確認 ESLint 都會報錯（§3.4）
```

---

## 9. 開發里程碑

**通則**：每個里程碑完成時，它涉及的章節裡列出的單元測試全部通過並放進 CI；§10.3 標為這個里程碑的項目都已確認並把結果寫回規格。

| 階段 | 內容 | 完成標準 |
|---|---|---|
| M1 骨架 | WXT 專案、`zod-setup.ts`、ESLint 規則與 `tests/lint-fixtures/`、`apiGet` 與白名單、`nav.ts` 與連結元件、`Settings` 與 storage 存取層、background 呼叫商品 API 查價、手動加入追蹤（`track` 訊息） | 在 popup 手動加一個作品，看得到現價；`assertAllowed` 行為測試、lint 自我測試、`isWorkId`／`buildWorkUrl`／`intIn`／商品 API 的 `"__proto__"` key 測試通過；manifest 檢查腳本通過；CSP 與 `minimum_chrome_version` 被 Chrome 接受 |
| M2 自動追蹤 | content script（原生 DOM、import 白名單）偵測加入購物車、購物車 DOM 同步、訊息白名單與來源檢查 | 在 DLsite 加入購物車後，追蹤清單自動多一筆；非 `isTrusted` 的點擊不會加入；content script 打包檔不含 React；訊息來源的拒絕案例測試通過 |
| M3 史低 | DLWatcher 串接、歷史資料存 IndexedDB、自己的 `priceLog`、合理性檢查、查價佇列與退避 | 每個追蹤作品都有史低和期間；在設定關閉 DLWatcher 後，史低與走勢改用自己的紀錄；查價途中 service worker 被終止，重啟後能接著做；「可買 → 查不到 ×3 → 可買（同價）」得到 3 筆紀錄；「關瀏覽器 3 天、前後同價」得到 2 筆紀錄，中間畫虛線 |
| M4 通知 | alarms 排程、§6.1 的處理步驟、去重 | 作品打折時收到一次通知；回到原價後再次打折會再通知；§6.1 列出的 4 個測試情境通過 |
| M5 儀表板 | 表格、走勢圖、等待建議、最近的通知 | 一頁看完所有追蹤作品的價格狀況；`dashboard.html?n=` 帶不存在的 ID 時不篩選、不報錯 |
| M6 作品頁徽章與臨時查詢 | 作品頁史低徽章、「查史低」按鈕、popup 查詢、右鍵選單與 `lookup.html` | 未追蹤的作品也查得到史低，而且追蹤清單沒有多出東西；開啟 10 個作品頁（含未追蹤），開發者工具的網路面板裡擴充功能沒有發出任何請求 |
| M7 優惠券同步 | content script 呼叫優惠券 API、`requestCouponSync` 與同步鎖、立即同步、到期提醒 | 在任一 DLsite 頁面觸發同步後，擴充功能裡的券和「マイページ → クーポン管理」顯示的一致；`[]`、全部解析失敗、未登入三種情況本機的券都保留；重複送同一個 `syncToken` 被拒絕 |
| M8 購買試算 | 先確認 WXT 能打包 Web Worker；§12 最佳化演算法、試算頁面、比較表 | 用 10 件作品＋3～5 張券（含一次性券）測試，結果和暴力窮舉一致；1 張可重複使用券配 4 件作品得到 1 單；實測 n = 15、`k′` = 0／4／8 的計算時間並記錄 |
| 第二階段（選做） | Python ＋ GitHub Actions 每日查價，推播到 Discord / Telegram；試算超過 15 件時的近似解 | 瀏覽器沒開也收得到通知 |

---

## 10. 待驗證事項（實作前要先確認）

| 項目 | 要確認的事 |
|---|---|
| 加入購物車按鈕 | 各分站（maniax、home、books…）按鈕的 DOM 結構是否一致；是否用 AJAX 加入、不換頁；加入購物車是不是 GET 連結 |
| 列表頁的加入購物車按鈕 | 搜尋、排行榜頁的按鈕結構，以及作品編號在哪個元素 |
| 購物車頁面 | 網址與作品編號在 DOM 裡的位置 |
| 分站差異 | 用 `maniax` 路徑查 `home` 的作品是否都查得到（目前實測可以） |
| 預購與套組作品 | `is_reserve_work`、套組作品的價格欄位是否不同 |
| `discount_end_date` | 用年底跨年的活動實測 §5.5 的補年份規則 |
| DLWatcher 覆蓋率 | 冷門或新作品是否查得到（查不到時只用自己的紀錄） |
| ~~優惠券頁面~~ | ✅ 已確認：有 JSON API，見 §5.4 |
| **用券規則**（試算正確性的關鍵） | 見 §10.1 與 §10.2 |
| ~~作品類型欄位~~ | ✅ 已確認：商品 API 有 `site_id`、`work_type`、`custom_genres` |
| まとめ買い（組合折扣） | API 的 `bulkbuy_key` 代表有組合折扣活動，v1 試算先不計入，只提示「這幾件有組合折扣」 |

> 用券規則會先從 DLsite 的說明頁與優惠券頁面上的文字確認，再用購物車實際操作驗證（由你自己操作）。§12 的演算法把這些規則都做成參數，確認後只要改設定，不用改演算法。

### 10.1 已確認的用券與點數規則（2026-11-23，來源：DLsite ユーザーヘルプ）

| # | 規則 | 官方說法（摘要） | 對試算的影響 |
|---|---|---|---|
| ① | **一筆結帳只能用 1 張券，不能併用** | 「1決済につき1枚のみ」 | 確認分單有意義：想用兩張券就要分兩次結帳 |
| — | **券和點數可以一起用** | 「ポイントとクーポンは併用いただけます」 | 點數最後扣，不影響怎麼分單 |
| — | **折扣逐件計算、尾數無條件捨去** | 「作品ごとに割引金額を算定し、端数が出た場合は原則切捨て」（商業電子書籍依出版社規則） | 折扣率券的折扣是 `Σ floor(單價 × 折扣率)`，不是 `floor(小計 × 折扣率)`；用整數運算（§12.2） |
| — | **適用條件的種類** | 指定作品、指定樓層（同人／PCソフト・美少女ゲーム／電子書籍）、指定作品形式（マンガ・CG・イラスト／ボイス・ASMR／ゲーム）、最低金額、**一起購買的件數** | 資料模型有 `floors`、`workFormats`、`minItems` |
| — | 券的條件在「マイページ → クーポン管理」查看，可依樓層篩選，R18 券要勾選「男性向け(R18)クーポンを表示」才會出現 | | 這是網頁的顯示方式；API 一次回傳全部，不需要切換 |
| ⑥ | **點數回饋只限特定付款方式**（目前是「みんなの銀行」「viviONカード」），回饋按扣掉券與點數之後的金額計算 | 「ポイント・クーポン利用分を差し引いた金額に対して還元」 | 大多數人用券後拿不到點數。試算預設**不把點數當比較條件**，設定裡勾選「我用特定付款方式」才計入 |
| — | 點數 1 點 = 1 圓，最後一次取得或使用點數後 1 年全部失效 | | v1 不讀點數餘額，只在說明裡提醒 |
| — | 結帳失敗時，券約 30 分～3 小時後自動退回 | | 試算頁提示：結帳失敗不用擔心券被吃掉 |

以下來自優惠券 API 的實際資料（2026-11-23，帳號持有 7 張券：6 張可重複使用的折扣率券＋1 張一次性定額券）：

| 規則 | 實際資料 | 對試算的影響 |
|---|---|---|
| **大部分券可以重複使用** | 7 張中 6 張是 `is_multiple_use: true`，說明寫「有効期間中、お一人様何回でも利用できます」 | 演算法不能假設「一張券只能用一次」。可重複使用的券，每一單都能用（但每單仍然只能用一張） |
| **適用範圍靠活動分類比對** | `condition_type: custom_genre` 的券，比對作品的 `custom_genres`；`site_ids` 型的券比對作品的 `site_id` | 不用猜作品屬於哪一類，直接比對商品 API 的欄位就能判斷 |
| **只有適用的作品會打折** | 「割引対象作品を複数ご購入の場合、全てに割引が適用されます」 | 同一單裡不適用的作品照原價，折扣只算適用的那幾件 |
| **單價上限** | `maximum_applicable_price: 2749`：「同人フロアの作品では、税込2,749円までがクーポン対象」，其他樓層沒有上限 | 單價超過上限的同人作品不能用這張券 |
| **最少件數** | `post_condition.count: 3`：「割引対象作品を3本以上ご購入の場合」 | 要湊滿 3 件適用作品，這張券才有效 |
| **打折中能不能用券，每張券不同** | 有些券寫「割引中の作品にも適用出来ます」或名稱標【割引併用可】，有些沒寫 | 沒寫的當作「未知」，試算時用警告標示，不直接當成可用 |
| **折扣是用現價（特價）計算** | 「割引中の作品にも適用」的券，折扣以作品當下價格計算 | 試算用 API 的 `price`，不是 `official_price` |

### 10.2 還沒確認的用券規則（要你在購物車操作一次才能確定）

| # | 問題 | 目前的預設 | 驗證方式 |
|---|---|---|---|
| a | 「單價上限 2,749 円」是**超過就整件不適用**，還是**只算到 2,749 円**為止 | 超過就不適用 | 把一件 3,000 円以上的同人作品放進購物車，看 15% 券的折扣金額 |
| b | 沒寫「割引中にも適用」的券，能不能用在打折中的作品 | 未知，標示警告 | 購物車選券時看折扣有沒有算進去 |
| c | `price_sum`（金額門檻）看的是適用作品小計還是整單 | `payment` 型：見 h；其他型：適用作品小計 | 折扣率券目前門檻都是 0，等有門檻的折扣率券再驗證 |
| d | `post_condition.price: 1` 的意思 | 忽略 | 等有不同數值的券再比對 |
| ~~e~~ | ~~定額券的 `discount_type` 值~~ | ✅ 已確認是 `"price"`（見下方） | |
| f | 商品 API 的 `is_noreduction` 是不是「不能用券」 | 是 | 找一件 `is_noreduction: true` 的作品放進購物車確認 |
| g | 定額券在同一單裡怎麼分攤到各作品 | 整單折抵，不逐件分攤 | 只影響點數回饋的計算，預設不比點數，所以優先度低 |
| h | `payment` 券的門檻與折抵上限，是否只計算 `distribute_targets` 樓層內的作品 | 只計算樓層內的作品；樓層外的作品可以放在同一單，但不算進門檻 | 放一件樓層外的作品湊門檻，看券能不能選 |
| i | `limited_usage_count` 是「已用次數」還是「剩餘次數」 | 兩個欄位都有值時，剩餘 = `max(0, limit − count)`，試算頁標示「次數依推測計算」 | 等有限次券時，用一次前後各同步一次比對 |
| j | 指定作品形式的券，API 用哪個欄位表示 | 沒有這個欄位就不限制形式 | 等有這類券時看 API 回應 |
| k | `payment` 型的折扣率券（`kind: 'rate'`）怎麼計算 | 目前沒有實例，標成 `plannerUsable: false` | 等有這類券時看購物車金額 |
| l | 同一種券有多張時，API 是否回傳多筆相同的 `coupon_id` | 以 `Coupon.key` 區分，不合併 | 等領到兩張同樣的券時同步比對 |
| m | 樓層旗標（`is_*_coupon`）和 `site_ids`／`distribute_targets` 不一致時以哪個為準 | 以 `site_ids`／`distribute_targets` 為準，旗標只用於顯示 | 等遇到不一致的券時看購物車能不能選 |
| n | `is_affect_to_payment` 對折扣率券的意義，和 `condition_type: payment` 不一致時以哪個為準 | 以 `condition_type` 為準，`affectsPayment` 只顯示 | 等有實例時比對購物車金額 |
| o | `payment` 券的 `minItems` 是否只算樓層內的作品 | 只算樓層內、通過排除規則的作品（和 `B` 相同） | 等有件數條件的 `payment` 券時確認 |

> 驗證時只需要把作品放進購物車、在「購入内容の確認」頁選券看金額，**不用真的結帳**。

**定額券實例（優惠券 API 實測，2026-11-23）**

| 欄位 | 值 | 說明 |
|---|---|---|
| `coupon_id` | `ovs_out_100p_silveryellow_202610` | 也是頁面上 `.coupon_list_item` 的 DOM id |
| `coupon_name` | 【黃遊宅之道獨家優惠】400日圓 折抵優惠券 | 合作網站發的券 |
| `discount_type` / `discount` | `price` / `"400"` | 定額折抵 400 日圓 |
| `condition_type` | `payment` | 整筆結帳折抵，說明寫「此優惠券可用於所有作品」 |
| `conditions.price_sum` | `[1200]` | 滿 1,200 日圓才能用（**陣列**，折扣率券是數字 0） |
| `is_multiple_use` | false | 說明寫「每位會員僅限使用一次」 |
| `is_affect_to_payment` | true | 折抵的是結帳總額 |
| `distribute_targets` | 同人、女性向、漫畫、遊戲、手機遊戲、AI 生成等 15 個樓層 | 這些樓層的作品都適用 |
| `end_date` / `limit_date` | 2026-12-31 / 2026-12-03 00:58:36（JST） | 實際到期以 `limit_date` 為準（領券後 10 天），頁面上顯示的也是這個 |

對設計的影響：
- 一次性的券確實存在，§12.2 的限次券那層 DP 是必要的，不能省。
- `payment` 型的券：門檻看這一單裡樓層內作品的小計，折抵 `min(面額, 該小計)`。所以不適用其他券的作品也可以放進這一單，幫忙湊滿 1,200。
- 到期時間依 §5.5 取 `min(limit_date, end_date)`。如果只用 `end_date`，這張券會被當成多活 28 天，到期提醒就會錯。
- 頁面 HTML 只有顯示用的文字，**解析一律用 §5.4 的 JSON API**，不解析優惠券頁面。

### 10.3 實作時要確認的平台行為

| 項目 | 要確認的事 | 時機 |
|---|---|---|
| 收緊的 CSP | §7.1 的整條 `extension_pages` CSP（`default-src`、`form-action`、路徑限定的 `connect-src`、`object-src 'none'`）是否被 Chrome 接受並生效：測試頁的 `<form>` 送出、外部 CSS、對 `/home/mypage/coupon` 的 fetch 都要被擋。（是否也約束 service worker：文件已確認會） | M1 |
| `minimum_chrome_version` | manifest 被接受 | M1 |
| `externally_connectable` | 文件已確認留空代表沒有任何連線；M1 只確認 manifest 被接受 | M1 |
| zod 4 | ✅ 原始碼已確認有 `jitless`，第一次 parse 之前呼叫即可（§7.2）；M1 只確認沒有 CSP 違規 | M1 |
| fetch 與 User-Agent | 確認 fetch 無法覆寫 User-Agent（只是確認，規格已不自訂） | M1 |
| pnpm | 固定的主版本；若是 pnpm 10，`minimumReleaseAge`、`trustPolicy` 的最低支援版本 | M1 |
| service worker 的 `location` | `ServiceWorkerGlobalScope` 與 `location.protocol` 的檢查在 WXT 輸出的 background 裡成立（§3.4） | M1 |
| 作品編號 | 前綴清單（`RJ`、`RE`、`BJ`、`VJ` 之外還有哪些）、分站列舉值的完整清單；用 `maniax` 路徑組作品頁網址是否都能開；手機版（`touch`）作品頁的網址格式（若含連字號，§3.2.2 的路徑 regex 與分站列舉值一起調整） | M1 |
| 擴充功能來源 | 在 Chrome 裡 popup、分頁中的儀表板、`lookup.html` 送訊息時 `sender.origin` 是否都是 `chrome-extension://<id>` | M1 |
| 商品 API | 回應最外層是以編號為 key 的物件還是陣列；沒有活動時 `campaign_id` 是 `null`、空字串還是不出現；不存在或已刪除的編號是不出現、`null` 還是整批錯誤（整批錯誤時用 §4.1 的拆半重試）；`product_id` 的逗號編碼成 `%2C` 是否接受 | M1 |
| content script 排除路徑 | 結帳、付款、帳號設定頁與購物車頁的實際路徑，寫進 `exclude_matches` 與 `selectors.ts`；加入購物車的實際路徑，寫進打包掃描（§3.4） | M2 |
| `onMessage` 非同步回應 | `return true`＋`sendResponse` 在 service worker 冷啟動時正常；`badgeInfo` 的實際回覆時間 | M2 |
| `sender.url` | `history.pushState` 之後是否跟著改變（影響 `cartSnapshot` 的頁面檢查；每日上限仍有效） | M2 |
| service worker | 單純等待 fetch 回應是否算活動（不算就靠 §4.1 的進度寫回） | M3 |
| DLWatcher 日期 | `start`／`end` 欄位的格式與時區（§5.2）；進行中的特價，`lowestPrice.priceInfo.end` 是未來的結束時間還是最後看到的時間（§3.6 合理性檢查） | M3 |
| `storage.local.set` 多個 key | 一次寫入多個 key 是否不可分割（§4.2） | M4 |
| DLsite 圖片 | `img.dlsite.jp` 是否檢查 Referer（會擋的話，擴充功能頁面改顯示預設圖） | M5 |
| 注入 UI 的樣式 | DLsite 頁面的 CSP 是否擋住 content script 插入 closed shadow root 的 `<style>`（被擋的話改用 `adoptedStyleSheets`） | M6 |
| 右鍵選單 | `targetUrlPatterns` 實際能否比對含 `/=/` 的作品網址 | M6 |
| 未登入時的優惠券 API | content script fetch 實際拿到 HTML、`opaqueredirect`、例外，還是 200 加 `[]`；登入但沒有券時是否回傳 `[]`；content script 的請求會不會經過 DLsite 頁面自己的 service worker | M7 |
| Resource Timing | content script 的優惠券請求是否出現在頁面的 `performance.getEntriesByType('resource')`（§3.3 隱私說明） | M7 |
| WXT worker | 能否正確打包 Web Worker（不行就用 §12.2 的備案） | M8 |

---

## 11. 風險

| 風險 | 影響 | 對策 |
|---|---|---|
| DLsite 改版或改 API | 查價或偵測購物車失效 | zod 逐筆驗證及早發現；選擇器集中管理；儀表板顯示「最後成功查價時間」 |
| DLWatcher 停止服務或改格式 | 沒有史低與歷史 | 自己保留查價紀錄；DLWatcher 失敗時改用自己的最低價；連續 7 天全部失敗就自動暫停 |
| DLWatcher 回傳格式正確但內容是假的（例如網域換了持有者） | 史低被壓低，`lowest` 不再通知、一直建議「等特價」 | §3.6 合理性檢查；DLWatcher 與自己的史低並列顯示 |
| DLWatcher 或優惠券說明含惡意內容 | XSS 打到已登入的 DLsite 頁面，或用網址追蹤使用者 | §3.2.1 只當純文字（`DOMParser`）；§3.2.2 URL 由程式自己組；zod 驗證；收緊的 CSP |
| 頁面腳本操控 content script | 假點擊、假作品編號、耗光請求額度、用 `pushState` 測出追蹤清單 | §3.2.4：`isTrusted`、訊息白名單、數量上限；§3.2.5：編號只在載入時決定、徽章固定大小、可關閉徽章 |
| 違反網站使用規範 | 被封鎖 | 低頻請求、批次查詢、尊重快取時間 |
| 瀏覽器關閉時沒查價 | 錯過短期特價 | 第二階段改用 GitHub Actions 每日查價 |
| 用券規則理解錯誤 | 試算建議實際上用不了或不是最省 | 規則參數化；試算結果標示「依目前規則設定」；結帳前請以 DLsite 購物車顯示的金額為準 |
| 優惠券 API 改版 | 同步失敗或讀錯券 | 逐筆驗證；同步後顯示券數量與無法解析的張數讓你核對；只有至少一張券解析成功才取代本機資料 |
| 誤觸帳號操作 | 改到帳號狀態 | §3.4：唯一的 `apiGet`、路徑完全比對、只有 `couponList` 帶 cookie；導覽只能用 `buildWorkUrl` 與 `nav.ts` 常數；注入 UI 不放網址；行為測試 |
| 匯入惡意檔案 | 假券、原型污染、追蹤網址 | §3.7：strict schema、不匯入券與圖片網址、`Map` 存放 |
| 供應鏈攻擊 | 被入侵的 npm 套件在擴充功能裡執行 | §7.2：lockfile、`strictDepBuilds`、`minimumReleaseAge`、`trustPolicy`、`pnpm audit`、打包結果掃描 |
| content script 的相依套件被入侵 | content script 的請求不受擴充功能 CSP 約束，惡意程式能以登入狀態對帳號端點發請求 | §3.2.5：content script 最小化（不用 React 等）、import 白名單、打包套件差異檢查；§7.2 打包路徑掃描 |

---

## 12. 購買試算演算法

### 12.1 問題定義
- 輸入：想買的作品 `P = {p1 … pn}`（n ≤ 15；每件有現價、原價、`couponFacts`、是否打折中、點數回饋率），以及持有的優惠券 `C`。
- 試算開始時排除這些券，並在畫面列出原因：`plannerUsable: false`、你勾選「留著不用」、`expiresAt ≤ 試算時間`（「已過期，未列入」）、`startsAt > 試算時間`（「尚未開始，未列入」）。
- 試算結果顯示「依 YYYY-MM-DD HH:mm 同步的券計算」；距離上次成功同步超過 24 小時時，提示先同步。
- 決策：把作品分成若干筆訂單，每筆訂單最多用一張券（官方已確認）。券分兩組：
  - **`R`：可重複使用的券**（`is_multiple_use: true` 且沒有次數限制）：每一單都可以用
  - **`L`：有次數限制的券**（`is_multiple_use: false`，或 `usage` 有值）：最多只能用剩下的次數
- 目標（依序比較）：
  1. **實付金額最低**（省下的金額最多）
  2. 金額相同時，**拿到的點數最多**（只有在設定裡勾選「我用特定付款方式」時才比較，見 §10.1 ⑥）
  3. 再相同時，**用掉的一次性券價值最低**：每用一次一次性或限次的券，成本是它的剩餘天數 + 1，總成本越低越好（可重複使用的券用了也不會少，不計成本）。因此兩張 3 天後到期的券，可能比一張 30 天後到期的券更優先被用掉。
  4. 再相同時，**訂單數最少**（結帳比較省事）

DLsite 是數位商品，沒有運費，所以多分幾單不會多花錢。這也是分單能省錢的原因：一單只能用一張券，但不同作品適用的券不一樣。例如 p1、p2 適用 30% 券，p3 只適用翻譯作品 20% 券，那就分成兩單，各用各的券。

### 12.2 計算方式

1. **券的分組與展開**
   - 剩餘次數 `uᵢ`：`is_multiple_use: false` 且 `usage` 為空 → 1；`usage` 有值 → `max(0, limit − count)`（§10.2 i）；`uᵢ = 0` 的券不使用。
   - `uᵢ ≥ n` 的限次券放進 `R` 計算（一張券最多用在 n 單，不必展開），但每用一次的保留分數和 `L` 相同（見第 3 步）。其餘 `L` 裡的券展開成 `uᵢ` 張一次性的券 `l₁ … l_{k′}`。

2. **單張券的效益 `save(c, S)`**（`S` 是一單裡的作品）
   - 適用作品 `E(c, S)`：符合 `eligibility`（`custom_genre` 有交集，或 `site_id` 在清單內）；`workFormats` 有值時 `work_type` 要符合；單價沒超過 `maxItemPrice`；不是 `noReduction`；打折中的作品，`appliesToDiscounted` 為 false 時排除，為 null 時依設定（預設排除並標示警告）。
   - 非 `payment` 型：`|E| < minItems` 或 `Σ_{E} 現價 < minSpend` → 0。
     - 折扣率券 → `Σ_{i∈E} floor(現價ᵢ × value / 100)`。**一律用整數運算**：寫成 `Math.floor(price * pct / 100)`，不能寫 `price * 0.35` 或 `price * (pct / 100)`（`180 × (35 / 100)` 會得到 62.999…，捨去後少 1 圓）。
     - 定額券 → `min(value, Σ_{E} 現價)`。
   - `payment` 型：門檻與折抵的基數 `B` = `S` 裡屬於 `eligibility.siteIds` 樓層、不是 `noReduction`、並且通過和非 `payment` 型相同的 `maxItemPrice` 與 `appliesToDiscounted` 排除規則的作品小計（§10.2 h；`appliesToDiscounted` 為 null 時依同一個設定處理並標示警告）。`B < minSpend` 或件數 `< minItems` → 0；否則折抵 `min(value, B)`。樓層外的作品可以放在同一單，但不算進 `B`。
   - `payment` 型且 `kind: 'rate'`：目前沒有實例，同步時就標成 `plannerUsable: false`（「整筆折抵的折扣率券，計算方式待確認」，§10.2 k）。
   - `floors` 樓層旗標不參與 `save`（§10.2 m）。
   - 先把所有券對所有子集合的 `save` 算好，存成 `Int32Array`（`(|R| + k′) × 2ⁿ`），DP 時直接查表。

3. **比較用的值**：每一單的值是 tuple `(省下金額, 點數, 保留分數, −1)`，可以直接相加；DP 的 `max` 用字典序比較。
   - 點數：只在勾選「我用特定付款方式」時計算，否則為 0。
   - **保留分數**：用一次性或限次的券 `c`（`L` 展開的券，以及第 1 步放進 `R` 的限次券）時為 `−(剩餘天數(c) + 1)`；用真正可重複使用的券或不用券時為 0。剩餘天數 = `max(0, floor((expiresAt − 試算時間) / 86,400,000))`，整數。
     一次性券用掉就沒了，所以「用掉」本身是成本，快到期的成本較低。省下金額相同時，依序偏好：不用一次性券 → 用快到期的 → 用期限長的。
   - 最後一項 `−1` 代表這一單算一筆訂單；比較時訂單越少越好。因為這一項，不用券的作品會自動併進其他訂單，不會單獨成一單。
   - ⚠️ 不能用「到期越近分數越高、每單都加」的寫法：同一張可重複使用的券每多一單就多加一次分數，DP 會把每件作品拆成一單，也會為了加分去消耗一次性券。

4. **只用 `R` 的分組 DP**：
   `bestR(S) = max( 不用券, max_{c ∈ R} val(c, S) )`
   `g[0] = 0`；`g[mask] = max_{sub ⊆ mask，sub 含 mask 的最低位} ( bestR(sub) + g[mask \ sub] )`
   **`g` 只用 `R` 裡的券**，不能用 `L` 的券，否則同一張一次性券會在好幾單裡各用一次。

5. **加上 `L` 的一次性券**：
   `f[0] = g`
   `f[i][mask] = max( f[i−1][mask], max_{∅ ≠ sub ⊆ mask} ( f[i−1][mask \ sub] + val(lᵢ, sub) ) )`
   答案是 `f[k′][全集]`。第 `i` 張一次性券要嘛不用，要嘛用在某一單 `sub`，剩下的作品交給前 `i−1` 張與 `R`。
   每個狀態記下選擇，最後回溯出每一單的作品與用券。

6. **規模與做法**：所有情況都跑 DP，不使用「每件作品各自挑券再合併」的捷徑（同分時挑哪張券會影響訂單數，捷徑做不到訂單最少；n = 15、沒有一次性券時 DP 實測約 125 ms，捷徑省下的時間沒有意義）。

| 作品數 n | 運算量（限次券展開後 k′ 張） | 做法 |
|---|---|---|
| ≤ 12 | `(k′+1) × 53 萬` | 試算頁直接算，通常不到 0.1 秒 |
| 13～15 | `(k′+1) × 160 萬～1,400 萬` | 放進 Web Worker 算，畫面不會卡住（實際時間 M8 實測） |

   - v1 試算上限 15 件（F15）。超過 15 件的近似解放到第二階段。
   - 完全相同的一次性券（`kind`、`value`、`eligibility`、門檻、`maxItemPrice`、`appliesToDiscounted` 都相同）只保留到期最早的 `min(張數, n)` 張，順序不影響結果，不必重複計算。
   - `k′ > 8` 而且 `n ≥ 13` 時，只用到期最早的 8 張一次性券計算，畫面標示「一次性券較多，只考慮最快到期的 8 張」。

   - 試算只在試算頁執行，不經過 background（service worker 不能建立 Worker）。Web Worker 用 `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` 建立。M8 第一步先確認 WXT 能打包 worker；不行就改成在主執行緒分段計算（每 50 ms 用 `setTimeout` 讓出一次），n 上限維持 15。

7. **點數折抵最後才扣**。如果使用點數不影響門檻（待驗證），點數用在哪一單都一樣，不會改變最佳分單。

### 12.3 輸出範例

假設持有三張可重複使用的券：
- A＝對象同人作品 30%OFF，適用打折中的作品
- B＝翻譯作品 20%OFF，適用打折中的作品
- C＝全站 15%OFF，**不適用打折中的作品**（同人單價 ≤ ¥2,749）

p1、p2、p4、p5、p7、p10 正在打折，所以 C 只適用 p3、p6、p8、p9。p10 不是 A、B 的對象，又在打折，所以三張券都不適用。

| 訂單 | 作品 | 小計 | 使用的券 | 折扣 | 實付 |
|---|---|---|---|---|---|
| #1 | p1、p4、p7（A 的對象作品） | ¥3,520 | A 30%OFF | −¥1,056 | ¥2,464 |
| #2 | p2、p5（翻譯作品，不是 A 的對象） | ¥1,650 | B 20%OFF | −¥330 | ¥1,320 |
| #3 | p3、p6、p8、p9（C 適用）＋ p10（¥780，不適用任何券） | ¥2,980 | C 15%OFF | −¥330 | ¥2,650 |
| **合計** | 10 件 | ¥8,150 | | **−¥1,716** | **¥6,434** |

- 不用券的作品會併入其他訂單，減少結帳次數（p10 放進哪一單都不影響金額）。
- 折扣是逐件捨去後加總，這裡為了好讀，假設每件都剛好整除。
- 勾選「我用特定付款方式」時，會多一欄可得點數。

比較列：全部一起買不用券 ¥8,150／全部一起買，只用效果最好的一張券：A ¥7,094（B、C 各只折 ¥330）／**最佳方案 ¥6,434**。

### 12.4 結合史低資訊
- 試算表每件作品旁邊顯示「現價 vs 史低」。如果某件作品現價比史低高很多，而且一年有超過 150 天在打折，就標示「建議等特價」，並提供「排除這件再算一次」的按鈕。
- 優惠券快到期（7 天內）時在試算頁置頂提醒，也可以加入 §6 的通知規則（`couponExpiring`）。

### 12.5 測試
- 用暴力窮舉（列舉所有分組方式與所有用券方式，含一次性券只能用一次的限制）當標準答案，對 n ≤ 8 的隨機案例比對 DP 結果，用 Vitest 跑數百組。
- 邊界案例：
  - 1 張可重複使用的 30% 券配 4 件作品 → 1 單（不能拆成 4 單）
  - p1、p2 各 ¥1,000；可重複使用 A 10%（兩件都適用）；一次性 X 10%（只適用 p2，3 天後到期）→ 省 ¥200、1 單、X 留著
  - §12.3 範例 → 3 單
  - 可重複使用的 A 與「剩 5 次、2 天後到期」的限次券 Z（n ≤ 4，放進 `R`）折扣相同 → 用 A，不論兩張券在陣列裡的順序
  - p1、p2 各 ¥1,000；一次性 Y（10%，兩件都適用，30 天後到期）、一次性 X1（只適用 p1，3 天）、X2（只適用 p2，3 天）→ 用 X1、X2 分兩單（成本 8），不用 Y（成本 31）
  - 同分時：p1 適用 A、B（都是 10%），p2 只適用 B，p3 只適用 C → 2 單（p1 用 B）
  - 已過期、尚未開始的券不會出現在結果裡
  - 沒有券、所有券都不適用
  - 單價剛好等於 `maxItemPrice`、件數差一件才到 `minItems`
  - 全部作品都在打折，而且券的 `appliesToDiscounted` 是 null
  - 限次券只剩一次、兩張完全相同的券（兩張都要保留，不能被 `coupon_id` 合併成一張）
  - 一張一次性的 `payment` 券「¥400，滿 ¥1,200」配 p1 ¥1,200、p2 ¥1,200 → 只能省 ¥400，不是 ¥800
  - 一張可重複使用、沒有門檻的定額券「¥400」配 p1 ¥300、p2 ¥300 → 分兩單省 ¥600
  - 整數捨去：`(180, 35) → 63`、`(90, 70) → 63`
- 用 §5.4 實測的 7 張券做 fixture（依 §3.3 去識別化），確認解析結果和券面說明一致。

---

## 附錄：參考資料
- Greasy Fork「dlsite 历史价格查询」（MIT）：參考它依頁面文字找價格區塊的插入方式。作品編號比對不沿用它的 `/[VBR]J\d{6,8}/`（沒有錨定，會截斷 9 碼、放行 7 碼），改用 §3.2.2 的 `isWorkId()`。
- `imba-tjd/DLWatcher`（AGPL-3.0）：和 dlwatcher.com 無關的同名專案，資料已停止更新，不使用它的資料或程式碼。只參考它的 ajax API 批次查詢（100 個一組）與 GitHub Actions 排程架構。
- `SPEC_REVIEW.md`：v0.3 的安全、正確性與可行性審查報告，v0.4 依此修改。
- `SPEC_REVIEW_v0.4.md`：v0.4 的第二輪審查報告（含 DP 與日期規則的實測反例），v0.5 依此修改。
- `SPEC_REVIEW_v0.5.md`：v0.5 的第三輪審查報告（含 DP 與暴力窮舉 600 組比對、通知狀態機模擬、M1 準備度評估），v0.6 依此修改。
