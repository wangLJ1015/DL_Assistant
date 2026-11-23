# DL_Assistant 專案規格書

> 版本：v0.3（草案）　日期：2026-11-23
> 一句話說明：Chrome 擴充功能。把 DLsite 加入購物車的作品自動列入追蹤，定時查價、顯示史低與價格走勢，出現優惠時跳出通知；也能隨時查任一作品的史低，並依你手上的優惠券算出最划算的買法。
>
> v0.2 變更：新增「臨時查史低」（F12～F13）、「優惠券同步」（F14）、「購買試算」（F15～F16）與 §12 試算演算法。
> v0.3 變更：依 DLsite 官方說明與實測的優惠券 API 確認用券規則（§5.4、§10.1、§10.2）；演算法改為支援可重複使用的券；新增「會改變帳號狀態的 GET 網址」白名單規則（§3.4）。

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
- 不讀取點數餘額以外的帳號資料（地址、付款方式、購買紀錄一律不碰）。
- 不爬整個 DLsite，只查追蹤清單裡的作品。
- 瀏覽器關閉時不查價（24 小時監控放在第二階段，見 §9）。

---

## 2. 功能需求

| 編號 | 功能 | 說明 | 優先度 |
|---|---|---|---|
| F1 | 加入購物車自動追蹤 | content script 偵測「カートに入れる」按鈕被點擊，從網址抓出作品編號並加入追蹤清單 | P0 |
| F2 | 購物車同步 | 打開購物車頁面時讀取清單，把漏抓的作品補進追蹤清單（作為 F1 的備援） | P1 |
| F3 | 手動管理 | 在作品頁或 popup 一鍵加入／移除追蹤；可以設定目標價；可以暫停追蹤 | P0 |
| F4 | 定時查價 | 每 6 小時批次查詢 DLsite 現價（可在設定調整，最短 1 小時） | P0 |
| F5 | 史低與歷史 | 從 DLWatcher 取得史低、特價紀錄和每年走勢，一天最多更新一次 | P0 |
| F6 | 優惠通知 | 依通知規則（§6）跳出 Windows 通知，點擊通知會開啟作品頁 | P0 |
| F7 | 儀表板 | 追蹤清單表格（現價、原價、折扣、史低、距史低差距、折扣截止）＋單一作品的價格走勢圖 | P0 |
| F8 | 作品頁徽章 | 在 DLsite 作品頁的價格區塊下方顯示「史低 ¥xxx（期間）」和「追蹤中」狀態 | P1 |
| F9 | Popup | 點擊擴充功能圖示，顯示目前有優惠的追蹤作品摘要 | P1 |
| F10 | 匯入／匯出 | 追蹤清單與查價紀錄匯出成 JSON，可以匯入還原 | P2 |
| F11 | 台幣參考價 | 用 API 的 `locale_price` 顯示台幣約略價格 | P2 |
| F12 | 臨時查史低 | 在**尚未追蹤**的作品頁，點擊頁面上的「查史低」按鈕或 popup 的「查詢這個作品」，顯示史低、期間、最近特價和走勢小圖。**不會加入追蹤清單**，結果旁邊另有「加入追蹤」按鈕可以選擇加入 | P0 |
| F13 | 從連結查史低 | 在搜尋結果、排行榜等列表頁，對作品連結按右鍵 →「DL_Assistant：查史低」，用小視窗顯示結果，一樣不加入追蹤 | P1 |
| F14 | 優惠券同步 | 在任何 DLsite 頁面上（已登入時），content script 以同源請求呼叫優惠券 API（§5.4），把持有的券存到本機；6 小時最多同步一次，popup 也有「立即同步」按鈕 | P0 |
| F15 | 購買試算 | 選擇想買的作品（從購物車、追蹤清單或手動輸入編號，最多 15 件），算出最便宜的「分單＋用券」組合，並列出每一單要放哪些作品、用哪張券、付多少、拿多少點數 | P0 |
| F16 | 試算比較 | 同時列出「全部一起買不用券」「全部一起買用最好的一張券」和「最佳方案」的金額，讓你看出省了多少；也可以勾選「這張券留著不用」再重算 | P1 |

---

## 3. 非功能需求

### 3.1 對外請求的節制
- DLsite ajax API 一次最多查 100 個作品 ID，請求之間間隔至少 1 秒。
- DLWatcher 每個作品 24 小時內最多請求一次（對方回傳 `Cache-Control: max-age=86400`），請求之間間隔至少 2 秒。
- 所有請求帶固定的 User-Agent，遇到 HTTP 429 或 5xx 就用指數退避（exponential backoff），連續失敗 3 次就暫停該來源 6 小時。

### 3.2 安全
- **外部資料一律不用 `innerHTML`**，只用 `textContent` 或框架的預設跳脫。DLWatcher 是第三方網站，它的資料會插進已登入的 DLsite 頁面，所以要防 XSS。
- 所有 API 回應先用 schema（zod）驗證再使用，欄位不符就當作查詢失敗，不讓錯誤的資料進資料庫。
- 擴充功能頁面使用 MV3 預設 CSP，不載入任何遠端腳本。
- `host_permissions` 只開 `https://www.dlsite.com/*` 和 `https://dlwatcher.com/*`。

### 3.3 隱私
- 所有資料只存在本機（`chrome.storage.local` / IndexedDB），不上傳到任何伺服器。
- 送給 DLWatcher 的只有作品編號，不送 cookie、帳號、購物車或優惠券內容。
- 讀取的帳號資料只限三樣：購物車裡的作品編號、持有的優惠券、點數餘額。
- 優惠券資料**永遠不離開本機**：不送給 DLWatcher，匯出 JSON（F10）時預設也不包含，要另外勾選。
- 讀取帳號頁面只用你瀏覽器裡已登入的狀態。擴充功能不保存、不讀取 cookie 或密碼。

### 3.4 帳號頁面的操作邊界
- 對 DLsite 帳號相關頁面只發 GET 請求，不呼叫任何會改變帳號狀態的端點（加入購物車、套用優惠券、結帳、領券）。
- 程式碼裡 DLsite 的網址全部集中在 `lib/api/endpoints.ts`，code review 時一眼就能確認沒有寫入類的請求。
- **DLsite 有些 GET 網址也會改變帳號狀態**，例如 `/home/mypage/coupon`（領券）。所以除了只發 GET，`endpoints.ts` 還要用**白名單**：只允許呼叫列在裡面的網址，其他一律拒絕。另外加一個單元測試，確認白名單裡沒有 `/mypage/coupon`（不含 `/list`）、`/cart`、`/buy` 這類路徑。

### 3.5 臨時查詢的資料處理
- 臨時查史低（F12、F13）的結果只放在 `chrome.storage.session`（瀏覽器關閉就清空），快取 24 小時，**不寫進追蹤清單和查價紀錄**。
- 使用者按「加入追蹤」時，才把快取結果轉存為正式資料。

### 3.6 容錯
- DLsite 和 DLWatcher 都是非官方介面，隨時可能改版。任一來源壞掉時，其他功能要能繼續運作。
- 自己記錄每次查到的價格（§5.3），DLWatcher 停止服務時還有自己的歷史可以用。
- DOM 選擇器集中在一個設定檔，改版時只要改一處。

---

## 4. 系統架構

```
┌──────────────── DLsite 頁面 ────────────────┐
│ content script                              │
│  ├─ 偵測加入購物車 → 傳訊息給 background    │
│  ├─ 讀取購物車頁面 → 同步追蹤清單           │
│  ├─ 作品頁：史低徽章／「查史低」按鈕        │
│  └─ 優惠券頁面：讀取持有的優惠券            │
└──────────────────┬──────────────────────────┘
                   │ chrome.runtime 訊息
┌──────────────────▼──────────────────────────┐
│ background service worker                   │
│  ├─ chrome.alarms 排程（查價、更新歷史）    │
│  ├─ fetchers：DLsite API / DLWatcher        │
│  ├─ 臨時查詢（session 快取，不進追蹤清單）  │
│  ├─ 右鍵選單「查史低」（contextMenus）      │
│  ├─ 通知規則引擎 → chrome.notifications     │
│  └─ storage 存取層                          │
└──────────────────┬──────────────────────────┘
                   │
     ┌─────────────┼──────────────┐
┌────▼─────┐ ┌─────▼──────┐ ┌─────▼──────────┐
│ popup    │ │ 儀表板頁面 │ │ 購買試算頁面   │
│ 優惠摘要 │ │ 表格＋走勢 │ │ 分單＋用券建議 │
│ 查這個作品│ └────────────┘ │（純前端計算）  │
└──────────┘                └────────────────┘
```

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
| `work_image` | `//img.dlsite.jp/...` | 縮圖 |
| `price` / `official_price` | 1386 / 1980 | 現價、原價（日圓含稅） |
| `discount_rate` | 30 | 折扣 % |
| `is_discount` | true | 是否正在打折 |
| `discount_end_date` | `11/26 13:59` | 折扣截止（沒有年份，日本時間，要自己補年份） |
| `campaign_id` | `t825ai` | 判斷是不是同一檔活動，避免重複通知 |
| `default_point_rate` | 6 | 點數回饋率 |
| `locale_price` | `{ "en_US": 8.73, ... }` | 各幣別參考價 |
| `is_sold_out` / `sales_end_info` | | 下架或停售判斷 |
| `site_id` / `work_type` | `home` / `SOU` | 樓層與作品形式，用來比對券的適用範圍 |
| `custom_genres` | `["20261016coupon50", ...]` | **作品被列入哪些活動分類**。券的 `custom_genre` 條件就是比對這裡，試算靠它判斷作品能不能用券 |
| `is_noreduction` | false | 推測是「不能用券」，待確認 |

### 5.4 DLsite 優惠券 API（持有的券，2026-11-23 實測，需登入）

```
GET https://www.dlsite.com/home/mypage/coupon/list/ajax
```
- 優惠券管理頁面（`/home/mypage/coupon/list`）就是呼叫這支 API 拿資料，回傳持有券的陣列。用已登入的瀏覽器以同源請求呼叫即可，不用解析 HTML。
- ⚠️ 回應內容是 JSON，但 `Content-Type` 是 `text/html`。程式要用 `response.text()` 再 `JSON.parse`，**不能**用 Content-Type 判斷。未登入時會被導向 `login.dlsite.com`，回傳登入頁的 HTML，`JSON.parse` 失敗就當作「未登入」。
- 一次回傳全部樓層、包含 R18 的券（實測 6 張全部回傳），頁面上的樓層篩選只是前端過濾。
- 會用到的欄位：

| 欄位 | 範例 | 說明 |
|---|---|---|
| `coupon_id` / `coupon_name` | `dojin_30peroff_20261116` | 識別碼與名稱 |
| `discount_type` / `discount` | `rate` / `"30"`，`price` / `"400"` | 折扣方式與數值（字串，要轉數字） |
| `is_multiple_use` | true / false | true：期間內可以重複使用；false：每人限用一次 |
| `is_affect_to_payment` | true | 折抵整筆結帳金額（定額券實測為 true） |
| `limit_date` | 1796227116 | **實際到期時間**（Unix 秒）。定額券是領券後 10 天，比 `end_date` 早 |
| `encrypted_code` | 一串編碼 | 不需要，**不儲存** |
| `limited_usage_count` / `limited_usage_limit` | null | 有次數限制的券才有值 |
| `condition_type` | `custom_genre`、`site_ids` 或 `payment` | 適用範圍的判斷方式。`payment` 是整筆結帳折抵 |
| `conditions.custom_genre` | `["20261116coupon30"]` | 對應作品的 `custom_genres` |
| `conditions.site_ids` | `["home", "maniax", ...]` | 對應作品的 `site_id`（含 `touch` 版） |
| `conditions.maximum_applicable_price` | `"2749"` | 單價上限，超過就不適用 |
| `conditions.price_sum` | `0` 或 `[1200]` | 金額門檻。型別不固定，數字或陣列都要接受 |
| `conditions.post_condition` | `{ "count": 3, "price": 1 }` | 至少買 3 件適用作品（`price` 的意思待確認） |
| `condition_info` | HTML 文字 | 使用條件說明，例如「割引中の作品にも適用出来ます」 |
| `start_date` / `end_date` | `2026-11-28 23:59:59` | 有效期間（日本時間） |
| `is_doujin_coupon` / `is_books_coupon` / `is_pc_coupon` / `is_app_coupon` / `is_ai_coupon` / `is_adult_coupon` | | 適用樓層旗標 |

> ⚠️ **不要呼叫 `GET /home/mypage/coupon`**（少了 `/list`）。這是**領券**端點，實測打開會嘗試發券（這次因為沒有可領的券而顯示「クーポン発行 エラー」）。這個網址要列進 §3.4 的禁止清單。

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

### 5.3 本機資料模型

```ts
// 追蹤清單（chrome.storage.local，key: "items"）
interface TrackedItem {
  id: string;              // RJ01014447
  site: string;            // maniax / home / books ...（從網址判斷）
  title: string;
  imageUrl: string;
  addedAt: string;         // ISO 時間
  source: 'cart' | 'manual' | 'import';
  targetPrice?: number;    // 使用者設定的目標價（日圓）
  paused: boolean;
}

// 最新狀態（key: "snapshots"，以 id 為 key）
interface PriceSnapshot {
  id: string;
  price: number;
  officialPrice: number;
  discountRate: number;
  discountEnd?: string;    // 已補上年份的 ISO 時間
  campaignId?: string;
  pointRate: number;
  checkedAt: string;
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

// 自己的查價紀錄（IndexedDB "priceLog"，只在價格變動時新增一筆）
interface PriceLogEntry {
  id: string;
  price: number;
  discountRate: number;
  at: string;
}

// 持有的優惠券（chrome.storage.local，key: "coupons"）
// 欄位對應 §5.4 優惠券 API 的實際回應
interface Coupon {
  id: string;                    // coupon_id，例："dojin_30peroff_20261116"
  name: string;                  // coupon_name
  kind: 'rate' | 'price';        // discount_type：折扣率 "rate"／定額 "price"（兩種都已實測）
  value: number;                 // discount，例：30（%）或 400（日圓）
  multiUse: boolean;             // is_multiple_use：false 代表每人只能用一次（實測定額券是 false）
  usage?: { used: number; limit: number };   // limited_usage_count / limited_usage_limit
  eligibility:
    | { type: 'custom_genre'; genres: string[] }   // 作品的 custom_genres 有交集才適用
    | { type: 'site_ids'; siteIds: string[] }      // 作品的 site_id 在清單內才適用
    | { type: 'payment'; siteIds: string[] };      // 整筆結帳折抵：distribute_targets 樓層內的作品都算
  affectsPayment: boolean;       // is_affect_to_payment：true 代表折抵整筆結帳金額，而不是逐件打折
  maxItemPrice?: number;         // conditions.maximum_applicable_price：單價超過就不適用（同人樓層，例：2749）
  minSpend?: number;             // conditions.price_sum：使用門檻。實測可能是數字 0 或陣列 [1200]，兩種都要處理
  minItems?: number;             // conditions.post_condition.count：至少一起買幾件適用作品
  appliesToDiscounted: boolean | null;  // 從 condition_info 文字判斷：「割引中の作品にも適用」→ true；沒寫 → null（未知）
  floors: { doujin: boolean; books: boolean; pc: boolean; app: boolean; ai: boolean; female: boolean; adult: boolean };
  startsAt: string;              // start_date（日本時間）
  expiresAt: string;             // limit_date（Unix 秒）才是這張券對你的實際到期時間；end_date 是活動結束日，不一定相同
  conditionText: string;         // condition_info 去掉 HTML 後的原文，顯示給使用者核對
  syncedAt: string;
}

// 作品的用券相關資訊（來自 §5.1 商品 API，存在 PriceSnapshot 裡）
interface CouponFacts {
  siteId: string;                // site_id，例："home"
  workType: string;              // work_type，例："SOU"（音聲）
  customGenres: string[];        // custom_genres，用來比對 custom_genre 型的券
  noReduction: boolean;          // is_noreduction（推測是「不能用券」，待確認）
}

// 已送出的通知（避免重複，key: "notified"）
interface NotifiedKey {
  id: string;
  rule: string;            // sale / target / lowest / ending
  campaignId: string;      // 同一檔活動同一規則只通知一次
  at: string;
}
```

---

## 6. 通知規則

| 規則 | 觸發條件 | 預設 |
|---|---|---|
| `sale` | 作品從原價變成打折 | 開 |
| `target` | 現價 ≤ 使用者設定的目標價 | 開 |
| `lowest` | 現價 ≤ 史低（DLWatcher 史低和自己紀錄的最低價取較低者） | 開 |
| `ending` | 符合上面任一條件，且折扣在 24 小時內結束 | 開 |
| `deeper` | 同一檔活動中折扣又加深 | 關 |
| `couponExpiring` | 持有的優惠券 7 天內到期，而且追蹤清單裡有作品可以用這張券 | 開 |

- 同一作品、同一規則、同一 `campaign_id` 只通知一次。
- 同一次查價有多個作品符合時，合併成一則通知（「3 個追蹤作品正在特價」）。
- 通知內容：作品名稱、現價／原價、折扣、和史低差多少、截止時間。
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
| 測試 | **Vitest**（單元測試：API 解析、通知規則、日期換算） | 和 WXT／Vite 整合，不用額外設定 |
| 套件管理 | **pnpm** | 安裝快、省空間 |
| 程式碼品質 | ESLint ＋ Prettier | |

### 7.1 需要的權限（manifest）
```json
{
  "permissions": ["storage", "alarms", "notifications", "unlimitedStorage", "contextMenus"],
  "host_permissions": ["https://www.dlsite.com/*", "https://dlwatcher.com/*"]
}
```

---

## 8. 專案結構（預定）

```
DL_Assistant/
├─ SPEC.md
├─ wxt.config.ts
├─ package.json
├─ src/
│  ├─ entrypoints/
│  │  ├─ background.ts          # 排程、查價、通知
│  │  ├─ dlsite.content.ts      # 偵測加入購物車、作品頁徽章
│  │  ├─ coupon.content.ts      # 讀取「我的優惠券」頁面
│  │  ├─ popup/                 # 優惠摘要、查詢這個作品
│  │  ├─ dashboard/             # 儀表板（表格＋走勢圖）
│  │  └─ planner/               # 購買試算頁面
│  ├─ lib/
│  │  ├─ api/endpoints.ts       # 所有 DLsite / DLWatcher 網址（只有 GET）
│  │  ├─ api/dlsite.ts          # DLsite API 與 zod schema
│  │  ├─ api/dlwatcher.ts       # DLWatcher API 與 zod schema
│  │  ├─ lookup.ts              # 臨時查史低（session 快取）
│  │  ├─ coupons/parse.ts       # 優惠券頁面解析
│  │  ├─ planner/optimize.ts    # 分單＋用券最佳化（§12）
│  │  ├─ planner/worker.ts      # 件數多時在 Web Worker 裡計算
│  │  ├─ storage.ts             # storage / IndexedDB 存取層
│  │  ├─ rules.ts               # 通知規則引擎
│  │  ├─ dates.ts               # 折扣截止補年份、走勢點換算日期
│  │  └─ selectors.ts           # DLsite DOM 選擇器（集中管理）
│  └─ components/               # 共用 React 元件
└─ tests/                       # Vitest 測試與 API 回應範例
```

---

## 9. 開發里程碑

| 階段 | 內容 | 完成標準 |
|---|---|---|
| M1 骨架 | WXT 專案、storage 存取層、DLsite API 查價、手動加入追蹤 | 在 popup 手動加一個作品，看得到現價 |
| M2 自動追蹤 | content script 偵測加入購物車、購物車同步 | 在 DLsite 加入購物車後，追蹤清單自動多一筆 |
| M3 史低 | DLWatcher 串接、歷史資料存 IndexedDB | 每個追蹤作品都有史低和期間 |
| M4 通知 | alarms 排程、通知規則、去重 | 作品打折時收到一次通知，不重複 |
| M5 儀表板 | 表格、走勢圖、等待建議 | 一頁看完所有追蹤作品的價格狀況 |
| M6 作品頁徽章與臨時查詢 | 作品頁史低徽章、「查史低」按鈕、popup 查詢、右鍵選單 | 未追蹤的作品也查得到史低，而且追蹤清單沒有多出東西 |
| M7 優惠券同步 | 解析「我的優惠券」頁面、儲存、到期提醒 | 打開優惠券頁面後，擴充功能裡的券和網站上一致 |
| M8 購買試算 | §12 最佳化演算法、試算頁面、比較表 | 用 10 件作品＋3～5 張券測試，結果和手算（或暴力窮舉）一致 |
| 第二階段（選做） | Python ＋ GitHub Actions 每日查價，推播到 Discord / Telegram | 瀏覽器沒開也收得到通知 |

---

## 10. 待驗證事項（實作前要先確認）

| 項目 | 要確認的事 |
|---|---|
| 加入購物車按鈕 | 各分站（maniax、home、books…）按鈕的 DOM 結構是否一致；是否有用 AJAX 加入、不換頁 |
| 購物車頁面 | 網址與作品編號在 DOM 裡的位置 |
| 分站差異 | 用 `maniax` 路徑查 `home` 的作品是否都查得到（目前實測可以） |
| 預購與套組作品 | `is_reserve_work`、套組作品的價格欄位是否不同 |
| `discount_end_date` | 跨年的折扣（例如 12 月開始、1 月結束）如何補年份 |
| DLWatcher 覆蓋率 | 冷門或新作品是否查得到（查不到時只用自己的紀錄） |
| ~~優惠券頁面~~ | ✅ 已確認：有 JSON API，見 §5.4 |
| **用券規則**（試算正確性的關鍵） | 見 §10.1 與 §10.2 |
| ~~作品類型欄位~~ | ✅ 已確認：商品 API 有 `site_id`、`work_type`、`custom_genres` |
| まとめ買い（組合折扣） | API 的 `bulkbuy_key` 代表有組合折扣活動，v1 試算先不計入，只提示「這幾件有組合折扣」 |

> 用券規則會先從 DLsite 的說明頁與優惠券頁面上的文字確認，再用一筆小額實際訂單驗證（由你自己操作）。§12 的演算法把這些規則都做成參數，確認後只要改設定，不用改演算法。

### 10.1 已確認的用券與點數規則（2026-11-23，來源：DLsite ユーザーヘルプ）

| # | 規則 | 官方說法（摘要） | 對試算的影響 |
|---|---|---|---|
| ① | **一筆結帳只能用 1 張券，不能併用** | 「1決済につき1枚のみ」 | 確認分單有意義：想用兩張券就要分兩次結帳 |
| — | **券和點數可以一起用** | 「ポイントとクーポンは併用いただけます」 | 點數最後扣，不影響怎麼分單 |
| — | **折扣逐件計算、尾數無條件捨去** | 「作品ごとに割引金額を算定し、端数が出た場合は原則切捨て」（商業電子書籍依出版社規則） | 折扣率券的折扣是 `Σ floor(單價 × 折扣率)`，不是 `floor(小計 × 折扣率)` |
| — | **適用條件的種類** | 指定作品、指定樓層（同人／PCソフト・美少女ゲーム／電子書籍）、指定作品形式（マンガ・CG・イラスト／ボイス・ASMR／ゲーム）、最低金額、**一起購買的件數** | 資料模型加上 `floors`、`workFormats`、`minItems` |
| — | 券的條件在「マイページ → クーポン管理」查看，可依樓層篩選，R18 券要勾選「男性向け(R18)クーポンを表示」才會出現 | | 同步優惠券時要切換所有樓層並勾選 R18，才能讀到全部的券 |
| ⑥ | **點數回饋只限特定付款方式**（目前是「みんなの銀行」「viviONカード」），回饋按扣掉券與點數之後的金額計算 | 「ポイント・クーポン利用分を差し引いた金額に対して還元」 | 大多數人用券後拿不到點數。試算預設**不把點數當比較條件**，設定裡勾選「我用特定付款方式」才計入 |
| — | 點數 1 點 = 1 圓，最後一次取得或使用點數後 1 年全部失效 | | 試算可以提醒點數快到期 |
| — | 結帳失敗時，券約 30 分～3 小時後自動退回 | | 試算頁提示：結帳失敗不用擔心券被吃掉 |

以下來自優惠券 API 的實際資料（2026-11-23，帳號持有 6 張券）：

| 規則 | 實際資料 | 對試算的影響 |
|---|---|---|
| **大部分券可以重複使用** | 6 張全是 `is_multiple_use: true`，說明寫「有効期間中、お一人様何回でも利用できます」 | 演算法不能假設「一張券只能用一次」。可重複使用的券，每一單都能用（但每單仍然只能用一張） |
| **適用範圍靠活動分類比對** | `condition_type: custom_genre` 的券，比對作品的 `custom_genres`；`site_ids` 型的券比對作品的 `site_id` | 不用猜作品屬於哪一類，直接比對商品 API 的欄位就能判斷 |
| **只有適用的作品會打折** | 「割引対象作品を複数ご購入の場合、全てに割引が適用されます」 | 同一單裡不適用的作品照原價，折扣只算適用的那幾件 |
| **單價上限** | `maximum_applicable_price: 2749`：「同人フロアの作品では、税込2,749円までがクーポン対象」，其他樓層沒有上限 | 單價超過上限的同人作品不能用這張券 |
| **最少件數** | `post_condition.count: 3`：「割引対象作品を3本以上ご購入の場合」 | 要湊滿 3 件適用作品，這張券才有效 |
| **打折中能不能用券，每張券不同** | 有些券寫「割引中の作品にも適用出来ます」或名稱標【割引併用可】，有些沒寫 | 沒寫的當作「未知」，試算時用警告標示，不直接當成可用 |
| **折扣是用現價（特價）計算** | 「割引中の作品にも適用」的券，折扣以作品當下價格計算 | 試算用 API 的 `price`，不是 `official_price` |

### 10.2 還沒確認的事（要你在購物車操作一次才能確定）

| # | 問題 | 目前的預設 | 驗證方式 |
|---|---|---|---|
| a | 「單價上限 2,749 円」是**超過就整件不適用**，還是**只算到 2,749 円**為止 | 超過就不適用 | 把一件 3,000 円以上的同人作品放進購物車，看 15% 券的折扣金額 |
| b | 沒寫「割引中にも適用」的券，能不能用在打折中的作品 | 未知，標示警告 | 購物車選券時看折扣有沒有算進去 |
| c | `price_sum`（金額門檻）看的是適用作品小計還是整單 | `payment` 型：整單（定額券說明寫「此優惠券可用於所有作品」）；其他型：適用作品小計 | 折扣率券目前門檻都是 0，等有門檻的折扣率券再驗證 |
| d | `post_condition.price: 1` 的意思 | 忽略 | 等有不同數值的券再比對 |
| ~~e~~ | ~~定額券的 `discount_type` 值~~ | ✅ 已確認是 `"price"`（見下方） | |
| g | 定額券在同一單裡怎麼分攤到各作品 | 整單折抵，不逐件分攤 | 只影響點數回饋的計算，預設不比點數，所以優先度低 |
| f | 商品 API 的 `is_noreduction` 是不是「不能用券」 | 是 | 找一件 `is_noreduction: true` 的作品放進購物車確認 |

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
- 一次性的券確實存在，§12.2 第 3 步「限次券」那層 DP 是必要的，不能省。
- `payment` 型的券：門檻看整筆訂單小計，折抵 `min(面額, 小計)`。所以不適用其他券的作品也可以放進這一單，幫忙湊滿 1,200。演算法在算 `save(c, S)` 時要用整單小計，不是適用小計。
- 到期時間一律讀 `limit_date`。如果用 `end_date`，這張券會被當成多活 28 天，到期提醒就會錯。
- 頁面 HTML 只有顯示用的文字，**解析一律用 §5.4 的 JSON API**，HTML 只當作 API 失效時的備援。

---

## 11. 風險

| 風險 | 影響 | 對策 |
|---|---|---|
| DLsite 改版或改 API | 查價或偵測購物車失效 | zod 驗證及早發現；選擇器集中管理；儀表板顯示「最後成功查價時間」 |
| DLWatcher 停止服務或改格式 | 沒有史低與歷史 | 自己保留查價紀錄；DLWatcher 失敗時改用自己的最低價 |
| DLWatcher 回傳惡意內容 | XSS 打到已登入的 DLsite 頁面 | 不用 `innerHTML`、zod 驗證、只取數字與日期欄位 |
| 違反網站使用規範 | 被封鎖 | 低頻請求、批次查詢、尊重快取時間 |
| 瀏覽器關閉時沒查價 | 錯過短期特價 | 第二階段改用 GitHub Actions 每日查價 |
| 用券規則理解錯誤 | 試算建議實際上用不了或不是最省 | 規則參數化；試算結果標示「依目前規則設定」；結帳前請以 DLsite 購物車顯示的金額為準 |
| 優惠券頁面改版 | 同步失敗或讀錯券 | zod 驗證；同步後顯示券數量讓你核對；讀不到時保留上次的資料並標示同步時間 |
| 誤觸帳號操作 | 改到帳號狀態 | §3.4：只發 GET、網址集中管理、不碰購物車與結帳端點 |

---

## 12. 購買試算演算法

### 12.1 問題定義
- 輸入：想買的作品 `P = {p1 … pn}`（每件有現價、原價、分站、作品類型、社團、是否打折中、點數回饋率），以及持有的優惠券 `C = {c1 … ck}`。
- 決策：把作品分成若干筆訂單，每筆訂單最多用一張券（官方已確認）。券分兩種：
  - **可重複使用的券**（`is_multiple_use: true`，目前看到的都是）：每一單都可以用
  - **有次數限制的券**（`limited_usage_limit` 有值，或不可重複使用）：最多只能用剩下的次數
- 目標（依序比較）：
  1. **實付金額最低**
  2. 金額相同時，**拿到的點數最多**（只有在設定裡勾選「我用特定付款方式」時才比較，見 §10.1 ⑥）
  3. 再相同時，**優先用快到期的券**，把期限長的券留下來
  4. 再相同時，**訂單數最少**（結帳比較省事）

DLsite 是數位商品，沒有運費，所以多分幾單不會多花錢。這也是分單能省錢的原因：一單只能用一張券，但不同作品適用的券不一樣。例如 p1、p2 適用 30% 券，p3 只適用翻譯作品 20% 券，那就分成兩單，各用各的券。

### 12.2 計算方式
1. **單張券的效益**：對券 `c` 和作品子集合 `S`，計算 `save(c, S)`：
   - 找出 `S` 裡適用 `c` 的作品：符合 `custom_genre` 或 `site_ids` 條件、單價沒超過 `maxItemPrice`、不是 `noReduction`；打折中的作品，`appliesToDiscounted` 為 false 時排除，為 null 時依設定（預設排除並標示警告）
   - 適用作品的件數少於 `minItems`，或小計沒達到 `minSpend` → 0
   - 折扣率券 → `Σ floor(現價ᵢ × 折扣率)`（逐件捨去，官方已確認）；定額券 → `min(面額, 適用小計)`
   - `payment` 型的券（實測的定額券就是這種）：門檻和折抵都看 `S` 的**整單小計**，所以不適用其他券的作品放進這一單也能幫忙湊門檻
   - 單一訂單的最佳節省：`best(S) = max_c save(c, S)`
2. **只有可重複使用的券時（目前的實際情況）**：問題變成「把作品分組，每組挑最好的一張券」。
   `g[mask] = max_{sub ⊆ mask，sub 含 mask 的最低位} ( best(sub) + g[mask \ sub] )`
   複雜度 `O(3ⁿ + k × 2ⁿ)`。
   如果沒有門檻與件數條件，結果會退化成「每件作品各自用最適合的券，再把用同一張券的作品合成一單」，可以直接算出來，不用跑 DP。
3. **有次數限制的券**：在 `g` 的基礎上，對每張限次券 `cᵢ`（剩 `uᵢ` 次）再做一層子集合 DP：
   `f[i][mask] = max( f[i-1][mask], max_{sub ⊆ mask} f[i-1][mask \ sub] + save(cᵢ, sub) )`，`f[0] = g`
   次數大於 1 的限次券，把它展開成 `uᵢ` 張一次性的券。
4. 複雜度與做法：

| 作品數 n | 運算量（限次券 k′ 張） | 做法 |
|---|---|---|
| ≤ 12 | `(k′+1) × 53 萬` | 頁面上直接算，通常不到 0.1 秒 |
| 13～15 | `(k′+1) × 160 萬～1400 萬` | 放進 Web Worker 算，約 1～3 秒，畫面不會卡住 |
| > 15 | 太多 | 先用「每件作品挑最適合的券再合併」的貪婪解，再做局部交換優化；畫面標示「近似解」 |

4. 點數折抵最後才扣。如果使用點數不影響門檻（待驗證），點數用在哪一單都一樣，不會改變最佳分單。

### 12.3 輸出範例

| 訂單 | 作品 | 小計 | 使用的券 | 折扣 | 實付 | 獲得點數 |
|---|---|---|---|---|---|---|
假設持有三張可重複使用的券：A＝對象同人作品 30%OFF、B＝翻譯作品 20%OFF、C＝全站 15%OFF（同人單價 ≤ ¥2,749）。

| 訂單 | 作品 | 小計 | 使用的券 | 折扣 | 實付 |
|---|---|---|---|---|---|
| #1 | p1、p4、p7（A 的對象作品） | ¥3,520 | A 30%OFF | −¥1,056 | ¥2,464 |
| #2 | p2、p5（翻譯作品，不是 A 的對象） | ¥1,650 | B 20%OFF | −¥330 | ¥1,320 |
| #3 | p3、p6、p8、p9（單價都 ≤ ¥2,749） | ¥2,200 | C 15%OFF | −¥330 | ¥1,870 |
| #4 | p10（¥780，什麼券都不適用） | ¥780 | 不用券 | — | ¥780 |
| **合計** | 10 件 | ¥8,150 | | **−¥1,716** | **¥6,434** |

折扣是逐件捨去後加總，這裡為了好讀，假設每件都剛好整除。勾選「我用特定付款方式」時，會多一欄可得點數。

比較列：全部一起買不用券 ¥8,150／全部一起買，只用效果最好的一張券 ¥7,094（假設只用 A，只有 p1、p4、p7 打折）／**最佳方案 ¥6,434**。

### 12.4 結合史低資訊
- 試算表每件作品旁邊顯示「現價 vs 史低」。如果某件作品現價比史低高很多，而且一年有超過 150 天在打折，就標示「建議等特價」，並提供「排除這件再算一次」的按鈕。
- 優惠券快到期（7 天內）時在試算頁置頂提醒，也可以加入 §6 的通知規則（`couponExpiring`）。

### 12.5 測試
- 用暴力窮舉（列舉所有分組方式，每組挑最好的券）當標準答案，對 n ≤ 8 的隨機案例比對 DP 結果，用 Vitest 跑數百組。
- 邊界案例：沒有券、所有券都不適用、單價剛好等於 `maxItemPrice`、件數差一件才到 `minItems`、全部作品都在打折而且券的 `appliesToDiscounted` 是 null、限次券只剩一次、兩張完全相同的券。
- 用 §5.4 實測的 6 張券做 fixture（去掉個人資訊），確認解析結果和券面說明一致。

---

## 附錄：參考資料
- Greasy Fork「dlsite 历史价格查询」（MIT）：作品編號比對 `/[VBR]J\d{6,8}/`、依頁面文字找價格區塊的插入方式。
- `imba-tjd/DLWatcher`（AGPL-3.0）：和 dlwatcher.com 無關的同名專案，資料已停止更新，不使用它的資料或程式碼。只參考它的 ajax API 批次查詢（100 個一組）與 GitHub Actions 排程架構。
