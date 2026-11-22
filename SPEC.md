# DL_Assistant 專案規格書

> 版本：v0.2（草案）　日期：2026-11-23
> 一句話說明：Chrome 擴充功能。把 DLsite 加入購物車的作品自動列入追蹤，定時查價、顯示史低與價格走勢，出現優惠時跳出通知；也能隨時查任一作品的史低，並依你手上的優惠券算出最划算的買法。
>
> v0.2 變更：新增「臨時查史低」（F12～F13）、「優惠券同步」（F14）、「購買試算」（F15～F16）與 §12 試算演算法。

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
| F14 | 優惠券同步 | 打開 DLsite「我的優惠券」頁面時，content script 讀取持有的優惠券（折扣、門檻、上限、適用範圍、到期日）存到本機；popup 也有「立即同步」按鈕 | P0 |
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
interface Coupon {
  id: string;                    // 優惠券在頁面上的識別碼（實作時確認）
  name: string;                  // 例：「同人作品 30%OFF クーポン」
  kind: 'percent' | 'fixed';     // 折扣率 或 定額折抵
  value: number;                 // 30（%）或 300（日圓）
  maxDiscount?: number;          // 折扣上限（日圓），例：最多折 1000 円
  minSpend?: number;             // 使用門檻（日圓），例：滿 1500 円才能用
  scope: {                       // 適用範圍，全部未填代表全站適用
    sites?: string[];            // maniax / home / books ...
    workTypes?: string[];        // 遊戲、音聲、漫畫 ...
    makerIds?: string[];         // 指定社團
    productIds?: string[];       // 指定作品
  };
  excludeDiscounted: boolean;    // 打折中的作品不能用
  expiresAt: string;             // 到期時間
  syncedAt: string;
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
| **優惠券頁面** | 網址、DOM 結構、券的識別碼；分頁或「顯示更多」怎麼處理 |
| **用券規則**（試算正確性的關鍵） | ① 一筆訂單最多能用幾張券 ② 門檻是看「適用作品的小計」還是「整筆訂單」 ③ 折扣率券是用原價還是特價計算 ④ 打折中作品能不能用券 ⑤ 折扣上限怎麼算 ⑥ 點數回饋是用用券後的金額計算嗎 ⑦ 使用點數折抵會不會影響門檻 |
| 作品類型欄位 | ajax API 裡有沒有作品類型（遊戲、音聲…）可以比對券的適用範圍，沒有的話要從作品頁解析 |
| まとめ買い（組合折扣） | API 的 `bulkbuy_key` 代表有組合折扣活動，v1 試算先不計入，只提示「這幾件有組合折扣」 |

> 用券規則會先從 DLsite 的說明頁與優惠券頁面上的文字確認，再用一筆小額實際訂單驗證（由你自己操作）。§12 的演算法把這些規則都做成參數，確認後只要改設定，不用改演算法。

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
- 決策：把作品分成若干筆訂單，每筆訂單最多用一張券（張數做成參數，待驗證），每張券最多用一次。
- 目標（依序比較）：
  1. **實付金額最低**
  2. 金額相同時，**拿到的點數最多**
  3. 再相同時，**優先用快到期的券**，把期限長的券留下來
  4. 再相同時，**訂單數最少**（結帳比較省事）

DLsite 是數位商品，沒有運費，所以多分幾單不會多花錢。這也是分單能省錢的原因：例如兩張「滿 1500 折 300」的券，把作品拆成兩單各湊滿 1500，就能兩張都用到。

### 12.2 計算方式
1. **單張券的效益表**：對每張券 `c` 和每個作品子集合 `S`（共 `k × 2ⁿ` 種），計算 `save(c, S)`：
   - `S` 裡適用這張券的作品小計，扣掉打折中且不能用券的作品
   - 沒達到門檻 → 0
   - 折扣率券 → `min(小計 × 折扣率, 上限)`；定額券 → `min(面額, 小計)`
   - 門檻看「適用小計」還是「整單小計」由規則參數決定。如果看整單，把不適用的作品放進同一單也能幫忙湊門檻，演算法會自動考慮進去
2. **子集合動態規劃**：`f[i][mask]` 表示只用前 `i` 張券、把 `mask` 這些作品分配到用券訂單時的最大節省金額
   `f[i][mask] = max( f[i-1][mask], max_{sub ⊆ mask} f[i-1][mask \ sub] + save(cᵢ, sub) )`
   沒被分到任何券的作品，合成一筆不用券的訂單。
3. 複雜度 `O(k × 3ⁿ)`：

| 作品數 n | 券數 k=5 時的運算量 | 做法 |
|---|---|---|
| ≤ 12 | 約 270 萬 | 頁面上直接算，不到 0.1 秒 |
| 13～15 | 約 800 萬～7200 萬 | 放進 Web Worker 算，約 1～3 秒，畫面不會卡住 |
| > 15 | 太多 | 先用貪婪法（把作品依價格排序，逐張券湊門檻）再做局部交換優化；畫面標示「近似解」 |

4. 點數折抵最後才扣。如果使用點數不影響門檻（待驗證），點數用在哪一單都一樣，不會改變最佳分單。

### 12.3 輸出範例

| 訂單 | 作品 | 小計 | 使用的券 | 折扣 | 實付 | 獲得點數 |
|---|---|---|---|---|---|---|
| #1 | p1、p4、p7 | ¥3,520 | 同人 30%OFF（上限 ¥1,000） | −¥1,000 | ¥2,520 | 151 pt |
| #2 | p2、p5 | ¥1,650 | 滿 ¥1,500 折 ¥300 | −¥300 | ¥1,350 | 81 pt |
| #3 | p3、p6、p8～p10 | ¥2,980 | 不用券 | — | ¥2,980 | 178 pt |
| **合計** | 10 件 | ¥8,150 | | **−¥1,300** | **¥6,850** | 410 pt |

比較列：全部一起買不用券 ¥8,150／全部一起買只用最好的一張券 ¥7,150／**最佳方案 ¥6,850**。

### 12.4 結合史低資訊
- 試算表每件作品旁邊顯示「現價 vs 史低」。如果某件作品現價比史低高很多，而且一年有超過 150 天在打折，就標示「建議等特價」，並提供「排除這件再算一次」的按鈕。
- 優惠券快到期（7 天內）時在試算頁置頂提醒，也可以加入 §6 的通知規則（`couponExpiring`）。

### 12.5 測試
- 用暴力窮舉（每件作品分配到「第幾張券或不用券」，共 `(k+1)ⁿ` 種）當標準答案，對 n ≤ 8 的隨機案例比對 DP 結果，用 Vitest 跑數百組。
- 邊界案例：沒有券、所有券都沒達到門檻、券的上限剛好卡住、全部作品都在打折而且券不能用在打折品、兩張完全相同的券。

---

## 附錄：參考資料
- Greasy Fork「dlsite 历史价格查询」（MIT）：作品編號比對 `/[VBR]J\d{6,8}/`、依頁面文字找價格區塊的插入方式。
- `imba-tjd/DLWatcher`（AGPL-3.0）：和 dlwatcher.com 無關的同名專案，資料已停止更新，不使用它的資料或程式碼。只參考它的 ajax API 批次查詢（100 個一組）與 GitHub Actions 排程架構。
