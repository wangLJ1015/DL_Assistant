# DL_Assistant 專案規格書

> 版本：v0.11（草案，M2 審查後更新）　日期：2026-11-23
> 一句話說明：Chrome 擴充功能。把 DLsite 加入購物車的作品自動列入追蹤，定時查價、顯示史低與價格走勢，出現優惠時跳出通知；也能隨時查任一作品的史低，並依你手上的優惠券算出最划算的買法。
>
> 變更紀錄見 [CHANGELOG.md](CHANGELOG.md)。規格分成四個檔案，章節編號跨檔案沿用：
> - 本檔：§1～§2、§3.1、§3.3、§3.5～§3.7、§4～§6、§7 技術棧表、§8、§9、§11
> - [docs/security.md](docs/security.md)：§3.2、§3.4、§7.1、§7.2
> - [docs/planner.md](docs/planner.md)：§10.1、§10.2、§12
> - [docs/verification.md](docs/verification.md)：§10 待驗證表格、§10.3

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
| F10 | 匯出 | 追蹤清單與查價紀錄匯出成 JSON（§3.7）。**匯入移到第二階段**：匯入要處理惡意檔案、合併與預覽，規則多、v1 用處小 | P2 |
| F11 | 台幣參考價 | 用 API 的 `locale_price` 顯示台幣約略價格 | P2 |
| F12 | 臨時查史低 | 在**尚未追蹤**的作品頁，點擊頁面上的「查史低」按鈕或 popup 的「查詢這個作品」，顯示史低、期間、最近特價和走勢小圖。**不會加入追蹤清單**，結果旁邊另有「加入追蹤」按鈕可以選擇加入 | P0 |
| F13 | 從連結查史低 | 在搜尋結果、排行榜等列表頁，對作品連結按右鍵 →「DL_Assistant：查史低」，開啟擴充功能自己的小視窗（`lookup.html`）顯示結果，一樣不加入追蹤 | P1 |
| F14 | 優惠券同步 | 在 DLsite 頁面上（已登入時），content script 以同源請求呼叫優惠券 API（§5.4），把持有的券存到本機；6 小時最多同步一次，popup 也有「立即同步」按鈕（流程見下方） | P0 |
| F15 | 購買試算 | 選擇想買的作品（從購物車、追蹤清單或手動輸入編號，最多 15 件；「購物車」是最近一次打開購物車頁面時讀到的作品，存在 `lastCart`，畫面標示讀取時間），算出最便宜的「分單＋用券」組合，並列出每一單要放哪些作品、用哪張券、付多少 | P0 |
| F16 | 試算比較 | 同時列出「全部一起買不用券」「全部一起買用最好的一張券」和「最佳方案」的金額，讓你看出省了多少；也可以勾選「這張券留著不用」再重算 | P1 |

**F1 偵測方式**
- content script 在 `document` 上以 capture 階段監聽 `click` 與 `auxclick`（中鍵、Ctrl＋點擊開新分頁也要偵測），用 `selectors.ts` 的選擇器判斷目標是不是加入購物車按鈕。用事件委派，動態載入的按鈕也偵測得到。只處理 `event.isTrusted === true` 的事件。
- 作品編號：列表頁的 `a.btn_cart` 從 `href` 取（只接受加入購物車的路徑 `/<分站>/cart/=/product_id/<ID>.html`）；作品頁本身的 `button.btn_cart[data-ga4-ref="cart_add"]` 沒有 `href`，用文件載入時的頁面網址；都取不到就放棄，不掃頁面文字。不從 `<button>` 讀 `href`，也不單獨比對 `[data-ga4-ref]`。
- 從點擊目標往上最多找 3 層，而且按鈕裡的子孫元素不能超過 5 個：頁面把 `<html>` 改成購物車按鈕、或把整頁包進購物車連結時，點擊其他地方不會被當成加入購物車（v0.11，M2 審查重現了「任何一次點擊都變成加入頁面指定的作品」）。
- 點擊就當作「想買」並加入追蹤（`source: 'cart'`），不等待加入成功。漏掉的由 F2 在你打開購物車頁面時補上。從購物車移除作品不會自動取消追蹤。
- 你在擴充功能裡移除的作品記在 `untracked`（§5.3）：F2 不會把它加回來；你再按一次加入購物車或手動加入時才清掉這筆紀錄。
- F2 等購物車清單元素（`ul.cart_list`）出現才讀，最多等 10 秒；一直沒出現（頁面還沒渲染完或選擇器失效）就不送，不覆蓋 `lastCart`。預渲染中的頁面等真的顯示後才送。
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
完整規則見 [docs/security.md](docs/security.md)（§3.2.1～§3.2.6）。摘要：
- 外部資料只當純文字；含 HTML 的欄位只在 content script 用 `DOMParser` 轉成純文字（§3.2.1）。
- URL 一律由程式自己組；圖片只接受 `https://img.dlsite.jp`（§3.2.2）。
- 所有回應用 zod 逐筆驗證，禁止 `z.coerce`，外部字串不當一般物件的 key（§3.2.3）。
- 訊息依方向與來源分組，清單是完整的，參數、回覆形狀與頻率上限都有定義（§3.2.4）。
- content script 只放最少的程式碼，不用 React、不碰 storage，DOM 寫法有專用 lint 規則（§3.2.5）。
- 頁面文字只用選擇器讀特定元素，regex 都有 ReDoS 測試（§3.2.6）。

### 3.3 隱私
- 所有資料只存在本機（`chrome.storage.local` / IndexedDB），不上傳到任何伺服器。
- 優惠券資料**永遠不離開本機**：不送給 DLWatcher，也不匯出。
- content script 讀不到任何擴充功能的儲存資料（`storage.local` 也鎖住，§4.2）。
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
完整規則見 [docs/security.md](docs/security.md)（§3.4）。摘要：
- 所有對外請求只能透過 `apiGet`，路徑完全比對；只有 content script 的 `couponList` 會帶 cookie，商品 API 與 DLWatcher 只由 background 呼叫。
- 開分頁、連結、通知點擊只能用 `buildWorkUrl()` 與 `nav.ts` 的常數，以型別、元件、語法規則、打包掃描四層防線**降低機率**（相依套件仍是已知風險，見 §11）。
- ⚠️ **不要呼叫 `GET /home/mypage/coupon`**（少了 `/list/ajax`），這是**領券**端點。

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
  - 史低與通知基準只計算 `status` 為空的紀錄（排除「查不到」）。
  - 「開始追蹤」的日期用 `status` 為空的第一筆 `priceLog.at`，不用 `TrackedItem.addedAt`。
- **DLWatcher 的歷史保留在本機**：`HistoryRecord` 只在新的回應驗證成功、而且通過下面的合理性檢查時才覆蓋；請求失敗、404、驗證失敗或檢查不通過時，保留上一次的資料並標示取得時間，不能用空資料或可疑資料蓋掉。保留下來的資料照常算進史低基準，畫面標示「DLWatcher 資料取得於 YYYY-MM-DD」；只有在設定裡關閉 DLWatcher 時才完全不用。
- **DLWatcher 資料的合理性檢查**（防「格式正確但內容是假的」資料，例如網域換了持有者）：
  - `lowest.price ≤ max(regularPrice, 自己紀錄裡見過的最大 officialPrice)`（原價可能調降過），而且 `lowest.price ≥ floor(regularPrice × 0.05)`。
  - `start ≤ end`、`start ≤ 現在 + 1 天`、`end ≤ 現在 + 400 天`（進行中的特價，`end` 可能是未來的結束時間；實際意義 M3 確認，§10.3）。走勢點的 `x`、`y` 都在 0～1。
  - 新的 `lowest.price` 比上次低超過 50%，而且自己的 `priceLog` 沒有看過差距 5% 以內的價格時，標示「DLWatcher 資料與自己的紀錄差異很大」。
- 畫面同時顯示「DLWatcher 史低」與「自己紀錄的最低價」兩個數字，不只顯示合併後的值。
- DLWatcher 連續 7 天對所有作品都失敗或都不通過檢查時，自動暫停 DLWatcher，並通知「DLWatcher 似乎已停止服務，已改用自己的紀錄」；要你手動重新開啟。
- 臨時查詢（F12、F13）的結果不寫進 `priceLog`。收到任何來源的 `track` 時，若 `lookupCache` 有這件作品而且未滿 24 小時，就用它寫第一筆 `priceLog` 與快照；否則照一般流程排進查價佇列。
- F10 匯出包含 `priceLog`，換電腦或重裝時可以帶走自己的紀錄。
- DOM 選擇器集中在 `selectors.ts`，改版時只要改一處。

### 3.7 匯出（F10）
- v1 只做匯出。擴充功能頁面直接讀 storage 組成檔案（不經過訊息），由 `components/ExportButton.tsx` 用 `URL.createObjectURL(blob)` 產生的網址建立 `<a download>` 下載。這是 §3.4 第 2 層允許寫 `<a>` 的第三個元件，`href` 只能是這個 `blob:` 網址。
- 匯出格式帶 `format: "dl-assistant-export"` 與 `version` 欄位，一律用陣列（`items: TrackedItem[]`、`priceLog: PriceLogEntry[]`），不用以編號為 key 的物件。
- 匯出的內容只有追蹤清單與 `priceLog`；設定、通知紀錄、**優惠券**一律不匯出。匯出時的提醒見 §3.3。

**第二階段匯入的規則草案**（v1 不實作；實作前要重新審查）：
- 匯入時版本不認得就拒絕。
- 匯入檔上限 5 MB，超過直接拒絕。用 `file.text()` 讀取後 `JSON.parse`，再用 `.strict()` 的 zod schema 驗證整份檔案，任何一筆不符就整份拒絕並顯示錯誤位置。
- 可以匯入的只有：追蹤清單（`id`、`targetPrice`、`paused`、`addedAt`）與自己的查價紀錄（`priceLog`）。`id` 必須通過 `isWorkId()`；數字有範圍（價格 0～1,000,000 的整數）。
- **新增的作品**：`source: 'import'`、`autoAdded: false`、`title: ''`、`imageUrl: ''`、`site: 'maniax'`、`baselineAt` 為空（下次查價只建立基準並更新名稱、圖片、分站，§6.1）。
- **已存在的作品**：只覆蓋 `targetPrice`、`paused`；`addedAt` 取兩者中較早的值；`baselineAt` 與其他欄位不變。
- `priceLog` 匯入規則：
  - v1 **只對本機完全沒有紀錄的作品**匯入 `priceLog`。本機已有紀錄的作品整份略過，摘要顯示「N 件已有本機紀錄，未匯入查價紀錄」（避免合併與重疊的邊界問題）。
  - `at`、`lastSeenAt` 必須通過 `lib/dates.ts` 的 `isCanonicalIso(s)`（符合 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`，而且轉回 ISO 字串和原字串相同）；`at ≤ lastSeenAt ≤ 匯入當下`。（格式不一致會打亂 IndexedDB key 的字典序。）
  - 同一作品的紀錄依 `at` 排序後不能重疊；每件作品最多 5,000 筆。
  - 匯入的紀錄一律加上 `origin: 'import'`。史低若來自匯入紀錄，畫面標示「來自匯入的資料」；史低基準與 `lowest` 通知不使用匯入紀錄（一份檔案就能偽造 ¥1 的史低）。
- 匯入分兩步：預覽與確認。預覽結果要存在 `storage.session`（service worker 閒置 30 秒就會被終止），確認時要帶同一個預覽 ID、來自同一個頁面，並在寫入當下**重新套用**匯入規則；結果和預覽不同時要再確認一次。
- 匯入的 `paused` 變更照一般的暫停／恢復規則處理；`addedAt` 要通過 `isCanonicalIso` 而且不晚於現在；匯入後的追蹤清單總數不能超過 1,000 件，超過的在摘要顯示「N 件因超過上限未匯入」。
- **不匯入**：`title`、`imageUrl`（下次查價時從 API 重新取得）、設定、通知紀錄、**優惠券**。優惠券只能來自 F14 同步，避免假券影響試算。
- 匯入資料一樣適用 §3.2.3 的原型污染規則。
- 實作時需要的資料模型變更：`TrackedItem.source` 加 `'import'`、`PriceLogEntry` 加 `origin?: 'import'`、`priceLog` 新增條件加上「最後一筆是匯入紀錄」、訊息清單加 `importPreview`／`importCommit`。

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
- **content script 不能碰儲存資料**：`chrome.storage.local` 預設對 content script 開放（只有 `storage.session` 預設不開放）。background 在最上層（每次 service worker 啟動）、`runtime.onInstalled` 與 `runtime.onStartup`（瀏覽器啟動時就喚醒 service worker，不必等到第一則訊息）都呼叫 `chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })`，讓 content script（以及打包進去的套件、被攻破的分頁程序）無法直接讀寫券、追蹤清單與設定，繞過訊息驗證。呼叫失敗時不丟例外：結果記在 `storage.session` 的 `storageLock`、輸出 `console.error`，popup 顯示「這個 Chrome 版本無法限制網頁程式讀取擴充功能的資料」。要在 Chrome 120 確認對 `storage.local` 有效（§10.3；MDN 寫這個方法只支援 `storage.session`，Chrome 文件則列在 `storage.local` 底下）；若不支援，把 `minimum_chrome_version` 提高到支援的版本，或把 `coupons`、`items`、`settings` 改存擴充功能來源的 IndexedDB。
- 所有寫入都經過 background（單一寫入者）。其他頁面與 content script 用訊息要求修改。background 內部用一個 Promise 佇列讓寫入依序執行，避免「讀 → 改 → 寫」互相覆蓋。
- background 從 storage 讀回的資料一律再跑 zod 驗證後放進 `Map`（§3.2.3）。
- 擴充功能頁面讀取資料時直接讀 `chrome.storage.local` 與 IndexedDB，並用 `chrome.storage.onChanged` 更新畫面。content script 讀不到 IndexedDB 的擴充功能資料，徽章需要的資料由 background 回覆 `badgeInfo`。
- IndexedDB 連線處理 `versionchange` 事件：收到就關閉連線並提示重新整理頁面。
- 同步鎖與 `syncToken` 的「讀取、判斷、寫入」也放在同一個 Promise 佇列裡執行，兩個分頁同時送 `shouldSyncCoupons` 時只有一個拿到 token。
- **寫入與通知的先後**：以 §4.1 的一批（商品 API 一次最多 100 件）為單位。整批每件作品依 §6.1 處理完後，用**一次** `chrome.storage.local.set({...})` 寫入 `snapshots`、`ruleState`、`notified`、`recentNotifications`，`priceLog` 用一個 IndexedDB transaction 寫入，然後才把這批的候選合併成一則通知並呼叫 `chrome.notifications.create`。service worker 若在中間被終止，寧可漏發也不重複發；漏發的通知仍在「最近的通知」看得到。跨批次不合併（一輪查價最多 10 批，可能出現多則通知）。（每件各寫一次的話，1,000 件要序列化 1,000 次整份資料；一次 `set` 寫多個 key 是否不可分割，見 §10.3。）
- **清理**：移除追蹤時刪掉該作品的 `RuleState`、`snapshots`（`priceLog` 保留，重新追蹤時還能用）；每次同步優惠券後，刪掉已不存在的 `coupon.key` 的 `RuleState` 與 `Settings.reservedCouponKeys`。

---

## 5. 資料來源與資料模型

### 5.1 DLsite 商品資訊 API（現價，已實測）

```
GET https://www.dlsite.com/maniax/product/info/ajax?product_id=RJ001,RJ002,...&cdn_cache_min=1
```
- 不用登入，用逗號分隔可以一次查多個 ID（最多 100 個）。
- 回應形狀（2026-11-23 實測）：以編號為 key 的物件；不存在的編號直接不出現；**全部都不存在時是 `[]`**。沒有打折的作品，`discount_rate`、`campaign_id`、`discount_end_date` 三個欄位不出現（不是 `null`）。
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
| `dailyAutoAdd` | `storage.local` | `{ date: string; count: number; skipped: number }`（§3.2.4 每日上限；`date` 是 JST 日期，`skipped` 是今天因為上限沒有加入的件數，popup 提示用） | 否 |
| `lastCart` | `storage.local` | `{ ids: string[]; at: string }`（最近一次 `cartSnapshot`，F15「從購物車選擇」用） | 否 |
| `untracked` | `storage.local` | `[id, at][]`（你在擴充功能裡移除的作品，F2 不加回來；最多 1,000 筆、保留 180 天） | 否 |
| `lastManualSyncAt` | `storage.local` | `string`（§3.2.4 `syncCouponsNow` 冷卻） | 否 |
| `recheckAt` | `storage.local` | `[id, at][]`（§3.2.4 `recheck` 冷卻） | 否 |
| `seenDocuments` | `storage.session` | `{ badge, cart, track }`，各是 `[documentId, at][]`（§3.2.4） | 否 |
| `rateCounters` | `storage.session` | 每種訊息的每分鐘計數（§3.2.4） | 否 |
| `lookupCache` | `storage.session` | §3.5 | 否 |
| `couponSyncLock` | `storage.session` | `{ token, tabId, documentId, expiresAt }`（§5.4） | 否 |
| `pendingManual` | `storage.session` | `{ tabId, expiresAt }`（F14） | 否 |
| `storageLock` | `storage.session` | `{ ok: boolean; at: string }`（§4.2 `setAccessLevel` 的結果） | 否 |
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
  rules: { sale: boolean; target: boolean; lowest: boolean; ending: boolean; couponExpiring: boolean };  // §6 預設欄
  reservedCouponKeys: string[];            // F16「這張券留著不用」
}

// 追蹤清單（chrome.storage.local，key: "items"）
interface TrackedItem {
  id: string;              // RJ01014447，通過 isWorkId()
  site: string;            // 加入時從網址暫填，第一次查價後改成 API 的 site_id
  title: string;           // 最多 300 字
  imageUrl: string;        // 依 §3.2.2 正規化的 https://img.dlsite.jp/ 網址；不符時為空字串（顯示預設圖）
  addedAt: string;
  source: 'cart' | 'page' | 'manual' | 'lookup';
  // cart：F1／F2；page：作品頁裡的「加入追蹤」（含作品頁內查史低結果的按鈕）；manual：popup 或儀表板；lookup：popup 與 lookup.html 的查詢結果
  autoAdded: boolean;      // cart 與 page 為 true，追蹤清單標示「自動加入」或「從作品頁加入」，可一鍵移除
  baselineAt?: string;     // 建立基準的時間；為空時查價只建立基準、不發通知（§6.1）
  targetPrice?: number;    // 使用者設定的目標價（日圓）
  paused: boolean;         // 暫停 = 不查價、不通知；恢復時清掉 baselineAt，下一次查價重新建立基準
  notFoundCount?: number;  // 連續查不到（API 沒回傳、is_sold_out）的次數，1～999；查得到就省略。資料驗證失敗不算查不到（§3.2.3）
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
  discountEndStale?: true; // §5.5 第 4 步：截止日早於查價時間 7 天以上，isOnSale() 回傳 false
  campaignId?: string;
  episode?: { key: string; startedAt: string };  // 目前這段優惠（§6.1）；key 建立後不重算，規則表的 episodeKey 一律指它；沒有打折時省略（查不到時保留，§6.1 第 3 步）
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
// 因此連續查不到只更新同一筆的 lastSeenAt；恢復販售時 status 改變，一定新增一筆。
// 第一次查價就查不到（例如手動輸入了不存在的編號）時沒有可沿用的資料：不寫 PriceSnapshot 與 priceLog，
// 追蹤清單顯示「查不到這個作品」；連續 3 次查不到（TrackedItem.notFoundCount ≥ 3）時提示移除。
// 查價請求本身失敗（網路、HTTP 錯誤）時什麼都不寫；還沒有快照的作品顯示「還沒有價格」與「重新查價」。
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
}

// 持有的優惠券（chrome.storage.local，key: "coupons"）
// 欄位對應 §5.4 優惠券 API 的實際回應
interface Coupon {
  key: string;                   // 本機唯一識別：JSON.stringify([coupon_id, limit_date ?? end_date, 同組序號])。儲存、「留著不用」、couponExpiring 都用 key
                                 // 同組序號依 API 回傳順序；順序改變時只會影響完全相同的券，可以接受
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
  lastAttemptAt?: string;        // 每次發出 syncToken 時寫入（§5.4 同步排程第 3 步）
  lastResult: 'ok' | 'empty' | 'notLoggedIn' | 'failed' | 'unparsable' | 'unreadable';
  // empty：讀到 [] 但本機原本有券；unparsable：JSON.parse 失敗；unreadable：非空陣列但全部解析失敗（§5.4）
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
  couponKeys?: string[];         // couponExpiring 的券；點擊開啟試算頁 planner.html（§6.2）
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
| `JSON.parse` 失敗 | 未登入或 API 改版（兩者無法區分） | 保留，標示 `unparsable`，popup 顯示「無法讀取（未登入或 API 改版）」 |
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
3. 距離 `couponSync.lastSuccessAt` 不到 6 小時，**或**上次結果不是 `ok` 而且距離 `lastAttemptAt` 不到 1 小時 → 回覆「不同步」。（未登入時 `lastSuccessAt` 不會更新，沒有第二個條件的話，每開一個 DLsite 頁面就會請求一次。）
4. 產生一次性的 `syncToken`（`crypto.randomUUID()`），寫入 `couponSync.lastAttemptAt` 與 `couponSyncLock: { token, tabId: sender.tab.id, documentId: sender.documentId, expiresAt: 現在 + 2 分鐘 }`，回覆 token。這筆紀錄同時就是同步鎖。
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
  4. 選出的日期早於 `checkedAt` 超過 7 天，或晚於 `checkedAt + 180 天`，或三個候選都不存在：當作「截止時間不明」，`discountEnd` 省略，不顯示也不觸發 `ending`。其中「早於 7 天以上」另外記下 `discountEndStale: true`：`isOnSale()` 遇到它回傳 false，儀表板顯示「截止時間異常」（避免 `is_discount: true`、截止日是 8 天前的錯誤資料被當成正在打折而發出 `sale`）。（「取最接近」會讓半年以後才結束的長期折扣選到去年的日期，所以早太多的一律當作不明。）
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
| `target` | `available` 而且現價 ≤ 目標價 | 不成立→成立 | `[id, 'target', targetPrice, episodeKey ?? 跌破目標價的 JST 日期]` | 開 |
| `lowest` | `onSale` 而且現價 ≤ 史低基準 | 不成立→成立（新的一段優惠時重新上膛） | `[id, 'lowest', episodeKey]` | 開 |
| `ending` | `onSale` 而且 `discountEnd − 現在 ≤ 24 小時` | 不成立→成立（新的一段優惠時重新上膛） | `[id, 'ending', episodeKey]` | 開 |
| `couponExpiring` | `現在 < expiresAt ≤ 現在 + 7 天`、`startsAt ≤ 現在`、`plannerUsable` 為 true，而且至少一件追蹤作品適用這張券（屬於 §12.2 的 `E(c, {p})`；`payment` 型看是否屬於 `B` 的成員） | 不成立→成立 | `['coupon', coupon.key, expiresAt]` | 開 |

- 本表與儀表板、試算、popup 說的「打折中」都是 `onSale`，由 `lib/rules.ts` 的 `isOnSale(snapshot, now)` 統一計算：`onSale = available && isDiscount && !discountEndStale && !(discountEnd && discountEnd ≤ now)`（`discountEndStale` 見 §5.5 第 4 步）。
- `episodeKey` 一律是 `PriceSnapshot.episode.key`（建立後不重算）。
- 每條規則可在設定裡開關（`Settings.rules`）。
- 「折扣又加深」（`deeper`）規則移到第二階段：v1 不通知同一段優惠中的折扣加深。
- `couponExpiring`：勾了「留著不用」的券照樣提醒（留著不用正是怕它過期），內文標示「你設定為留著不用」。`E` 會因作品開始或結束打折而變化，條件可能在 7 天內「成立 → 不成立 → 成立」；去重 key 含 `expiresAt`，不會重發，這是預期行為。
- `target`：`setTarget` 時用目前的快照重算 `target` 的 `RuleState`，已經成立就記成成立、不通知（你剛設定就知道已經低於目標價）。暫停後恢復時若已低於目標價，同樣不通知，追蹤清單標示「已低於目標價」。

### 6.1 處理步驟
每次查價，每件作品依序處理（`lib/rules.ts`，單元測試照這個順序寫）：
1. 驗證、轉換 API 資料，得到本次快照 `s`。查不到時 `s.available = false`，價格欄位沿用上一次（沒有任何先前資料時見 §5.3 `priceLog` 的說明）。
2. 計算 `onSale = isOnSale(s, 現在)`（查不到時一定是 false）。
3. **決定 `episode`**：
   - `s.available` 為 false → **保留**上次的 `episode`（不清掉）。下一次查得到而且仍在打折時，照下面的規則和保留的 `episode` 比較，判斷是不是新的一段優惠。連續查不到超過 7 天才清掉 `episode`。（否則沒有活動編號也沒有截止日的作品，一次查不到就會在隔天重發「特價＋史低」。）
   - `s.available` 為 true 而且 `onSale` 為 false → 清掉 `episode`。
   - `onSale` 為 true，而且符合下列任一情況 → **新的一段優惠**，`episode = { key: campaignId ?? discountEnd ?? 'start:' + 這次的 JST 日期, startedAt: 現在 }`：
     - 上次沒有 `episode`（打折從無到有）。
     - `campaignId` 兩邊都有值而且不同。DLsite 常有一檔活動結束、下一檔馬上開始，6 小時查一次可能看不到中間沒打折的時刻。
     - `campaignId` 為空，而且 `discountEnd` 往後延超過 7 天。
   - 其他情況沿用上次的 `episode`。
   （`campaignId`、`discountEnd` 的空字串在解析時已轉成 `undefined`，§3.2.3。）
4. **計算每條規則的條件**。`lowest` 的史低基準 = min(DLWatcher 史低, 自己紀錄中 `at` 早於 `episode.startedAt` 的最低價)，只計算 `status` 為空的紀錄（§3.6）。不能把這次的價格算進基準，否則條件永遠成立。沒有任何先前紀錄、DLWatcher 也沒有資料時，`lowest` 不成立。原價永久調降不算 `lowest`，v1 不通知（儀表板照常顯示）。
5. **新的一段優惠時**，`sale`、`lowest`、`ending` 的上次結果一律視為不成立。`target` 不重設，因為它看的是價格，不是活動。
6. **`baselineAt` 為空**（剛加入追蹤，不論從哪裡加入；或暫停後恢復）：把第 3 步的 `episode` 與第 4 步的條件結果寫進 `PriceSnapshot.episode` 與 `RuleState`，設定 `baselineAt`，**不發任何通知**，跳到第 9 步。之後的查價才依狀態轉換通知。
7. **列出候選**：規則開啟、條件成立、上次不成立 → 候選。
8. **去重**：候選的去重 key（`JSON.stringify([...])`，不直接串接字串，`'1' + '00abc'` 和 `'100' + 'abc'` 會撞在一起）不在 `notified` 裡才保留。同一件作品的多條規則合併成一則，內文列出全部。
9. **整批寫回再通知**：依 §4.2，等這一批（最多 100 件）每件都處理完，一次寫入 storage 與 IndexedDB，然後才把這批的候選合併成一則通知（「3 個追蹤作品正在特價」）送出。跨批次不合併。

- `couponExpiring` 在每次同步券後與每天的排程各判斷一次，同樣只在不成立→成立時通知。
- `notified` 超過 180 天的紀錄在每次排程時刪除。
- 單元測試至少包含：
  - 加入時已在打折 → 之後兩次查價都沒有通知；打折結束再開始才通知。
  - 原價 ¥2,000；第一檔活動 c1 ¥1,000 → 通知「特價＋史低」；6 小時後接著第二檔 c2 ¥800（新史低）→ 通知「特價＋史低」。
  - 已結束的快取資料（§5.5 第 3 步）→ `onSale` 為 false，不發 `sale`。
  - 沒有 `campaignId` 與 `discountEnd` 的打折作品，查不到一次後恢復（隔天）→ 不重發通知。
  - 查不到時，儀表板、popup、試算都不顯示「打折中」。
  - 同一批 3 件作品開始打折 → 只送一則合併通知。
  - 在打折中把目標價調高到現價以上 → 不發 `target`。
  - 暫停後恢復、恢復時已經在打折 → 恢復後連續兩次查價都沒有通知。

### 6.2 通知內容與點擊
- 標題固定為「DL_Assistant」加規則名稱（例如「DL_Assistant：特價」），避免作品名稱冒充系統通知。
- 作品名稱與券名（`couponExpiring` 會顯示合作網站填寫的券名）放進通知前，用 `s.replace(/[\p{Cc}\u2028\u2029]/gu, ' ').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim()` 清理：控制字元（含換行、tab）與 U+2028／U+2029 先換成空白（`作品名\n第2巻` 不會黏成 `作品名第2巻`），再刪掉 U+202E 從右到左覆寫、零寬字元等格式字元，最後把連續空白合併。U+2028／U+2029 在 regex 字面裡一定要用 `\u` 跳脫寫法，直接放字元會是語法錯誤。再用 `Array.from(s).slice(0, 60).join('')` 截斷到 60 個字元（`s.slice()` 會切斷 emoji 等補充平面字元）。移除 `Cf` 也會拆開用 ZWJ 組成的 emoji，只影響顯示，可以接受。
- 設定頁提供「通知不顯示作品名稱」（只顯示「1 個追蹤作品正在特價」），並提醒 Windows 鎖定畫面與通知中心可能顯示通知內容。
- 內文：作品名稱、現價／原價、折扣、和史低差多少、截止時間。
- 通知一律用擴充功能內建圖示，不顯示作品縮圖（`iconUrl` 用遠端網址不可靠，service worker 也不能產生 blob URL）。
- `notificationId` 對應到 `RecentNotification.ids`。單一作品時用 `buildWorkUrl()` 開啟作品頁（§3.4）；多件合併時開啟 `dashboard.html?n=<notificationId>`，儀表板要求 `searchParams.getAll('n').length === 1`、長度 ≤ 64，而且是 `recentNotifications` 裡存在的 ID 才篩選；`couponExpiring` 的通知開啟試算頁 `planner.html`（`ExtPageUrl`）。
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

### 7.1 Manifest、7.2 建置與供應鏈
manifest（權限、CSP、`minimum_chrome_version`、`externally_connectable`）與建置、供應鏈規則見 [docs/security.md](docs/security.md)（§7.1、§7.2）。

---

## 8. 專案結構（預定）

```
DL_Assistant/
├─ SPEC.md                    # 功能、資料模型、通知、里程碑（本檔）
├─ CHANGELOG.md               # 規格變更紀錄
├─ docs/
│  ├─ security.md            # §3.2、§3.4、§7.1、§7.2
│  ├─ planner.md             # §10.1、§10.2、§12
│  └─ verification.md        # §10 待驗證表格、§10.3
├─ wxt.config.ts
├─ package.json
├─ eslint.config.js             # §3.2.1、§3.2.5、§3.4、§5.5 要求的規則
├─ scripts/check-manifest.ts    # 發佈前檢查 manifest 與打包結果（§7.2）
├─ scripts/manifest-policy.ts   # manifest 的固定值（權限、CSP、content script），wxt.config.ts 與 check-manifest 共用
├─ scripts/content-modules-plugin.ts  # 建置時列出 content script 的模組（§3.2.5）
├─ scripts/content-modules.baseline.json  # content script 可以打包的套件與專案檔案（§3.2.5）
├─ src/
│  ├─ entrypoints/
│  │  ├─ background.ts          # 排程、查價佇列、通知、唯一的 storage 寫入者
│  │  ├─ dlsite-content.ts      # 偵測加入購物車、購物車 DOM、作品頁徽章、優惠券同步（不用 React，import 白名單見 §3.2.5；用 defineUnlistedScript，理由見 §3.2.5）
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
│  │  ├─ ids.ts                 # isWorkId、分站列舉、從網址取作品編號、buildWorkUrl、圖片網址正規化
│  │  ├─ schema.ts              # intIn、optionalText 等共用的 zod 工具（§3.2.3）
│  │  ├─ models.ts              # §5.3 資料模型的 zod schema 與 Settings 預設值
│  │  ├─ tracking.ts            # 追蹤清單的加入／移除與查價（background 專用）
│  │  ├─ auto-track.ts          # content script 送來的自動加入：每日上限、seenDocuments（background 專用）
│  │  ├─ content-handlers.ts    # content script → background 訊息的處理（background 專用）
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
│  │  ├─ badge-style.ts         # 注入徽章的樣式字串（單一常數，不含 url()／@import，§3.2.5）
│  │  └─ selectors.ts           # DLsite DOM 選擇器與頁面文字的 regex（集中管理）
│  ├─ content/                  # content script 的 UI 與邏輯（原生 DOM，§3.2.5）
│  │  ├─ cart.ts                # F1 加入購物車偵測、F2 購物車頁的作品編號
│  │  └─ messaging.ts           # 送訊息給 background（最多重試一次）
│  └─ components/               # 共用 React 元件（只用於擴充功能頁面）
│     ├─ WorkLink.tsx           # 作品頁連結；可以寫 <a href> 的三個元件之一（§3.4）
│     ├─ NavLink.tsx            # nav.ts 常數的連結
│     └─ ExportButton.tsx       # 匯出下載（blob: 網址的 <a download>，§3.7）
└─ tests/                       # Vitest 測試；fixtures/ 放去識別化的 API 回應範例
   ├─ e2e/                      # Chrome 實機驗證（CDP pipe，不用 puppeteer）：verify-m1.ts、verify-m2.ts（假的 DLsite 頁面）、check-dev-csp.ts
   └─ lint-fixtures/            # 每一種違規寫法的範例檔與應該擋下它的規則，CI 確認 ESLint 都會報錯（§3.4）
      └─ content/               # content script 專用的 DOM 寫法範例（§3.2.5）
```

---

## 9. 開發里程碑

**通則**：每個里程碑完成時，它涉及的章節裡列出的單元測試全部通過並放進 CI；§10.3 標為這個里程碑的項目都已確認並把結果寫回規格。

| 階段 | 內容 | 完成標準 |
|---|---|---|
| M1 骨架（✅ 2026-11-23，v0.9 依審查修正；Chrome 120 實測待補，見 §10.3） | WXT 專案、`zod-setup.ts`、ESLint 規則與 `tests/lint-fixtures/`、`apiGet` 與白名單、`nav.ts` 與連結元件、`Settings` 與 storage 存取層、background 呼叫商品 API 查價、手動加入追蹤（`track` 訊息） | 在 popup 手動加一個作品，看得到現價；`assertAllowed` 行為測試、lint 自我測試、`isWorkId`／`buildWorkUrl`／`intIn`／商品 API 的 `"__proto__"` key 測試通過；manifest 檢查腳本通過；CSP 與 `minimum_chrome_version` 被 Chrome 接受；`setAccessLevel` 生效（content script 呼叫 `chrome.storage.local.get` 會失敗）；§3.4 自我測試表的每個範例都以指定的規則報錯 |
| M2 自動追蹤（✅ 2026-11-23，v0.11 依審查修正；以照實測結構寫的假頁面驗證，真實 DLsite 與登入狀態的端到端未測） | content script（原生 DOM、import 白名單）偵測加入購物車、購物車 DOM 同步、訊息白名單與來源檢查 | 在 DLsite 加入購物車後，追蹤清單自動多一筆；非 `isTrusted` 的點擊不會加入；content script 打包檔不含 `react`、`storage.local`；content script 的 DOM lint 範例都報錯；content script 的 `track` 計入每日上限；訊息來源的拒絕案例與 `setSettings` 多餘欄位被拒絕的測試通過 |
| M3 史低 | DLWatcher 串接、歷史資料存 IndexedDB、自己的 `priceLog`、合理性檢查、查價佇列與退避 | 每個追蹤作品都有史低和期間；在設定關閉 DLWatcher 後，史低與走勢改用自己的紀錄；查價途中 service worker 被終止，重啟後能接著做；「可買 → 查不到 ×3 → 可買（同價）」得到 3 筆紀錄；「關瀏覽器 3 天、前後同價」得到 2 筆紀錄，中間畫虛線；DLWatcher 合理性檢查的 4 個不通過案例（`lowest` 過高、過低、`start > end`、走勢點超出 0～1）都保留舊資料 |
| M4 通知 | alarms 排程、§6.1 的處理步驟、去重、一批一次寫入 | 作品打折時收到一次通知；回到原價後再次打折會再通知；§6.1 列出的所有測試情境通過（含查不到一次不重發、一批多件合併成一則、暫停恢復） |
| M5 儀表板 | 表格、走勢圖、等待建議、最近的通知 | 一頁看完所有追蹤作品的價格狀況；`dashboard.html?n=` 帶不存在的 ID 時不篩選、不報錯 |
| M6 作品頁徽章與臨時查詢 | 作品頁史低徽章、「查史低」按鈕、popup 查詢、右鍵選單與 `lookup.html` | 未追蹤的作品也查得到史低，而且追蹤清單沒有多出東西；開啟 10 個作品頁（含未追蹤），開發者工具的網路面板裡擴充功能沒有發出任何請求 |
| M7 優惠券同步 | content script 呼叫優惠券 API、`requestCouponSync` 與同步鎖、立即同步、到期提醒 | 在任一 DLsite 頁面觸發同步後，擴充功能裡的券和「マイページ → クーポン管理」顯示的一致；`[]`、全部解析失敗、未登入三種情況本機的券都保留；重複送同一個 `syncToken` 被拒絕；連按「立即同步」只發一次請求；未登入時 1 小時內不重試；`pendingManual` 過期後不能略過 6 小時 |
| M8 購買試算 | 先確認 WXT 能打包 Web Worker；§12 最佳化演算法、試算頁面、比較表 | 用 10 件作品＋3～5 張券（含一次性券）測試，結果和暴力窮舉一致；1 張可重複使用券配 4 件作品得到 1 單；`k′ > 8` 的反例選到效益最大的券；實測 n = 15、`k′` = 0／4／8 的計算時間並記錄 |
| M9 匯出、台幣參考價與 popup | F10 匯出（`ExportButton`）、F11 台幣參考價、F9 popup 的優惠摘要與最近的通知 | 匯出檔不含優惠券與設定；`ExportButton` 以外的元件寫 `<a>` 會被 lint 擋下 |
| 第二階段（選做） | Python ＋ GitHub Actions 每日查價，推播到 Discord / Telegram；試算超過 15 件時的近似解；F10 匯入（§3.7 的草案）；「折扣又加深」通知；用 `declarativeNetRequest` 擋下擴充功能發起的領券導覽（§11） | 瀏覽器沒開也收得到通知 |

---

## 10. 待驗證事項

- 實作前與各里程碑要確認的事（原 §10 表格與 §10.3）：[docs/verification.md](docs/verification.md)
- 已確認與還沒確認的用券規則（§10.1、§10.2）：[docs/planner.md](docs/planner.md)

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
| 供應鏈攻擊 | 被入侵的 npm 套件在擴充功能裡執行 | §7.2：lockfile、`strictDepBuilds`、`minimumReleaseAge`、`trustPolicy`、`pnpm audit`、打包結果掃描 |
| 擴充功能頁面或 background 的相依套件被入侵 | 導覽不受 CSP 約束，惡意程式能以登入狀態開啟領券等帳號網址；§3.4 的四層防線只檢查我們自己的原始碼 | §7.2 供應鏈規則（lockfile、`minimumReleaseAge`、`trustPolicy`）；擴充功能頁面的執行期相依套件維持最少（React、Chart.js、`idb`、zod），新增要改規格；打包掃描。第二階段評估用 `declarativeNetRequest` 擋下擴充功能發起的 `/home/mypage/coupon` 導覽（§10.3） |
| content script 的相依套件被入侵 | content script 的請求不受擴充功能 CSP 約束，惡意程式能以登入狀態對帳號端點發請求 | §3.2.5：content script 最小化（不用 React 等）、import 白名單、打包套件差異檢查；§7.2 打包路徑掃描 |

---

## 12. 購買試算演算法

問題定義、計算方式、輸出範例與測試見 [docs/planner.md](docs/planner.md)（§12.1～§12.5）。

---

## 附錄：參考資料
- Greasy Fork「dlsite 历史价格查询」（MIT）：參考它依頁面文字找價格區塊的插入方式。作品編號比對不沿用它的 `/[VBR]J\d{6,8}/`（沒有錨定，會截斷 9 碼、放行 7 碼），改用 §3.2.2 的 `isWorkId()`。
- `imba-tjd/DLWatcher`（AGPL-3.0）：和 dlwatcher.com 無關的同名專案，資料已停止更新，不使用它的資料或程式碼。只參考它的 ajax API 批次查詢（100 個一組）與 GitHub Actions 排程架構。
- `SPEC_REVIEW.md`：v0.3 的安全、正確性與可行性審查報告，v0.4 依此修改。
- `SPEC_REVIEW_v0.4.md`：v0.4 的第二輪審查報告（含 DP 與日期規則的實測反例），v0.5 依此修改。
- `SPEC_REVIEW_v0.5.md`：v0.5 的第三輪審查報告（含 DP 與暴力窮舉 600 組比對、通知狀態機模擬、M1 準備度評估），v0.6 依此修改。
- `SPEC_REVIEW_v0.6.md`：v0.6 的第四輪審查報告（含 800 組 DP 比對、ESLint 規則能力確認、M1 準備度與是否再審的評估），v0.7 依此修改並拆分檔案。
