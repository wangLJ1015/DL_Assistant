# DL_Assistant 專案規格書

> 版本：v0.4（草案）　日期：2026-11-23
> 一句話說明：Chrome 擴充功能。把 DLsite 加入購物車的作品自動列入追蹤，定時查價、顯示史低與價格走勢，出現優惠時跳出通知；也能隨時查任一作品的史低，並依你手上的優惠券算出最划算的買法。
>
> v0.2 變更：新增「臨時查史低」（F12～F13）、「優惠券同步」（F14）、「購買試算」（F15～F16）與 §12 試算演算法。
> v0.3 變更：依 DLsite 官方說明與實測的優惠券 API 確認用券規則（§5.4、§10.1、§10.2）；演算法改為支援可重複使用的券；新增「會改變帳號狀態的 GET 網址」白名單規則（§3.4）。
> v0.4 變更：依 `SPEC_REVIEW.md` 的審查意見修正。重點：試算演算法把可重複使用與限次的券分開計算（§12.2）；外部資料只當純文字、URL 一律由程式自己組（§3.2）；對外請求只能透過唯一的包裝函式，路徑完全比對（§3.4）；新增訊息白名單（§3.2.4）、日期解析規則（§5.5）、背景工作（§4.1）、匯入規則（§3.7）；通知改成狀態轉換才發（§6）；清掉章節之間的矛盾。

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
| F6 | 優惠通知 | 依通知規則（§6）跳出 Windows 通知。點擊後，單一作品開啟作品頁，多件合併的通知開啟儀表板並篩選這幾件 | P0 |
| F7 | 儀表板 | 追蹤清單表格（現價、原價、折扣、史低、距史低差距、折扣截止）＋單一作品的價格走勢圖＋最近的通知 | P0 |
| F8 | 作品頁徽章 | 在 DLsite 作品頁的價格區塊下方顯示「史低 ¥xxx（期間）」和「追蹤中」狀態，並標示「資料來源：DL_Assistant」 | P1 |
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
- 儀表板說明：在其他裝置或 App 加入購物車的作品，要打開一次網頁版購物車才會同步。

**F14「立即同步」流程**
- popup 請 background 找一個已開啟的 `https://www.dlsite.com/*` 分頁（`chrome.tabs.query`），用 `chrome.tabs.sendMessage` 請該分頁的 content script 同步。
- 沒有 DLsite 分頁時，popup 顯示「請先開啟任一 DLsite 頁面再同步」。不自動開分頁，也**不從 background 發帶 cookie 的請求**。
- 自動同步的時機由 background 決定（§5.4「同步排程」）。

---

## 3. 非功能需求

### 3.1 對外請求的節制
- DLsite 商品 API 一次最多查 100 個作品 ID，請求之間間隔至少 1 秒。
- DLWatcher 每個作品 24 小時內最多請求一次（對方回傳 `Cache-Control: max-age=86400`），請求之間間隔至少 2 秒。
- 不自訂 User-Agent（瀏覽器不允許 fetch 改這個標頭，也不值得為此多要權限）。用頻率限制與快取節制流量。
- 遇到 HTTP 429 或 5xx 就用指數退避（1 分、2 分、4 分），連續失敗 3 次就暫停該來源 6 小時。退避狀態存在 `chrome.storage.local`，service worker 重啟後還記得（§4.1）。

### 3.2 安全

DLsite 頁面是已登入的狀態，DLWatcher 是第三方網站，優惠券說明是 DLsite 營運人員或合作網站填寫的 HTML。這些都當成**不可信的外部資料**。

#### 3.2.1 外部資料只當純文字
- 外部資料只用 `textContent` 或 React 的預設跳脫顯示。
- 禁止把任何外部字串指派給**屬於目前文件的元素**的 `innerHTML`、`outerHTML`、`insertAdjacentHTML`，**即使元素還沒插入頁面**（在 content script 裡，`<img onerror>` 會在 DLsite 頁面執行）。也禁止 `document.write`、`Range.createContextualFragment`、`dangerouslySetInnerHTML`。
- 含 HTML 的欄位（`condition_info`）只在 content script 用 `new DOMParser().parseFromString(html, 'text/html')` 解析（`DOMParser` 產生的是惰性文件，不執行腳本、不載入圖片），取 `doc.body.textContent`，空白正規化、截斷到 2,000 字後存成 `conditionText`。**原始 HTML 不儲存、不傳給 background。** Service worker 沒有 `DOMParser`，這一步不能搬到 background。
- v1 不保留說明裡的 `<a href>` 連結，只顯示文字。
- Chart.js 只用內建的 canvas tooltip；要自訂 tooltip 就用 React 元件渲染，不用 `innerHTML`。
- ESLint 加上 `eslint-plugin-no-unsanitized` 與 `react/no-danger`，CI 失敗就不能合併。

#### 3.2.2 URL 一律由程式自己組
- 外部資料不准放進 `href`、`src`、`srcset`、`style`、`action`、`formaction` 和 `on*` 屬性。
- **作品編號**：統一用 `lib/ids.ts` 的 `isWorkId(s) = /^(RJ|RE|BJ|VJ)(\d{6}|\d{8})$/.test(s)`（前綴清單見 §10.3）。不用沒有錨定的 regex 掃整段字串。
- **作品頁連結**：只用 `https://www.dlsite.com/${site}/work/=/product_id/${id}.html` 組出。`site` 必須是列舉值（`maniax`、`home`、`books`、`pro`、`soft`…，完整清單見 §10.3），取 API 的 `site_id`，不在列舉內就用 `maniax`；`id` 必須通過 `isWorkId()`。
- **從網址取作品編號**（F1、F13）：先 `new URL(url)`，要求 `protocol === 'https:'` 且 `host === 'www.dlsite.com'`，再用 `^/[a-z]+/(work|announce)/=/product_id/([A-Z]{2}\d{6,8})(\.html)?(/|$)` 比對 `pathname`，取出的編號再過 `isWorkId()`。其他網址一律不處理。
- **圖片**：只接受 `https://img.dlsite.jp/` 開頭的網址。`//` 開頭的協定相對網址先補 `https:`（否則在擴充功能頁面會變成 `chrome-extension://img.dlsite.jp/...`）。其他一律換成內建的預設圖。DLWatcher 和匯入檔案裡的圖片網址一律不用。
- 擴充功能頁面的 CSP 在 MV3 預設值上再收緊（§7.1），讓瀏覽器擋住白名單以外的連線與圖片，作為 §3.4 的第二道防線。

#### 3.2.3 回應驗證
- 所有 API 回應先用 zod 驗證再使用。schema 只列出要用的欄位（未列出的欄位會被去掉）。
- **禁止使用 `z.coerce`**（`null`、`""` 會變成 0，`true` 會變成 1）。字串數字用：
  `const intLike = z.union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)]);`
  可為空的欄位明確寫 `.nullable()`。`null` 在轉成本機模型時變成 `undefined`（代表「沒有這個條件」），不是 0。
- 數字都加範圍：價格是 0～1,000,000 的整數，折扣率 0～100，定額券面額 1～100,000，字串欄位有長度上限（標題 300 字）。
- **逐筆驗證**：先驗證最外層是陣列（或物件），再對每一筆 `safeParse`。成功的保留，失敗的記下編號與原因（「哪個欄位不符」），只讓那一筆失敗。商品 API 一次 100 件，其中 1 件怪異只影響那一件；優惠券有 1 張解析失敗，popup 顯示「有 N 張券無法解析」。
- 不認得的 `condition_type`、`discount_type`：保留這張券供顯示，但標記 `plannerUsable: false`，試算不用它，畫面上說明原因。
- **回應大小上限**：DLWatcher 2 MB、DLsite 商品 API 5 MB、優惠券 API 1 MB。超過就中止讀取並當作失敗。

#### 3.2.4 訊息與事件
DLsite 頁面上有廣告與追蹤腳本。它們不能直接呼叫 `chrome.runtime`，但能產生假的點擊、改寫 DOM，讓 content script 讀到假資料。
- content script 只在 isolated world 執行。不注入 main world 腳本，不監聽 `window` 的 `message` 事件，不監聽也不派送自訂 DOM 事件，不讀取頁面的 JS 變數。
- 所有點擊處理都檢查 `event.isTrusted === true`。
- background 的 `chrome.runtime.onMessage` 依來源分兩組，其他來源一律忽略：

| 來源 | 判斷方式 | 只能送的訊息 |
|---|---|---|
| content script | `sender.id === chrome.runtime.id`、`sender.origin === 'https://www.dlsite.com'`、`sender.frameId === 0` | `cartClicked {id}`、`cartSnapshot {ids}`、`track {id}`、`lookup {id}`、`shouldSyncCoupons`、`couponSyncResult {result}` |
| 擴充功能頁面 | `sender.origin === new URL(chrome.runtime.getURL('')).origin` | 匯入、匯出、移除追蹤、暫停、改目標價、改設定、立即同步、試算資料讀取等 |

- 每種訊息都用 zod 驗證，作品編號都要通過 `isWorkId()`。來自 content script 的優惠券資料，background 要再跑一次完整的 zod 驗證。
- background 不提供「幫我抓這個網址」之類的通用訊息。content script 只送作品編號，網址由 background 自己組。
- 數量上限：一次 `cartSnapshot` 最多 200 個編號；追蹤清單總數上限 1,000 件；`lookup` 每分鐘最多 10 次；超過就忽略並記錄。
- 程式裡不註冊 `chrome.runtime.onMessageExternal`／`onConnectExternal`（manifest 也鎖住，見 §7.1）。

#### 3.2.5 content script 範圍與注入的 UI
- content script 的 `matches` 為 `https://www.dlsite.com/*`，`exclude_matches` 排除結帳、付款、帳號設定相關路徑（實際路徑見 §10.3）；`all_frames: false`。
- 注入頁面的 UI 一律用 WXT 的 `createShadowRootUi`，`mode: 'closed'`（WXT 不支援 closed 就用 open，並接受頁面讀得到內容）。
- **頁面 DOM 裡只放公開資訊**：史低、價格走勢、「追蹤中」狀態。優惠券、試算結果、追蹤清單的其他作品，只在擴充功能自己的頁面（popup、儀表板、試算頁、`lookup.html`）顯示。
- 擴充功能頁面不用 iframe 嵌進 DLsite 頁面。
- 注入的按鈕放在徽章容器內，不浮動、不覆蓋 DLsite 原本的元素。徽章點擊後開啟擴充功能自己的頁面看完整資料；使用說明寫「以擴充功能頁面為準」（頁面腳本可以畫一個假徽章，擴充功能擋不住）。

#### 3.2.6 頁面文字解析
- 只用 `selectors.ts` 裡的選擇器讀取特定元素，不讀 `document.body.innerText`／`outerHTML`，不把整段頁面文字送給 background（頁面上有帳號 email 等個人資料）。
- 取到元素文字後先截斷到 200 字，再用沒有巢狀量詞的 regex 解析。價格與日期的 regex 放在 `selectors.ts` 旁邊並附單元測試，包含一段 10 萬字的惡意字串，限時 50 ms。

### 3.3 隱私
- 所有資料只存在本機（`chrome.storage.local` / IndexedDB），不上傳到任何伺服器。
- 優惠券資料**永遠不離開本機**：不送給 DLWatcher，匯出 JSON（F10）時預設也不包含，要另外勾選。
- 讀取帳號資料只用你瀏覽器裡已登入的狀態。擴充功能不保存、不讀取 cookie 或密碼。
- `encrypted_code` 不在 schema 裡，不儲存。原始回應字串只存在於解析函式的區域變數，**不 log、不存、不放進錯誤訊息**。錯誤訊息只記錄「哪個欄位不符」與 HTTP 狀態碼。
- 測試 fixture 進 repo 前必須去掉 `encrypted_code`、任何帳號 ID、email、暱稱和個人時間戳。另加一個測試掃描 `tests/fixtures/**`，出現 `encrypted_code` 或 email 格式的字串就失敗。
- 送給 DLWatcher 的只有作品編號，不送 cookie、帳號、購物車或優惠券內容。但對方仍會知道：你的 IP、查詢的作品編號與時間，也可能從請求辨識出這是本擴充功能。這一點寫在設定頁，並提供「關閉 DLWatcher」選項。
- 匯出時提醒「這份檔案包含你的追蹤清單（可能含 R18 作品）」。

### 3.4 對外請求與帳號操作的邊界
**原則**：DLsite 有些 GET 網址也會改變帳號狀態，例如 `/home/mypage/coupon`（領券）。真正的風險是**帶 cookie 的請求**，所以除了只發 GET，還要限制哪些請求可以帶 cookie、從哪裡發。

- 所有對外請求只能透過 `lib/api/endpoints.ts` 匯出的 `apiGet(key, params)`。其他檔案禁止直接用 `fetch`、`XMLHttpRequest`、`navigator.sendBeacon`、`EventSource`、`WebSocket`，ESLint 以 `no-restricted-globals`／`no-restricted-properties` 強制，只有 `endpoints.ts` 例外。
- `apiGet` 不接受外部傳入的 URL 或路徑，只接受端點代號與驗證過的參數（作品編號要先通過 `isWorkId()`）。組出 URL 後用 `new URL()` 解析，由內部的 `assertAllowed()` 檢查 `origin` 與 `pathname` **完全相等**（不用 `startsWith`、`includes`），查詢參數也只能是該端點允許的那幾個。不符就丟例外。
- 每個端點的設定固定如下：

| 代號 | 網址 | `credentials` | `redirect` | 可呼叫的地方 |
|---|---|---|---|---|
| `productInfo` | `https://www.dlsite.com/maniax/product/info/ajax`（參數只有 `product_id`、`cdn_cache_min`） | `omit` | `error` | background、擴充功能頁面 |
| `couponList` | `https://www.dlsite.com/home/mypage/coupon/list/ajax`（沒有參數） | `same-origin` | `manual` | **只有** content script |
| `dlwatcher` | `https://dlwatcher.com/product/{id}.json` | `omit` | `error` | background、擴充功能頁面 |

  - `dlwatcher` 的路徑用 `^/product/(RJ|RE|BJ|VJ)(\d{6}|\d{8})\.json$` 整段比對。
  - `productInfo`、`dlwatcher` 加上 `referrerPolicy: 'no-referrer'`；`couponList` 維持瀏覽器預設，和頁面自己發的請求一致。
  - `couponList`、`dlwatcher` 加上 `cache: 'no-store'`（DLWatcher 的 24 小時快取由我們自己管）。
- **只有 `couponList` 會帶 cookie。** 其他 DLsite 路徑（購物車、結帳、領券、帳號設定）一律不發請求。F2 購物車同步只讀你自己打開的購物車頁面 DOM。
- 單元測試測**行為**：對 `/home/mypage/coupon`、`/home/mypage/coupon?x=1`、`/home/mypage/coupon/`、`/home/mypage/coupon/list`、`/home/cart`、`/home/buy`、`https://login.dlsite.com/` 呼叫 `assertAllowed()`，每一個都要丟例外。白名單的筆數用快照測試鎖住，新增端點必須同時改測試。

> ⚠️ **不要呼叫 `GET /home/mypage/coupon`**（少了 `/list/ajax`）。這是**領券**端點，實測打開會嘗試發券。

### 3.5 臨時查詢的資料處理
- 臨時查史低（F12、F13）的結果只放在 `chrome.storage.session`（瀏覽器關閉就清空），快取 24 小時，**不寫進追蹤清單和查價紀錄**。
- `chrome.storage.session` 維持預設存取層級（content script 讀不到），只有 background 讀寫。作品頁的徽章與「查史低」按鈕用 `chrome.runtime.sendMessage({ type: 'lookup', id })` 向 background 取結果。
- 快取最多保留 200 件，超過時刪掉最舊的（session 配額 10 MB）。
- 使用者按「加入追蹤」時，才把快取結果轉存為正式資料。

### 3.6 容錯
- DLsite 和 DLWatcher 都是非官方介面，隨時可能改版。任一來源壞掉時，其他功能要能繼續運作。
- **自己的價格紀錄**：每次查價（F4 排程、手動重新查價）都寫進 `priceLog`（§5.3），不論 DLWatcher 是否可用。DLWatcher 停止服務或被關閉時：
  - 史低 = 自己紀錄的最低價，畫面標示「自 YYYY-MM-DD 開始追蹤以來的最低價」（自己的紀錄只從加入追蹤那天開始）。
  - 走勢圖改用 `priceLog` 畫階梯折線；沒有查價的期間（`lastSeenAt` 到下一筆 `at`）畫成虛線，不假裝價格沒變。
  - 通知的史低基準（§6.1）只用自己的紀錄。
- **DLWatcher 的歷史保留在本機**：`HistoryRecord` 只在新的回應驗證成功時覆蓋；請求失敗、404 或驗證失敗時保留上一次的資料並標示取得時間，不能用空資料蓋掉。
- 臨時查詢（F12、F13）的結果不寫進 `priceLog`；按「加入追蹤」時，把當下查到的價格寫成第一筆。
- F10 匯出包含 `priceLog`，換電腦或重裝時可以帶走自己的紀錄。
- DOM 選擇器集中在 `selectors.ts`，改版時只要改一處。

### 3.7 匯入／匯出（F10）
- 匯出格式帶 `format: "dl-assistant-export"` 與 `version` 欄位；匯入時版本不認得就拒絕。
- 匯入檔上限 5 MB，超過直接拒絕。用 `file.text()` 讀取後 `JSON.parse`，再用 `.strict()` 的 zod schema 驗證整份檔案，任何一筆不符就整份拒絕並顯示錯誤位置。
- 可以匯入的只有：追蹤清單（`id`、`targetPrice`、`paused`、`addedAt`）與自己的查價紀錄（`priceLog`；同一作品同一 `at` 的紀錄以本機為準，不覆蓋）。`id` 必須通過 `isWorkId()`；數字有範圍（價格 0～1,000,000 的整數）。
- **不匯入**：`title`、`imageUrl`（下次查價時從 API 重新取得）、設定、通知紀錄、**優惠券**。優惠券只能來自 F14 同步，避免假券影響試算。
- 以作品編號為 key 的資料，在記憶體中用 `Map` 或 `Object.create(null)` 存放，避免 `"__proto__"` 這種 key 改到原型。禁止用 `Object.assign` 或深層合併函式把匯入資料併入既有物件。
- 匯入前顯示摘要（新增幾件、覆蓋幾件），你確認後才寫入。

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
│  ├─ apiGet：商品 API / DLWatcher（不帶 cookie）│
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
- 查價佇列存在 `chrome.storage.local`（`queue: { source, ids[], nextIndex, nextAt }`）。每處理完一件就把進度寫回 storage。
- 每次被 alarm 喚醒最多處理 60 秒，還有剩就設一次性的 `drain` alarm（`delayInMinutes: 0.5`）繼續。service worker 被終止也能從 `nextIndex` 接著做。
- 退避狀態（每個來源的連續失敗次數、暫停到何時）存在 `chrome.storage.local`。
- `runtime.onInstalled`、`runtime.onStartup`，以及 service worker 每次啟動時，都用 `chrome.alarms.get` 檢查排程是否存在，不在就重建（alarms 在瀏覽器重啟時可能被清除）。另外記錄 `lastRunAt`，啟動時若距離上次超過週期就立刻排一次。
- 所有事件監聽器（`alarms.onAlarm`、`runtime.onMessage`、`contextMenus.onClicked`、`notifications.onClicked`）都在 `background.ts` 最上層同步註冊。

### 4.2 資料寫入
- 所有寫入都經過 background（單一寫入者）。其他頁面與 content script 用訊息要求修改。background 內部用一個 Promise 佇列讓寫入依序執行，避免「讀 → 改 → 寫」互相覆蓋。
- 頁面用 `chrome.storage.onChanged` 更新畫面。
- IndexedDB 連線處理 `versionchange` 事件：收到就關閉連線並提示重新整理頁面。

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

- `priceLogGraph` 的 x 要換算回日期：`日期 = 該年 1/1 + x × 該年天數`，誤差大約一天。
- 不使用 DLWatcher 提供的任何網址（圖片、連結）。

### 5.3 本機資料模型

時間欄位一律存 UTC 的 ISO 字串（`2026-12-02T15:58:36.000Z`），轉換規則見 §5.5。

```ts
// 追蹤清單（chrome.storage.local，key: "items"）
interface TrackedItem {
  id: string;              // RJ01014447，通過 isWorkId()
  site: string;            // 加入時從網址暫填，第一次查價後改成 API 的 site_id
  title: string;           // 最多 300 字
  imageUrl: string;        // 依 §3.2.2 正規化的 https://img.dlsite.jp/ 網址；不符時為空字串（顯示預設圖）
  addedAt: string;
  source: 'cart' | 'manual' | 'import';
  targetPrice?: number;    // 使用者設定的目標價（日圓）
  paused: boolean;
}

// 最新狀態（key: "snapshots"，以 id 為 key；載入後放進 Map）
interface PriceSnapshot {
  id: string;
  price: number;
  officialPrice: number;
  isDiscount: boolean;
  discountRate: number;
  discountEnd?: string;    // 依 §5.5 補上年份；截止時間不明時省略
  campaignId?: string;
  episode?: { key: string; startedAt: string };  // 目前這段優惠的識別（§6.1），沒打折時省略
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
  discountDaysLastYear?: number;
  fetchedAt: string;
}

// 自己的查價紀錄（IndexedDB "priceLog"，key: [id, at]）
// 價格、原價或打折狀態變動時新增一筆；沒變動時只更新最後一筆的 lastSeenAt。
// 這份紀錄不依賴 DLWatcher，DLWatcher 停止服務或被關閉時，史低、走勢圖與通知都改用它（§3.6）。
interface PriceLogEntry {
  id: string;
  price: number;
  officialPrice: number;
  isDiscount: boolean;
  discountRate: number;
  campaignId?: string;
  at: string;              // 第一次看到這個價格的查價時間
  lastSeenAt: string;      // 最後一次查到還是這個價格的時間；和下一筆的 at 之間的空白代表沒有查價（例如瀏覽器關著）
}

// 持有的優惠券（chrome.storage.local，key: "coupons"）
// 欄位對應 §5.4 優惠券 API 的實際回應
interface Coupon {
  id: string;                    // coupon_id，例："dojin_30peroff_20261116"
  name: string;                  // coupon_name
  kind: 'rate' | 'price';        // discount_type：折扣率 "rate"／定額 "price"（兩種都已實測）
  value: number;                 // discount：rate 是 1～100 的整數（30 代表 30%）；price 是 1～100,000 的整數（日圓）
  multiUse: boolean;             // is_multiple_use：false 代表每人只能用一次（實測定額券是 false）
  usage?: { count: number; limit: number };   // limited_usage_count / limited_usage_limit，語意待確認（§10.2 i）
  eligibility:
    | { type: 'custom_genre'; genres: string[] }   // 作品的 custom_genres 有交集才適用
    | { type: 'site_ids'; siteIds: string[] }      // 作品的 site_id 在清單內才適用
    | { type: 'payment'; siteIds: string[] };      // 整筆結帳折抵：distribute_targets 的樓層
  affectsPayment: boolean;       // is_affect_to_payment：true 代表折抵整筆結帳金額
  maxItemPrice?: number;         // conditions.maximum_applicable_price；API 為 null 時是 undefined（沒有上限），不是 0
  minSpend: number;              // conditions.price_sum 正規化後的值（§5.4），0 代表沒有門檻
  minItems: number;              // conditions.post_condition.count，沒有就是 1
  workFormats?: string[];        // 指定作品形式的券（實際欄位名待確認，§10.2 j）
  appliesToDiscounted: boolean | null;  // 從 conditionText 判斷：「割引中の作品にも適用」→ true；沒寫 → null（未知）
  floors: { doujin: boolean; books: boolean; pc: boolean; app: boolean; ai: boolean; female: boolean; adult: boolean };
  startsAt: string;              // 由 start_date（JST）轉換
  expiresAt: string;             // min(limit_date, end_date)，規則見 §5.5
  conditionText: string;         // condition_info 轉成的純文字（§3.2.1），最多 2,000 字
  plannerUsable: boolean;        // false：條件無法解析或類型不認得，只顯示、不參與試算
  unusableReason?: string;       // plannerUsable 為 false 的原因，顯示給使用者
  syncedAt: string;
}

// 優惠券同步狀態（key: "couponSync"）
interface CouponSyncState {
  lastSuccessAt?: string;
  lastResult: 'ok' | 'notLoggedIn' | 'failed' | 'unreadable';
  invalidCount: number;          // 這次有幾張券解析失敗
}

// 每件作品每條規則的上次判定結果（key: "ruleState"，key 為 `${id}:${rule}`）
interface RuleState {
  active: boolean;               // 上次查價時條件是否成立
  since?: string;                // 這次成立的開始時間
}

// 已送出的通知（key: "notified"），超過 180 天的在每次排程時刪除
interface NotifiedKey {
  key: string;                   // 依 §6.1 的規則組成
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
| `discount_type` / `discount` | `rate` / `"30"`，`price` / `"400"` | 折扣方式與數值（字串，用 `intLike` 轉數字） |
| `is_multiple_use` | true / false | true：期間內可以重複使用；false：每人限用一次 |
| `is_affect_to_payment` | true | 折抵整筆結帳金額（定額券實測為 true） |
| `limit_date` | 1796227116 | **實際到期時間**（Unix **秒**）。定額券是領券後 10 天，比 `end_date` 早 |
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

**`price_sum` 正規化**：接受 `intLike`、`[]`、`[intLike]`。`null` 或 `[]` 視為 0。陣列超過 1 個元素時，這張券標成 `plannerUsable: false`（「條件無法解析」）。

**判斷同步結果**（請求設定 `redirect: 'manual'`）：

| 結果 | 判定 | 本機資料 |
|---|---|---|
| `response.type === 'opaqueredirect'`，或 `response.url` 的 host 不是 `www.dlsite.com` | 未登入 | 保留，標示「未登入，上次同步：…」 |
| fetch 丟例外、HTTP 狀態不是 200、內容超過 1 MB | 同步失敗 | 保留，標示失敗 |
| `JSON.parse` 失敗 | 未登入或 API 改版（兩者無法區分） | 保留，標示「無法讀取」 |
| 最外層是陣列（含 `[]`） | 成功 | 以這次結果**整批取代**本機的券（解析失敗的券不寫入，只計數） |
| 最外層不是陣列 | API 改版 | 保留，標示失敗 |

> 一次網路錯誤不能把本機的券清空；只有拿到有效的陣列才取代。未登入時 fetch 的實際行為（拿到 HTML、`opaqueredirect` 或例外）列入 §10.3 驗證。

**同步排程**：content script 先送 `shouldSyncCoupons`。background 檢查距離上次成功同步是否已超過 6 小時，以及是否有其他分頁正在同步（在 `chrome.storage.session` 記錄 `couponSyncLock`，2 分鐘過期），回覆允許才發請求。「立即同步」略過 6 小時的檢查，但仍受同步鎖限制。

> ⚠️ **不要呼叫 `GET /home/mypage/coupon`**（少了 `/list/ajax`）。這是**領券**端點，實測打開會嘗試發券（這次因為沒有可領的券而顯示「クーポン発行 エラー」）。§3.4 的行為測試會擋住這個網址。

### 5.5 日期解析規則（`lib/dates.ts`）
- DLsite 的日期字串一律視為 **JST**。`YYYY-MM-DD HH:mm:ss` 先用 `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$` 嚴格比對，再轉成 `YYYY-MM-DDTHH:mm:ss+09:00` 解析。
- **禁止把沒有時區的字串直接丟給 `new Date()`**：在台灣時區，`new Date("2026-11-28 23:59:59")` 會被當成本機時間，比 JST 晚 1 小時。除了 `lib/dates.ts`，其他檔案禁止單一參數的 `new Date(x)` 與 `Date.parse`，用 ESLint `no-restricted-syntax` 強制。
- 本機一律存 UTC 的 ISO 字串，顯示時轉成使用者時區，可以加註「日本時間 12/3 00:58」。
- `limit_date`：Unix 秒，乘 1000 後轉 ISO。`expiresAt = min(limit_date, end_date)`；`limit_date` 為 `null` 時用 `end_date`；兩者都沒有就當作這張券解析失敗。
- `discount_end_date`（`MM/DD HH:mm`）：以 `checkedAt` 在 JST 的年份 `y` 建立候選日期；若候選早於 `checkedAt − 2 天`，改用 `y + 1`。月、日不合法（含非閏年的 2/29）就當作「截止時間不明」，不顯示、也不觸發 `ending`。如果 API 回傳含年份的完整格式，直接解析。
- 單元測試：
  - 12/30 查價看到 `12/31 23:59` → 同年
  - 12/30 查價看到 `01/02 23:59` → 隔年
  - JST 1/1 00:30 查價看到 `12/31 23:59`（CDN 快取的舊資料）→ 前一年
  - 非閏年看到 `02/29` → 不明
  - `2026-11-28 23:59:59` 在 `TZ=Asia/Taipei` 下解析成 `2026-11-28T14:59:59.000Z`
  - `limit_date: 1796227116` → `2026-12-02T15:58:36.000Z`

---

## 6. 通知規則

| 規則 | 觸發條件 | 預設 |
|---|---|---|
| `sale` | 作品從原價變成打折 | 開 |
| `target` | 現價 ≤ 使用者設定的目標價 | 開 |
| `lowest` | 現價 ≤ 史低基準（定義見下方） | 開 |
| `ending` | 符合上面任一條件，且折扣在 24 小時內結束 | 開 |
| `deeper` | 同一段優惠中折扣又加深 | 關 |
| `couponExpiring` | 持有的優惠券 7 天內到期，而且追蹤清單裡有作品可以用這張券 | 開 |

### 6.1 觸發與去重
- **狀態轉換才通知**：每件作品每條規則記錄上次的判定結果（`RuleState`）。條件從不成立變成成立時才通知；條件變回不成立時重新上膛，下次再成立會再通知。
- **一段優惠的識別** `episodeKey` = `campaign_id` ?? `discountEnd` ?? `"start:" + 第一次看到這次打折的日期`。打折開始時寫進 `PriceSnapshot.episode`，打折結束時清掉。
- 去重 key（存在 `NotifiedKey.key`）：

| 規則 | key |
|---|---|
| `sale`、`lowest`、`ending` | `id + rule + episodeKey` |
| `target` | `id + rule + targetPrice + episodeKey`（沒打折時 `episodeKey` 用這次跌破目標價的日期） |
| `deeper` | `id + rule + episodeKey + discountRate` |
| `couponExpiring` | `couponId + expiresAt` |

- **`lowest` 的史低基準** = min(DLWatcher 史低, 自己紀錄中**這段優惠開始之前**的最低價)。不能把這次查到的價格算進基準，否則條件永遠成立。沒有任何先前紀錄、DLWatcher 也沒有資料時，不觸發 `lowest`。
- **剛加入追蹤的作品**，第一次查價只建立基準，不發任何通知（你當下就在看這個作品）。
- 同一次查價裡，同一件作品符合多條規則時只發一則，內文列出全部符合的規則；`ending` 不單獨再發。
- 同一次查價有多個作品符合時，合併成一則通知（「3 個追蹤作品正在特價」）。
- `notified` 超過 180 天的紀錄在每次排程時刪除。

### 6.2 通知內容與點擊
- 標題固定為「DL_Assistant」加規則名稱（例如「DL_Assistant：特價」）。作品名稱只放在內文，去掉控制字元並截斷到 60 字，避免作品名稱冒充系統通知。
- 內文：作品名稱、現價／原價、折扣、和史低差多少、截止時間。
- 通知一律用擴充功能內建圖示，不顯示作品縮圖（`iconUrl` 用遠端網址不可靠，service worker 也不能產生 blob URL）。
- `notificationId` 對應到 `RecentNotification.ids`。單一作品時開啟依 §3.2.2 組出的作品頁網址；多件合併時開啟儀表板並篩選這幾件。
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
  "permissions": ["storage", "alarms", "notifications", "unlimitedStorage", "contextMenus"],
  "host_permissions": ["https://www.dlsite.com/*", "https://dlwatcher.com/*"],
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'; img-src 'self' https://img.dlsite.jp data:; connect-src 'self' https://www.dlsite.com https://dlwatcher.com"
  },
  "externally_connectable": { "ids": [], "matches": [] }
}
```
- `host_permissions` 只開這兩個網域。Chrome 對 `host_permissions` 的路徑部分不一定生效，所以帳號頁面的保護靠 §3.4 的 `apiGet`，不靠權限。
- `web_accessible_resources`：只列真的要在 DLsite 頁面載入的檔案（例如徽章圖示），`matches` 限 `https://www.dlsite.com/*`，`use_dynamic_url: true`。沒有就整段省略（任何網站都能用這些檔案偵測使用者是否安裝本擴充功能）。
- 右鍵選單：`chrome.contextMenus.create` 設定 `contexts: ['link']`、`documentUrlPatterns: ['https://www.dlsite.com/*']`、`targetUrlPatterns: ['https://www.dlsite.com/*/work/=/product_id/*']`。只查史低，不自動加入追蹤，也絕不 fetch `linkUrl` 本身。
- F13 的小視窗用 `chrome.windows.create({ type: 'popup', url: 'lookup.html?id=…', width: 420, height: 520 })`，作品編號依 §3.2.2 驗證後才放進查詢參數；`lookup.html` 讀取參數時再驗證一次。
- 收緊的 CSP 與 `externally_connectable` 空陣列寫法是否被 Chrome 接受，M1 時確認（§10.3）。

### 7.2 建置與供應鏈
- 使用 zod 4 時，在每個進入點呼叫 `z.config({ jitless: true })`，避免它嘗試用 `new Function`（MV3 禁止 `unsafe-eval`）。M1 確認 console 沒有 CSP 違規訊息。
- 發佈前檢查 `.output/chrome-mv3/manifest.json`：沒有 `localhost`、沒有 `unsafe-eval`、`content_security_policy` 與 §7.1 一致。這一步寫成腳本放在 CI（WXT 開發模式會放寬 CSP，不能把 dev build 拿去發佈）。
- `pnpm-lock.yaml` 進版控；CI 用 `pnpm install --frozen-lockfile`；維持 pnpm 預設的「不執行相依套件的 install script」，需要的套件才加進 `onlyBuiltDependencies`；每次升級套件跑 `pnpm audit`。
- 不使用任何從 CDN 或遠端載入程式碼的功能（包含 WXT 的遠端模組匯入）。
- 第二階段的 GitHub Actions 若要推播到 Discord／Telegram，webhook 網址存在 repo secrets，不寫進程式碼。

---

## 8. 專案結構（預定）

```
DL_Assistant/
├─ SPEC.md
├─ wxt.config.ts
├─ package.json
├─ eslint.config.js             # §3.2.1、§3.4、§5.5 要求的規則
├─ scripts/check-manifest.ts    # 發佈前檢查 manifest（§7.2）
├─ src/
│  ├─ entrypoints/
│  │  ├─ background.ts          # 排程、查價佇列、通知、唯一的 storage 寫入者
│  │  ├─ dlsite.content.ts      # 偵測加入購物車、購物車 DOM、作品頁徽章、優惠券同步
│  │  ├─ popup/                 # 優惠摘要、查詢這個作品、立即同步、最近的通知
│  │  ├─ dashboard/             # 儀表板（表格＋走勢圖＋最近的通知）
│  │  ├─ planner/               # 購買試算頁面
│  │  └─ lookup/                # 右鍵查史低的小視窗（F13）
│  ├─ lib/
│  │  ├─ api/endpoints.ts       # apiGet、assertAllowed、端點表；唯一可以呼叫 fetch 的檔案
│  │  ├─ api/dlsite.ts          # 商品 API 的 zod schema 與轉換
│  │  ├─ api/dlwatcher.ts       # DLWatcher 的 zod schema 與轉換
│  │  ├─ coupons/parse.ts       # 優惠券 API 回應解析（zod、price_sum 正規化、逐筆驗證）
│  │  ├─ coupons/sync.ts        # 同步結果判斷（§5.4 表格）
│  │  ├─ ids.ts                 # isWorkId、從網址取作品編號、組作品頁網址
│  │  ├─ text.ts                # htmlToText（DOMParser，只在 content script 使用）
│  │  ├─ messages.ts            # 訊息的 zod schema 與來源檢查（§3.2.4）
│  │  ├─ lookup.ts              # 臨時查史低（session 快取）
│  │  ├─ queue.ts               # 查價佇列與退避狀態（§4.1）
│  │  ├─ planner/optimize.ts    # 分單＋用券最佳化（§12）
│  │  ├─ planner/worker.ts      # 件數多時在 Web Worker 裡計算
│  │  ├─ storage.ts             # storage / IndexedDB 存取層（寫入只在 background）
│  │  ├─ rules.ts               # 通知規則引擎（§6）
│  │  ├─ dates.ts               # parseJst、補年份、走勢點換算日期（§5.5）
│  │  └─ selectors.ts           # DLsite DOM 選擇器與頁面文字的 regex（集中管理）
│  └─ components/               # 共用 React 元件
└─ tests/                       # Vitest 測試；fixtures/ 放去識別化的 API 回應範例
```

---

## 9. 開發里程碑

| 階段 | 內容 | 完成標準 |
|---|---|---|
| M1 骨架 | WXT 專案、ESLint 規則、`apiGet` 與白名單、storage 存取層、商品 API 查價、手動加入追蹤 | 在 popup 手動加一個作品，看得到現價；`assertAllowed` 行為測試與 manifest 檢查腳本通過；確認 §10.3 標為 M1 的項目 |
| M2 自動追蹤 | content script 偵測加入購物車、購物車 DOM 同步、訊息白名單 | 在 DLsite 加入購物車後，追蹤清單自動多一筆；非 `isTrusted` 的點擊不會加入 |
| M3 史低 | DLWatcher 串接、歷史資料存 IndexedDB、自己的 `priceLog`、查價佇列與退避 | 每個追蹤作品都有史低和期間；在設定關閉 DLWatcher 後，史低與走勢改用自己的紀錄；查價途中 service worker 被終止，重啟後能接著做 |
| M4 通知 | alarms 排程、通知規則、狀態轉換與去重 | 作品打折時收到一次通知；回到原價後再次打折會再通知；剛加入的作品不會馬上通知 |
| M5 儀表板 | 表格、走勢圖、等待建議、最近的通知 | 一頁看完所有追蹤作品的價格狀況 |
| M6 作品頁徽章與臨時查詢 | 作品頁史低徽章、「查史低」按鈕、popup 查詢、右鍵選單與 `lookup.html` | 未追蹤的作品也查得到史低，而且追蹤清單沒有多出東西 |
| M7 優惠券同步 | content script 呼叫優惠券 API、同步判斷與同步鎖、立即同步、到期提醒 | 在任一 DLsite 頁面觸發同步後，擴充功能裡的券和「マイページ → クーポン管理」顯示的一致；登出後同步，本機的券保留並顯示「未登入」 |
| M8 購買試算 | 先確認 WXT 能打包 Web Worker；§12 最佳化演算法、試算頁面、比較表 | 用 10 件作品＋3～5 張券（含一次性券）測試，結果和暴力窮舉一致 |
| 第二階段（選做） | Python ＋ GitHub Actions 每日查價，推播到 Discord / Telegram | 瀏覽器沒開也收得到通知 |

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
| 收緊的 CSP | §7.1 的 `extension_pages` CSP 是否被 Chrome 接受；是否也約束 service worker 的 fetch | M1 |
| `externally_connectable` | 空陣列寫法是否被接受 | M1 |
| zod 4 | `jitless` 模式下 console 是否還有 CSP 違規 | M1 |
| fetch 與 User-Agent | 確認 fetch 無法覆寫 User-Agent（只是確認，規格已不自訂） | M1 |
| 作品編號 | 前綴清單（`RJ`、`RE`、`BJ`、`VJ` 之外還有哪些）、分站列舉值的完整清單；用 `maniax` 路徑組作品頁網址是否都能開 | M1 |
| service worker | 單純等待 fetch 回應是否算活動（不算就靠 §4.1 的進度寫回） | M3 |
| DLsite 圖片 | `img.dlsite.jp` 是否檢查 Referer（會擋的話，擴充功能頁面改顯示預設圖） | M5 |
| content script 排除路徑 | 結帳、付款、帳號設定頁的實際路徑，寫進 `exclude_matches` | M2 |
| WXT | `createShadowRootUi` 是否支援 `mode: 'closed'` | M6 |
| 未登入時的優惠券 API | content script fetch 實際拿到 HTML、`opaqueredirect` 還是例外；登入但沒有券時是否回傳 `[]`；不帶 Referer 是否會被擋 | M7 |
| WXT | 能否正確打包 Web Worker（不行就用 §12.2 的備案） | M8 |

---

## 11. 風險

| 風險 | 影響 | 對策 |
|---|---|---|
| DLsite 改版或改 API | 查價或偵測購物車失效 | zod 逐筆驗證及早發現；選擇器集中管理；儀表板顯示「最後成功查價時間」 |
| DLWatcher 停止服務或改格式 | 沒有史低與歷史 | 自己保留查價紀錄；DLWatcher 失敗時改用自己的最低價 |
| DLWatcher 或優惠券說明含惡意內容 | XSS 打到已登入的 DLsite 頁面，或用網址追蹤使用者 | §3.2.1 只當純文字（`DOMParser`）；§3.2.2 URL 由程式自己組；zod 驗證；收緊的 CSP |
| 頁面腳本操控 content script | 假點擊、假作品編號、耗光請求額度 | §3.2.4：`isTrusted`、訊息白名單、數量上限 |
| 違反網站使用規範 | 被封鎖 | 低頻請求、批次查詢、尊重快取時間 |
| 瀏覽器關閉時沒查價 | 錯過短期特價 | 第二階段改用 GitHub Actions 每日查價 |
| 用券規則理解錯誤 | 試算建議實際上用不了或不是最省 | 規則參數化；試算結果標示「依目前規則設定」；結帳前請以 DLsite 購物車顯示的金額為準 |
| 優惠券 API 改版 | 同步失敗或讀錯券 | 逐筆驗證；同步後顯示券數量與無法解析的張數讓你核對；只有拿到有效陣列才取代本機資料 |
| 誤觸帳號操作 | 改到帳號狀態 | §3.4：唯一的 `apiGet`、路徑完全比對、只有 `couponList` 帶 cookie、行為測試 |
| 匯入惡意檔案 | 假券、原型污染、追蹤網址 | §3.7：strict schema、不匯入券與圖片網址、`Map` 存放 |
| 供應鏈攻擊 | 被入侵的 npm 套件在擴充功能裡執行 | §7.2：lockfile、不執行 install script、`pnpm audit` |

---

## 12. 購買試算演算法

### 12.1 問題定義
- 輸入：想買的作品 `P = {p1 … pn}`（每件有現價、原價、`couponFacts`、是否打折中、點數回饋率），以及持有的優惠券 `C`（排除 `plannerUsable: false` 和你勾選「留著不用」的券）。
- 決策：把作品分成若干筆訂單，每筆訂單最多用一張券（官方已確認）。券分兩組：
  - **`R`：可重複使用的券**（`is_multiple_use: true` 且沒有次數限制）：每一單都可以用
  - **`L`：有次數限制的券**（`is_multiple_use: false`，或 `usage` 有值）：最多只能用剩下的次數
- 目標（依序比較）：
  1. **實付金額最低**（省下的金額最多）
  2. 金額相同時，**拿到的點數最多**（只有在設定裡勾選「我用特定付款方式」時才比較，見 §10.1 ⑥）
  3. 再相同時，**優先用快到期的券**，把期限長的券留下來
  4. 再相同時，**訂單數最少**（結帳比較省事）

DLsite 是數位商品，沒有運費，所以多分幾單不會多花錢。這也是分單能省錢的原因：一單只能用一張券，但不同作品適用的券不一樣。例如 p1、p2 適用 30% 券，p3 只適用翻譯作品 20% 券，那就分成兩單，各用各的券。

### 12.2 計算方式

1. **券的分組與展開**
   - 剩餘次數 `uᵢ`：`is_multiple_use: false` 且 `usage` 為空 → 1；`usage` 有值 → `max(0, limit − count)`（§10.2 i）；`uᵢ = 0` 的券不使用。
   - `uᵢ ≥ n` 的限次券直接放進 `R`（一張券最多用在 n 單）。其餘 `L` 裡的券展開成 `uᵢ` 張一次性的券 `l₁ … l_{k′}`。

2. **單張券的效益 `save(c, S)`**（`S` 是一單裡的作品）
   - 適用作品 `E(c, S)`：符合 `eligibility`（`custom_genre` 有交集，或 `site_id` 在清單內）；`workFormats` 有值時 `work_type` 要符合；單價沒超過 `maxItemPrice`；不是 `noReduction`；打折中的作品，`appliesToDiscounted` 為 false 時排除，為 null 時依設定（預設排除並標示警告）。
   - 非 `payment` 型：`|E| < minItems` 或 `Σ_{E} 現價 < minSpend` → 0。
     - 折扣率券 → `Σ_{i∈E} floor(現價ᵢ × value / 100)`。**一律用整數運算**：寫成 `Math.floor(price * pct / 100)`，不能寫 `price * 0.35` 或 `price * (pct / 100)`（`180 × (35 / 100)` 會得到 62.999…，捨去後少 1 圓）。
     - 定額券 → `min(value, Σ_{E} 現價)`。
   - `payment` 型：門檻與折抵的基數 `B` = `S` 裡屬於 `eligibility.siteIds` 樓層、且不是 `noReduction` 的作品小計（§10.2 h）。`B < minSpend` 或件數 `< minItems` → 0；否則折抵 `min(value, B)`。樓層外的作品可以放在同一單，但不算進 `B`。
   - 先把所有券對所有子集合的 `save` 算好，存成 `Int32Array`（`(|R| + k′) × 2ⁿ`），DP 時直接查表。

3. **比較用的值**：每一單的值是 tuple `(省下金額, 點數, 到期分數, −1)`，可以直接相加；DP 的 `max` 用字典序比較。
   - 點數：只在勾選「我用特定付款方式」時計算，否則為 0。
   - 到期分數：用券 `c` 時為 `floor(10⁶ / (到期剩餘天數 + 1))`，不用券為 0（用整數，避免浮點誤差）。
   - 最後一項 `−1` 代表這一單算一筆訂單；比較時訂單越少越好。因為這一項，不用券的作品會自動併進其他訂單，不會單獨成一單。

4. **只用 `R` 的分組 DP**：
   `bestR(S) = max( 不用券, max_{c ∈ R} val(c, S) )`
   `g[0] = 0`；`g[mask] = max_{sub ⊆ mask，sub 含 mask 的最低位} ( bestR(sub) + g[mask \ sub] )`
   **`g` 只用 `R` 裡的券**，不能用 `L` 的券，否則同一張一次性券會在好幾單裡各用一次。

5. **加上 `L` 的一次性券**：
   `f[0] = g`
   `f[i][mask] = max( f[i−1][mask], max_{∅ ≠ sub ⊆ mask} ( f[i−1][mask \ sub] + val(lᵢ, sub) ) )`
   答案是 `f[k′][全集]`。第 `i` 張一次性券要嘛不用，要嘛用在某一單 `sub`，剩下的作品交給前 `i−1` 張與 `R`。
   每個狀態記下選擇，最後回溯出每一單的作品與用券。

6. **捷徑**：只有在**所有**可用的券都是 `kind: 'rate'`、不是 `payment` 型、`minSpend = 0`、`minItems ≤ 1`、而且都在 `R` 裡時，每件作品的折扣可以獨立加總，才能「每件作品各自挑最適合的券，再把用同一張券的作品合成一單」，不跑 DP。其他情況一律跑 DP（例如可重複使用的定額券，合成一單反而少折）。

7. **規模與做法**：

| 作品數 n | 運算量（限次券展開後 k′ 張） | 做法 |
|---|---|---|
| ≤ 12 | `(k′+1) × 53 萬` | 試算頁直接算，通常不到 0.1 秒 |
| 13～15 | `(k′+1) × 160 萬～1,400 萬` | 放進 Web Worker 算，約 1～3 秒，畫面不會卡住 |
| > 15 | 太多 | 近似解：先用捷徑處理折扣率券，再對每張定額券與 `payment` 券嘗試「單獨成一單」與「從其他單移入／移出一件」的局部交換，直到沒有改善；畫面標示「近似解」 |

   - 試算只在試算頁執行，不經過 background（service worker 不能建立 Worker）。Web Worker 用 `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` 建立。M8 第一步先確認 WXT 能打包 worker；不行就改成在主執行緒分段計算（每 50 ms 用 `setTimeout` 讓出一次），n 上限維持 15。

8. **點數折抵最後才扣**。如果使用點數不影響門檻（待驗證），點數用在哪一單都一樣，不會改變最佳分單。

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
- n > 15 的近似解：用 n ≤ 12 的隨機案例比較近似解與 DP 的差距，把最大誤差寫進測試報告。
- 邊界案例：
  - 沒有券、所有券都不適用
  - 單價剛好等於 `maxItemPrice`、件數差一件才到 `minItems`
  - 全部作品都在打折，而且券的 `appliesToDiscounted` 是 null
  - 限次券只剩一次、兩張完全相同的券
  - 一張一次性的 `payment` 券「¥400，滿 ¥1,200」配 p1 ¥1,200、p2 ¥1,200 → 只能省 ¥400，不是 ¥800
  - 一張可重複使用、沒有門檻的定額券「¥400」配 p1 ¥300、p2 ¥300 → 分兩單省 ¥600
  - 整數捨去：`(180, 35) → 63`、`(90, 70) → 63`
- 用 §5.4 實測的 7 張券做 fixture（依 §3.3 去識別化），確認解析結果和券面說明一致。

---

## 附錄：參考資料
- Greasy Fork「dlsite 历史价格查询」（MIT）：參考它依頁面文字找價格區塊的插入方式。作品編號比對不沿用它的 `/[VBR]J\d{6,8}/`（沒有錨定，會截斷 9 碼、放行 7 碼），改用 §3.2.2 的 `isWorkId()`。
- `imba-tjd/DLWatcher`（AGPL-3.0）：和 dlwatcher.com 無關的同名專案，資料已停止更新，不使用它的資料或程式碼。只參考它的 ajax API 批次查詢（100 個一組）與 GitHub Actions 排程架構。
- `SPEC_REVIEW.md`：v0.3 的安全、正確性與可行性審查報告，v0.4 依此修改。
