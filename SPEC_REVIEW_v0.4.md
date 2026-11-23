# SPEC.md v0.4 審查報告（第二輪）

> 審查對象：`SPEC.md` v0.4（2026-11-23，commit `8ff5176`）
> 審查日期：2026-11-23
> 審查方式：只讀規格書、`SPEC_REVIEW.md`（第一輪）與公開文件（Chrome Extensions 文件、WXT 文件、zod 文件）。沒有開啟或登入 DLsite，也沒有請求任何 DLsite 網址。演算法、日期、數字與 regex 的結論都用 Node.js v24 實際跑過（腳本放在暫存資料夾，不在專案內）；需要實際瀏覽器或 DLsite 才能確認的地方標為「未驗證」，集中在附錄。
> 編號延續第一輪：新發現從 S-13、C-13、F-10 開始。

---

## 摘要

| 嚴重度 | 安全 | 正確性 | 可行性 | 合計 |
|---|---|---|---|---|
| 高 | 0 | 1 | 0 | **1** |
| 中 | 2 | 7 | 0 | **9** |
| 低 | 10 | 5 | 6 | **21** |
| 合計 | 12 | 13 | 6 | **31** |

第一輪 33 項：**25 項已修正、6 項部分修正、2 項修正後引入新問題**（C-3、C-4，都來自同一個原因，見 C-13）。

**最重要的 5 項修正**

1. **§12.2 的「到期分數」逐單相加，會讓試算把每件作品拆成一單**（C-13，高）。照 v0.4 寫法，同一張可重複使用的券每多一單就多加一次分數，DP 會選擇「訂單最多」的解；實測 4 件作品配 1 張 30% 券得到 4 單，§12.3 的範例會變成 9 單，而不是規格寫的 3 單。它也會為了加分去消耗一次性券。改成「只有用掉一次性券才計成本」即可，修正版已用暴力窮舉比對 300 組隨機案例，結果全部一致。
2. **導覽與頁面內資源載入也是「帶 cookie 的 GET」，§3.4 只管到 `fetch`**（S-13，中）。`chrome.tabs.create`、`<a href>`、通知點擊、以及注入 DLsite 頁面 UI 裡的 `<img src>`／CSS `url()`，都會以登入狀態對 DLsite 發 GET，而 §7.1 的 CSP 管不到 DLsite 頁面裡的元素。要把「只能開哪些 DLsite 網址」也做成唯一出口並加測試。
3. **§5.5 補年份規則推不出「前一年」，和它自己的測試矛盾**（C-16，中），而且日期解析會默默接受 `02-30`、`24:00`（C-17）。照字面實作，1/1 凌晨看到 `12/31 23:59` 會被當成**明年**的 12/31；3 天前已結束的快取資料也會被當成一年後才結束。
4. **通知去重：`campaign_id` 是空字串時 `??` 不會跳過，所有非活動折扣共用同一把 key；`ending`「不單獨再發」讓它永遠不會自己觸發**（C-18、C-19，中）。結果是某件作品第一次非活動特價之後，180 天內的非活動特價都不會再通知。
5. **`priceLog` 用「只更新 `lastSeenAt`」合併紀錄，會把沒查價的空白蓋掉**（C-20，中）。瀏覽器關了 3 天、前後價格一樣時，這 3 天會被畫成實線，§3.6「沒有查價的期間畫虛線」做不到；DLWatcher 停止服務後，這份紀錄就是唯一的史低來源。

緊接在後的是 S-14（徽章若自動查史低，DLWatcher 會即時知道你看過的每個作品）與 C-24（未登入時 API 若回傳 `[]`，本機的券會被清空）。

---

## 一、第一輪修正驗證

狀態說明：✅ 已修正　◐ 部分修正（還有缺口）　⚠️ 修正後引入新問題

| 編號 | 狀態 | 說明 |
|---|---|---|
| S-1 | ✅ | §3.2.1 改成 `DOMParser`＋禁止清單＋ESLint，原始 HTML 不存不傳。小補充：禁止把解析出的節點搬進任何活的文件，取文字前先去掉 `script`／`style`（S-22）。 |
| S-2 | ◐ | §3.2.2 涵蓋了擴充功能頁面的 `href`／`src`。缺口：(1) 導覽（`tabs.create`、`<a href>`、通知點擊）沒有唯一出口；(2) 注入 DLsite 頁面的 UI 不受 §7.1 CSP 保護，頁面內的 `<img>`、CSS `url()` 會帶 cookie 發 GET。見 S-13。圖片檢查用 `startsWith('https://img.dlsite.jp/')`，實測能擋下 `https:///evil`、`@evil`、`.evil` 等變形，可以接受，但和 §3.4「不用 `startsWith`」的原則不一致，建議改成解析後比對 `origin`。 |
| S-3 | ✅ | 唯一的 `apiGet`、完全比對、端點表、行為測試都有，`/home/mypage/coupon/list` 也加進測試。`credentials`／`redirect` 設定正確（理由見 S-23）。補充：「可呼叫的地方」沒有執行時檢查；查詢參數只檢查名稱沒檢查值（S-23）。 |
| S-4 | ◐ | §3.2.4 訊息白名單完成。缺口：`cartSnapshot` 沒有限制來源頁面與頻率（S-15）；`couponSyncResult` 沒有和「background 允許同步」綁在一起（S-16）；徽章開啟擴充功能頁面所需的訊息不在白名單（F-10）；擴充功能頁面的來源判斷寫法在 Node 測試環境會得到 `"null"`（S-17）。 |
| S-5 | ◐ | §3.7 大部分完成。缺口：匯入的 `priceLog` 可以塞進假的最低價，直接變成史低與通知基準；時間字串格式沒限制，會打亂 IndexedDB 的 key 排序（S-20）。原型污染規則只涵蓋匯入，沒涵蓋 API 回應（S-21）。 |
| S-6 | ✅ | `isWorkId()`、網址解析、`targetUrlPatterns` 都已寫入。注意 `[a-z]+` 不接受含連字號的分站路徑（F-11）。 |
| S-7 | ✅ | §3.3 補齊不 log、fixture 掃描、DLWatcher 會知道什麼。新出現的歧義：徽章是否自動查史低（S-14）。 |
| S-8 | ✅ | `exclude_matches`、`all_frames: false`、closed shadow root、頁面 DOM 只放公開資訊都已寫入。WXT 文件確認 `createShadowRootUi` 有 `mode?: 'closed' \| 'open'` 選項（預設 `open`），§10.3 這一項可以結案。 |
| S-9 | ✅ | Chrome 文件確認：`ids` 留空或不填就「沒有任何擴充功能可以連線」，`matches` 留空就沒有網頁能連線。§10.3 這一項可以改成「文件已確認，M1 只需檢查 manifest 被接受」。 |
| S-10 | ◐ | 標題固定、內文截斷完成。缺口：只去掉「控制字元」，沒去掉 Unicode 格式字元（例如 U+202E 從右到左覆寫、零寬字元）；`couponExpiring` 會顯示合作網站填寫的券名，規則沒涵蓋（S-18）。 |
| S-11 | ✅ | zod `jitless`、manifest 檢查、lockfile、install script 都已寫入。但我讀過的 zod.dev 頁面都沒有寫到 `z.config({ jitless: true })`，**未驗證**（F-12）。供應鏈可以再補兩條（S-24）。 |
| S-12 | ✅ | 來源標示、按鈕位置、長度限制、回應大小上限、數字範圍都已寫入。小問題：§3.2.6 先截斷到 200 字再跑 regex，所以「10 萬字惡意字串、限時 50 ms」的測試永遠會過，測不到 regex 本身；價格與日期的 regex 也還沒寫出來（見第二節 ReDoS 檢查）。 |
| C-1 | ✅ | `R`／`L` 分組、`g` 只用 `bestR`。我依 §12.2 實作 DP，和暴力窮舉比對 300 組隨機案例（含門檻、件數、一次性券），**DP 結構本身正確**。 |
| C-2 | ✅ | 捷徑條件與 n > 15 近似解都改了。但 F15 寫「最多 15 件」，§12.2 又有 `> 15` 的近似解，兩者擇一（C-25）。 |
| C-3 | ⚠️ | 改成 tuple 的方向是對的，`payment` 券的樓層範圍也寫清楚了。但「到期分數」被定義成每單相加、而且可重複使用的券也算分，造成 C-13。 |
| C-4 | ⚠️ | 範例的數字我重算過全部正確（3,520×30%＝1,056；1,650×20%＝330；2,200×15%＝330；小計 8,150；實付 6,434；只用 A 為 7,094），C 的條件與 p10 的說明也合理了。但照 v0.4 的 §12.2，DP 實際輸出是 **9 單**（每件用券的作品各一單），和範例的 3 單不符（C-13）。 |
| C-5 | ✅ | 整數運算規則與測試已寫入。重跑確認 `180 × (35/100)` 仍是 62.999…，`Math.floor(180*35/100)` 是 63。 |
| C-6 | ◐ | JST 解析、`limit_date` 秒、`expiresAt = min(...)` 正確（重算 `1796227116` → `2026-12-02T15:58:36.000Z` 無誤）。但補年份規則推不出前一年，第三個測試會失敗（C-16）；解析會接受不存在的日期（C-17）。 |
| C-7 | ✅ | 禁用 `z.coerce`、`intLike`、逐筆驗證、`plannerUsable` 都寫入。補充：`intLike` 本身沒有範圍，超長數字字串會變成 `Infinity`（C-17）；`price_sum` 段落說「接受 intLike、[]、[intLike]」又說「`null` 視為 0」，接受清單要加上 `null`。 |
| C-8 | ✅ | 同步結果判斷表與同步鎖已寫入。缺口：如果未登入時 API 回傳 `[]`，依表格會「成功、整批取代」，把本機的券清空（C-24）。另外，`redirect: 'manual'` 時 fetch 不會跟隨轉址，表格第一列「`response.url` 的 host 不是 `www.dlsite.com`」永遠不會成立，可以刪掉或註明是保險。 |
| C-9 | ◐ | 狀態轉換、`episodeKey`、`lowest` 基準、首次不通知、清理都寫入。缺口見 C-18（空字串、連續活動、key 沒有分隔符）與 C-19（`ending` 的矛盾、`deeper`／`couponExpiring` 不適合 `RuleState`）。 |
| C-10 | ✅ | a～j 全部處理：§1.2 改成兩樣、§4／§8／M7 改成 API、R18 切換那列已改、券數統一為 7 張、`PriceSnapshot` 有 `couponFacts`／`isDiscount`、`Coupon` 有 `workFormats`、F2 寫明不發 fetch、小節順序已排好。 |
| C-11 | ✅ | 協定相對網址正規化已寫入。 |
| C-12 | ✅ | `uᵢ` 規則、`uᵢ ≥ n` 放進 `R`、§10.2 i 都已寫入。 |
| F-1 | ✅ | 「立即同步」流程已寫入 F14。 |
| F-2 | ✅ | §4.1 已寫入。Chrome 文件確認：閒置 30 秒終止、呼叫擴充功能 API 會重設計時器、單一請求超過 5 分鐘或 fetch 回應超過 30 秒才到會被終止、alarms 最短 30 秒（Chrome 120）。§4.1 的「每件寫回 storage」剛好也能保持 service worker 存活。 |
| F-3 | ✅ | 已刪除自訂 User-Agent。 |
| F-4 | ✅ | F1 偵測方式已改寫。 |
| F-5 | ✅ | Chrome 文件確認 `storage.session` 預設不開放給 content script，配額 10 MB（Chrome 111 以前是 1 MB）。 |
| F-6 | ✅ | §12.2 已寫入 worker 做法與備案。 |
| F-7 | ✅ | F13 改用 `chrome.windows.create` 開 `lookup.html`。 |
| F-8 | ✅ | 只用內建圖示、「最近的通知」、Windows 設定說明都已寫入。 |
| F-9 | ✅ | §4.2 單一寫入者與 `versionchange` 已寫入。 |

**第一輪 24 項修改清單的落實情況**：第 1～24 項都有對應的文字進入 v0.4。第 10 項（tuple 排序）照字面落實，但定義有誤（C-13）；第 5 項（補年份）落實的規則和測試互相矛盾（C-16）；第 8 項（通知）落實後仍有 C-18、C-19 的漏洞；第 24 項（§10 待驗證）裡，`externally_connectable` 空陣列、WXT closed shadow root、`storage.session` 存取層級三項，文件已能確認（F-15）。

---

## 二、注入與攻擊面總覽（重新盤點）

下表列出每個「外部資料進入程式」或「程式對外發出請求」的入口，以及 v0.4 的防線是否足夠。

| 入口 | 攻擊者 | v0.4 的防線 | 評估 |
|---|---|---|---|
| `condition_info` HTML → `conditionText` | 券的填寫者（營運、合作網站） | `DOMParser`＋`textContent`，原始 HTML 不存 | 足夠。`DOMParser` 產生的文件沒有瀏覽環境，不執行腳本、不載入資源（依 HTML 標準推論，未實測）。補 S-22。 |
| `conditionText` → `appliesToDiscounted` | 券的填寫者 | 字串比對 | **不足**：否定句會被誤判（C-22）。 |
| 作品名稱、券名 → React 畫面 | API、合作網站 | React 預設跳脫 | 足夠。 |
| 作品名稱、券名 → 系統通知 | API、合作網站 | 去控制字元、截斷 60 字 | 部分不足（S-18）。 |
| Chart.js 標籤與 tooltip | API、DLWatcher | 只用 canvas tooltip | 足夠（canvas 繪字不解析 HTML）。 |
| `href`／`src`／`style` | API、DLWatcher、匯入檔 | 程式組網址、圖片只收 `img.dlsite.jp`、擴充功能頁面 CSP | 擴充功能頁面足夠；**DLsite 頁面內的注入 UI 與導覽不足**（S-13）。 |
| `apiGet` 參數 | 程式內部錯誤、content script 訊息 | 端點代號＋完全比對 | 足夠；補值檢查與呼叫環境檢查（S-23）。 |
| `lookup.html?id=` | 只有擴充功能自己能開（不在 `web_accessible_resources`） | 兩次 `isWorkId()` | 足夠。補：用 `getAll('id').length === 1`。 |
| `chrome.windows.create` 網址 | 程式內部 | 編號驗證後放進參數 | 足夠。 |
| `contextMenus` 的 `linkUrl` | 頁面上任何連結 | `new URL`＋host＋路徑 regex，不 fetch | 足夠。 |
| `runtime.onMessage`（content script） | 被入侵的 DLsite 分頁渲染程序、頁面腳本間接操控 | 來源三條件＋白名單＋zod | 大致足夠；`cartSnapshot` 與 `couponSyncResult` 要補（S-15、S-16）。 |
| `runtime.onMessage`（擴充功能頁面） | 無（只有自己的頁面能送） | `sender.origin` | 足夠；寫法要改（S-17）。 |
| `tabs.sendMessage`（background → content script） | 無（網頁不能對 content script 送 runtime 訊息） | — | 足夠。補：指定 `frameId: 0`、處理分頁沒有 content script 的錯誤（F-13）。 |
| 頁面腳本的假點擊 | DLsite 頁面上的廣告與追蹤腳本 | `isTrusted` | `isTrusted` 無法被頁面偽造（`dispatchEvent`／`.click()` 都是 `false`）。但頁面可以在使用者**真的點擊**前改寫按鈕的 `href`，或把別的元素做成符合選擇器的樣子；影響上限是「多追蹤一件作品」（S-15）。 |
| 購物車 DOM | 同上 | 上限 200、追蹤上限 1,000 | 頻率沒限制（S-15）。 |
| 匯入 JSON | 網路上流傳的檔案 | 5 MB、strict schema、不匯入券與網址 | `priceLog` 內容沒限制（S-20）。 |
| API 回應的物件 key | DLsite、DLWatcher | 無 | 原型污染規則沒涵蓋（S-21）。 |
| 數字、日期 | API | `intLike`、範圍、JST regex | 有缺口（C-17）。 |
| DLWatcher 整份資料 | DLWatcher 營運者、網域到期後的新持有者 | zod、失敗時保留舊資料 | 「格式正確但內容是假的」沒有防線（S-19）。 |
| 建置 | 被入侵的 npm 套件 | lockfile、不跑 install script、audit | 可再補（S-24）。 |

**ReDoS 檢查**（每個 regex 都用 10 萬字的惡意字串實測，Node.js v24，全部在 5 ms 內）：

| Regex | 位置 | 結果 |
|---|---|---|
| `^(RJ\|RE\|BJ\|VJ)(\d{6}\|\d{8})$` | §3.2.2 `isWorkId` | 安全（沒有巢狀量詞、有錨定） |
| `^/[a-z]+/(work\|announce)/=/product_id/([A-Z]{2}\d{6,8})(\.html)?(/\|$)` | §3.2.2 | 安全。9 碼編號會被拒絕（實測 `RJ123456789` → 不符），7 碼由 `isWorkId()` 擋下 |
| `^/product/(RJ\|RE\|BJ\|VJ)(\d{6}\|\d{8})\.json$` | §3.4 | 安全 |
| `^\d+$` | §3.2.3 `intLike` | 安全；但沒有長度上限，見 C-17 |
| `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$` | §5.5 | 安全；但格式對不代表日期存在，見 C-17 |
| `discount_end_date` 的 `MM/DD HH:mm` | §5.5 | **規格沒寫出 regex**，建議 `^(\d{2})\/(\d{2}) (\d{2}):(\d{2})$` |
| 頁面價格、日期 regex | §3.2.6 | **規格沒寫出**；測試設計有問題（先截斷再測），見第一節 S-12 |

**會改變帳號狀態的 GET**：v0.4 的 `fetch` 路徑已經沒有任何方式能打到 `/home/mypage/coupon`（`apiGet` 完全比對＋行為測試）。剩下的路徑是**導覽與頁面內資源載入**，見 S-13。§3.4 的 `credentials`／`redirect` 設定本身正確，理由見 S-23。

---

## 三、新發現：安全

### S-13　導覽與頁面內資源載入也是帶 cookie 的 GET，§3.4 只管到 `fetch`（中）

- **章節**：§3.4、§3.2.2、§3.2.5、§6.2、§7.1
- **問題**：§3.4 的原則寫得很好：「真正的風險是帶 cookie 的請求」。但規則只約束 `fetch`、`XMLHttpRequest` 等 API。以下這些也會以登入狀態對 DLsite 發 GET，卻不經過 `apiGet`：
  1. **導覽**：`chrome.tabs.create({ url })`、`chrome.windows.create`、`window.open`、擴充功能頁面裡的 `<a href>`、通知點擊（§6.2）。目前規格只有「作品頁連結用模板組出」，沒有規定**所有** DLsite 導覽都只能走這個模板。擴充功能頁面的 CSP 也管不到導覽（Chrome 不支援 `navigate-to`）。
  2. **注入 DLsite 頁面的 UI**：shadow root 裡的 `<img src>`、`<link href>`、CSS `url()`、`<a href>`，都是 DLsite 頁面自己發出的同站請求，會帶 cookie。§7.1 的 CSP 只約束擴充功能頁面，**不約束 content script 插進頁面的元素**，所以「第二道防線」在這裡不存在。
- **情境**：日後在試算頁加一個「前往優惠券頁面」的按鈕，有人把網址寫成 `https://www.dlsite.com/home/mypage/coupon`（少了 `/list`，§3.4 警告的那個）。使用者一點，就在登入狀態下打開領券端點。或是徽章想顯示一個 DLsite 的小圖示，`src` 寫成某個帳號頁面的網址，使用者每打開一個作品頁就對那個網址發一次 GET。
- **建議修正**（新增到 §3.4，接在「只有 `couponList` 會帶 cookie」之後）：
  > **導覽與資源載入也算帶 cookie 的 GET。**
  > - 擴充功能開啟 DLsite 網址（`chrome.tabs.create`、`chrome.windows.create`、`window.open`、`<a href>`、通知點擊）只能用兩種來源：`lib/ids.ts` 的 `buildWorkUrl(site, id)`，以及 `lib/nav.ts` 裡固定的常數（目前只有優惠券管理頁 `https://www.dlsite.com/home/mypage/coupon/list` 與購物車頁，實際網址 M2 確認）。
  > - ESLint：只有 `lib/nav.ts` 可以呼叫 `chrome.tabs.create`、`chrome.windows.create`、`window.open`；JSX 的 `href` 只能是 `buildWorkUrl(...)` 的回傳值或 `nav.ts` 的常數（`no-restricted-syntax` 檢查 `JSXAttribute[name.name='href']` 的值）。
  > - 單元測試：`buildWorkUrl` 對所有分站列舉值、`nav.ts` 的每個常數，都不能產生 `/home/mypage/coupon`（不含 `/list`）、加入購物車的路徑、`/buy` 或任何帳號設定路徑。
  > - 注入 DLsite 頁面的 UI 裡**不放任何網址**：沒有 `<img src>`、`<link>`、CSS `url()`，也沒有指向 DLsite 的 `<a href>`。圖示用 inline SVG，開啟擴充功能頁面用訊息（見 F-10）。
  > - 擴充功能不提供「一鍵加入購物車」「前往結帳」「套用優惠券」這類按鈕。

### S-14　徽章若自動查史低，DLWatcher 會即時知道你看過哪些作品（中）

- **章節**：F8、F12、§3.3、§3.5
- **問題**：F12 寫「未追蹤的作品，**點擊**『查史低』才查」；但 §3.5 寫「作品頁的徽章與『查史低』按鈕用 `sendMessage({ type: 'lookup', id })` 向 background 取結果」，F8 又說徽章顯示「史低 ¥xxx」。照 §3.5 的寫法，實作的人很可能讓徽章一載入就送 `lookup`，那麼每打開一個 DLsite 作品頁（包含沒打算買的 R18 作品），background 就會對 DLWatcher 和 DLsite 商品 API 發請求。§3.3 對使用者的說明是「DLWatcher 會知道你查詢的作品」，但使用者理解的「查詢」是「我按了按鈕」，不是「我瀏覽過」。
- **情境**：使用者沒有追蹤任何作品，只是逛了一晚 DLsite。DLWatcher 的伺服器紀錄裡就有這個 IP 在幾點幾分看過哪些作品的完整清單。
- **建議修正**（改寫 §3.5 第 2 點並補進 F8）：
  > - 作品頁徽章**不主動發任何網路請求**。已追蹤的作品，徽章只用本機資料（`snapshots`、`history`、`priceLog`）；未追蹤的作品，徽章只顯示「查史低」按鈕。
  > - 只有使用者真的點擊「查史低」（`isTrusted`）時，content script 才送 `lookup {id}`，background 才查 DLsite 與 DLWatcher。
  > - 設定頁的 DLWatcher 說明改成：「只有你按『查史低』或作品在追蹤清單裡時，才會把作品編號送給 DLWatcher。」

### S-15　`cartSnapshot` 沒有限制來源頁面與頻率；頁面能在點擊前改寫按鈕（低）

- **章節**：§3.2.4、F1、F2
- **問題**：
  1. `cartSnapshot {ids}` 從任何 DLsite 頁面都能送，只限制「一次最多 200 個」，沒有限制次數。被入侵的廣告腳本可以在任何頁面插入看起來像購物車的節點（如果選擇器判斷不嚴）或在購物車頁反覆改寫 DOM，讓 content script 每次都送一份新的 200 個編號，幾分鐘內就把追蹤清單塞滿 1,000 件。
  2. `isTrusted` 擋得住假點擊，但頁面可以在使用者按下滑鼠時（`mousedown` 先於 `click`）改寫「カートに入れる」按鈕的 `href`，讓 F1 讀到攻擊者指定的編號。影響只是多追蹤一件，但會在追蹤清單裡出現使用者沒看過的作品。
- **建議修正**（補進 §3.2.4 數量上限那一點）：
  > - `cartSnapshot` 只接受 `sender.url` 的路徑是購物車頁（實際路徑 M2 確認後寫進 `selectors.ts`）的訊息；同一個 `sender.documentId` 只接受一次。
  > - 每次 `cartSnapshot` 最多新增 50 件到追蹤清單，每天最多新增 200 件（`cartClicked` 與 `cartSnapshot` 合計）；超過就忽略並在 popup 顯示「有 N 件購物車作品沒有自動加入，請到購物車頁確認」。
  > - 由 F1／F2 自動加入的作品，在追蹤清單標示「自動加入」，提供一鍵移除。

### S-16　`couponSyncResult` 沒有和「background 允許同步」綁在一起（低）

- **章節**：§3.2.4、§5.4「同步排程」
- **問題**：白名單允許任何 DLsite 分頁的 content script 隨時送 `couponSyncResult`，不論 background 剛才有沒有回覆「允許同步」。正常情況下這不會發生，但在兩種情況下會變成寫入假券的管道：(1) DLsite 分頁的渲染程序被入侵（瀏覽器漏洞）；(2) DLsite 頁面的 service worker 攔截 content script 發出的同源請求並回傳假資料（content script 的 fetch 以頁面來源發出，是否會經過頁面的 service worker **未驗證**）。影響只限於試算結果錯誤，不會改到帳號，所以列為低。
- **建議修正**（補進 §5.4「同步排程」）：
  > background 允許同步時，回覆一個一次性的 `syncToken`（`crypto.randomUUID()`），並在 `chrome.storage.session` 記下 `{ token, tabId, documentId, expiresAt }`（2 分鐘，與同步鎖同時過期）。`couponSyncResult` 必須帶同一個 `token`，且 `sender.tab.id`、`sender.documentId` 一致才接受；用過立即作廢。

### S-17　擴充功能頁面的來源判斷寫法，在測試環境會得到 `"null"`（低）

- **章節**：§3.2.4 訊息來源表
- **問題**：表格寫 `sender.origin === new URL(chrome.runtime.getURL('')).origin`。依 WHATWG URL 標準，非特殊 scheme 的 `origin` 是不透明的 `"null"`；實測 Node.js 的 `new URL('chrome-extension://abc/').origin` 就是 `"null"`。Chrome 對 `chrome-extension:` 有特別處理，所以在瀏覽器裡大概會得到 `chrome-extension://<id>`（**未驗證**），但 Vitest 單元測試會得到 `"null"`，於是測試要嘛全部失敗，要嘛有人改成 mock，讓「`origin` 是 `"null"` 的來源也通過」。另外，`lookup.html` 與儀表板是開在分頁裡的，所以它們的訊息**也會帶 `sender.tab`**，不能用「有沒有 `tab`」來分辨 content script 與擴充功能頁面。
- **建議修正**（取代表格「擴充功能頁面」那一列的判斷方式）：
  > `const EXT_ORIGIN = \`chrome-extension://${chrome.runtime.id}\`;`
  > 擴充功能頁面：`sender.id === chrome.runtime.id && sender.origin === EXT_ORIGIN && sender.url?.startsWith(chrome.runtime.getURL(''))`。
  > content script：維持三個條件，再加上 `sender.tab !== undefined`，`sender.documentLifecycle` 若有值就必須是 `'active'`。
  > 判斷函式寫在 `lib/messages.ts`，單元測試用固定的假 `runtime.id` 測：`origin` 為 `"null"`、`https://www.dlsite.com.evil.example`、`http://www.dlsite.com`、`frameId: 1` 的訊息全部被拒絕。

### S-18　通知文字只去掉控制字元；券名也會進通知（低）

- **章節**：§6.2、§6 `couponExpiring`
- **問題**：
  1. 「去掉控制字元」通常只處理 Unicode 的 `Cc` 類別。`Cf` 類別的 U+202E（從右到左覆寫）、U+200B（零寬空白）、U+2066～2069（方向隔離），以及 U+2028／U+2029（行分隔），都能讓作品名稱在通知裡顯示成別的樣子或偽造換行。
  2. `couponExpiring` 通知會顯示券名，而券名是合作網站填的（例如 §10.2 的合作券）。§6.2 的規則只寫「作品名稱」。
  3. Windows 的通知中心與鎖定畫面會留著通知內容；作品名稱可能是 R18 標題。
- **建議修正**（取代 §6.2 第 1 點後半）：
  > 作品名稱與券名放進通知前，用 `s.replace(/[\p{Cc}\p{Cf}  ]/gu, '').replace(/\s+/g, ' ').trim()` 清理，再截斷到 60 字。設定頁提供「通知不顯示作品名稱」（只顯示「1 個追蹤作品正在特價」），提醒使用者 Windows 鎖定畫面可能顯示通知內容。

### S-19　DLWatcher 回傳「格式正確但內容是假的」資料時沒有防線（低）

- **章節**：§3.6、§5.2、§6.1、§6.2「等待建議」
- **問題**：§3.6 規定「新的回應驗證成功才覆蓋 `HistoryRecord`」，這擋住了「停止服務」和「回傳 HTML」。但 DLWatcher 是個人營運的第三方網站，如果網域到期被別人買走，或伺服器被入侵，對方可以回傳通過 zod 的假資料，例如每件作品的史低都是 ¥1：
  - `lowest` 規則的基準變成 ¥1，之後永遠不會通知「達到史低」。
  - 儀表板與試算頁一直顯示「通常還會更便宜」「建議等特價」，引導使用者不買。
  - 「驗證成功就覆蓋」讓假資料蓋掉原本正確的歷史。
  - 新持有者也會拿到所有使用者的 IP 與追蹤清單（§3.3 已提到 DLWatcher 會知道這些，但沒想到持有者會換人）。
- **建議修正**（補進 §3.6）：
  > - DLWatcher 資料的合理性檢查（不通過就當作驗證失敗、保留舊資料）：`lowest.price ≤ regularPrice`；`lowest.price ≥ floor(regularPrice × 0.05)`；`start ≤ end ≤ 現在 + 1 天`；走勢點的 `x`、`y` 都在 0～1；同一作品新的 `lowest.price` 比上次低超過 50% 而且自己的 `priceLog` 沒有看過接近的價格時，標示「DLWatcher 資料與自己的紀錄差異很大」。
  > - 畫面同時顯示「DLWatcher 史低」與「自己紀錄的最低價」兩個數字，不只顯示合併後的值。
  > - DLWatcher 連續 7 天對所有作品都失敗（或都不通過檢查），自動暫停 DLWatcher 並通知使用者「DLWatcher 似乎已停止服務，已改用自己的紀錄」；要使用者手動重新開啟。

### S-20　匯入的 `priceLog` 可以偽造史低，時間格式也沒有限制（低）

- **章節**：§3.7、§5.3 `PriceLogEntry`
- **問題**：
  1. §3.7 允許匯入 `priceLog`，只檢查數字範圍。一份流傳的「推薦清單.json」只要附上每件作品一筆 `price: 1` 的紀錄，匯入後史低就是 ¥1（DLWatcher 關閉時更是唯一來源），效果和 S-19 一樣。
  2. IndexedDB 的 key 是 `[id, at]`，`at` 是字串，排序靠字典序。本機寫入的一律是 `toISOString()` 的 24 字元格式，但匯入檔可以寫 `2026-11-23T00:00:00Z`（少了毫秒）或 `+09:00` 結尾，字典序就和時間順序不一致，「最後一筆」「下一筆的 `at`」都會找錯。
  3. 「同一 `at` 以本機為準」只處理完全相同的時間。匯入的紀錄若和本機的時間範圍交錯（本機說 11/1～11/20 都是 ¥1,980，匯入檔說 11/10 是 ¥500），合併後的時間軸就互相矛盾。
- **建議修正**（取代 §3.7 第 3 點括號內的說明）：
  > `priceLog` 匯入規則：
  > - `at`、`lastSeenAt` 必須符合 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`，而且 `new Date(s).toISOString() === s`；`at ≤ lastSeenAt ≤ 匯入當下`。
  > - 同一作品的紀錄依 `at` 排序後不能重疊；每件作品最多 5,000 筆。
  > - 只匯入「早於本機這件作品第一筆 `at`」的紀錄；本機沒有紀錄的作品才整份匯入。
  > - 匯入的紀錄加上 `origin: 'import'`（§5.3 `PriceLogEntry` 新增 `origin?: 'import'`）。史低若來自匯入紀錄，畫面標示「來自匯入的資料」；`lowest` 通知的基準不使用匯入紀錄。

### S-21　原型污染規則只涵蓋匯入，沒涵蓋 API 回應與 storage（低）

- **章節**：§3.7 第 5 點、§3.2.3、§5.3
- **問題**：§3.7 的 `Map`／`Object.create(null)` 規則寫在「匯入」底下，但其他地方也有「外部字串當 key」：
  - DLsite 商品 API 的回應一般是以作品編號為 key 的物件（`{ "RJ01014447": {...} }`，未驗證）。若程式先 `result[key] = ...` 再驗證，`"__proto__"` 會改掉 `result` 的原型。`JSON.parse` 本身不會污染（它把 `"__proto__"` 建成一般屬性），危險的是之後的賦值與合併。
  - zod 的 `z.record()` 會把每個 key 賦值到一個新的一般物件上（依 zod 原始碼推論，未實測）；key 若是 `"__proto__"`，結果物件的原型會被換掉。
  - `ruleState`（key 為 `` `${id}:${rule}` ``）、`notified`、`snapshots` 都是以 key 存的物件。
- **建議修正**（把 §3.7 第 5 點移到 §3.2.3 並擴大範圍）：
  > **外部字串不能直接當一般物件的 key。** API 回應、匯入檔、storage 讀回的資料，凡是以作品編號或券編號為 key 的，一律轉成 `Map`。商品 API 的回應用 `Object.entries()` 逐筆處理，key 必須通過 `isWorkId()` **而且是這次請求的編號之一**，不符的整筆丟棄。用 `z.record()` 時 key 的 schema 必須是作品編號的 regex。匯出格式一律用陣列（`items: TrackedItem[]`、`priceLog: PriceLogEntry[]`），不用以編號為 key 的物件。測試加入 `"__proto__"`、`"constructor"`、`"prototype"` 三種 key。

### S-22　`DOMParser` 的剩餘風險：節點搬家、`script`／`style` 文字（低）

- **章節**：§3.2.1
- **問題**：`DOMParser` 產生的文件本身是惰性的；風險在之後的用法：
  1. 若有人為了「保留粗體」把 `doc.body.firstChild` 用 `append`、`importNode`、`adoptNode` 搬進 DLsite 頁面或 shadow root，節點一進入活的文件，`<img onerror>` 就會執行。
  2. `textContent` 會包含 `<script>`、`<style>` 的原始碼文字，`conditionText` 可能出現一長串 CSS 或 JS 原始碼。
- **建議修正**（補進 §3.2.1 第 3 點）：
  > 取文字前先移除 `script, style, template, noscript, iframe, object` 元素；`DOMParser` 解析出的節點不能 `append`、`importNode`、`adoptNode` 到任何文件，只能讀 `textContent`。`lib/text.ts` 的 `htmlToText()` 是唯一使用 `DOMParser` 的地方，回傳值型別是 `string`。

### S-23　`apiGet` 的細節：參數值、呼叫環境、`mode`（低）

- **章節**：§3.4
- **問題與確認**：
  1. **`credentials`／`redirect` 設定正確**。`couponList` 用 `same-origin`＋`manual`：從 DLsite 頁面發出時帶 cookie，被轉址時不跟過去；就算有人在擴充功能頁面或 background 呼叫它，因為來源是 `chrome-extension://`，`same-origin` 也**不會帶 cookie**，這是額外的保險。`productInfo`、`dlwatcher` 用 `omit`＋`error` 正確；尤其 `omit` 是必要的，因為有 host permission 的擴充功能請求在 cookie 上可能被當成同站（未驗證），不寫 `omit` 就可能帶上 DLsite 的登入 cookie。
  2. `assertAllowed()` 只寫「查詢參數只能是允許的那幾個」，沒有檢查**值**：`product_id` 應該是 1～100 個逗號分隔且都通過 `isWorkId()` 的編號；`cdn_cache_min` 應該固定是 `'1'`；同名參數不能重複。
  3. 沒有檢查 `url.username`、`url.password`、`url.hash` 為空（目前網址是程式組的，所以只是保險）。
  4. 「可呼叫的地方」沒有執行時檢查。
  5. `couponList` 沒有設定 `mode`。
- **建議修正**（補進 §3.4 端點表下方）：
  > - `assertAllowed()` 也檢查參數值：`product_id` 以 `,` 分開後 1～100 個、每個都通過 `isWorkId()`、沒有重複；`cdn_cache_min === '1'`；每個參數名稱只出現一次；`username`、`password`、`hash` 都是空字串。
  > - `apiGet` 檢查呼叫環境：`couponList` 要求 `globalThis.location?.origin === 'https://www.dlsite.com'`；其他端點要求 `globalThis.location?.protocol === 'chrome-extension:'`。不符就丟例外。
  > - `couponList` 加上 `mode: 'same-origin'`：萬一 content script 跑在別的來源（例如 `matches` 寫錯），請求會直接失敗，不會變成跨來源請求。

### S-24　供應鏈與建置可以再補兩條（低）

- **章節**：§7.2
- **問題**：v0.4 的規則（lockfile、不跑 install script、`pnpm audit`）擋得住「install 時執行惡意程式」，但擋不住「剛發佈的惡意版本被升級進來」（`pnpm audit` 只認得已通報的漏洞），也沒檢查打包結果。
- **建議修正**（補進 §7.2）：
  > - `package.json` 寫 `packageManager` 固定 pnpm 版本；`pnpm-workspace.yaml` 設定 `minimumReleaseAge: 1440`（套件發佈未滿 1 天不安裝；需要 pnpm 10.16 以上，版本支援**未驗證**）。
  > - GitHub Actions 的 action 用 commit SHA 固定版本。
  > - `scripts/check-manifest.ts` 另外掃描 `.output/chrome-mv3/**/*.js`：不能出現 `new Function`、`eval(`；字串裡出現的 `https://` 網域只能是 `www.dlsite.com`、`img.dlsite.jp`、`dlwatcher.com`（套件內建的說明網址列白名單）。

---

## 四、新發現：正確性

### C-13　「到期分數」逐單相加，DP 會把每件作品拆成一單，也會白白消耗一次性券（高）

- **章節**：§12.1 目標 3～4、§12.2 第 3 步、§12.3
- **問題**：§12.2 第 3 步定義每一單的值為 `(省下金額, 點數, 到期分數, −1)`，到期分數 = 所用券的 `floor(10⁶ / (剩餘天數 + 1))`，而且**任何券都有分數**，比較時排在訂單數前面。tuple 相加加上字典序比較，DP 本身會正確地找出「這個目標」的最佳解（我用暴力窮舉驗證過），問題出在目標本身：
  1. **拆單會加分**：折扣率券逐件計算，`{p1, p2}` 用 A 和 `{p1}`、`{p2}` 各用 A，省下的錢一樣；但拆成兩單時 A 的分數算兩次。因為到期分數排在訂單數前面，DP 會選「訂單最多」的解。
  2. **可重複使用的券根本不會被用掉**，「優先用快到期的、把期限長的留下來」對它們沒有意義，卻會影響排序。
  3. **為了加分去消耗一次性券**：同樣省 ¥200 的情況下，「多用一張一次性券」會讓分數變高，DP 會選擇把一次性券用掉，即使不用它也能省一樣多。
- **反例**（Node.js 依 §12.2 字面實作）：
  | 案例 | v0.4 規則的結果 | 應有的結果 |
  |---|---|---|
  | 4 件作品（¥1,000／¥1,200／¥800／¥600），1 張可重複使用 30% 券 | 省 ¥1,080，**4 單**（每件一單） | 省 ¥1,080，1 單 |
  | §12.3 範例（10 件，A／B／C 三張可重複使用券） | 省 ¥1,716，**9 單** | 省 ¥1,716，3 單（和範例表格一致） |
  | p1、p2 各 ¥1,000；可重複使用 A 10%（p1、p2 適用）；一次性 X 10%（只適用 p2，3 天後到期） | 省 ¥200，2 單，**用掉 X** | 省 ¥200，1 單，X 留著 |
- **建議修正**（取代 §12.2 第 3 步）：
  > 3. **比較用的值**：每一單的值是 tuple `(省下金額, 點數, 保留分數, −1)`，可以直接相加；DP 的 `max` 用字典序比較。
  >    - 點數：只在勾選「我用特定付款方式」時計算，否則為 0。
  >    - **保留分數**：用 `L` 裡的券 `c` 時為 `−(剩餘天數(c) + 1)`；用 `R` 的券或不用券時為 0。剩餘天數 = `max(0, floor((expiresAt − 試算時間) / 86,400,000))`，整數。
  >      理由：可重複使用的券用了也不會少，不該影響排序；一次性券用掉就沒了，所以「用掉」本身是成本，快到期的成本較低。這樣在省下金額相同時，依序偏好：不用一次性券 → 用快到期的 → 用期限長的；而且把一單拆成兩單不會讓分數變高。
  >    - 最後一項 `−1` 代表這一單算一筆訂單，訂單越少越好。
  >    - ⚠️ 不能用「到期越近分數越高、每單相加」：同一張可重複使用的券每多一單就多加一次分數，DP 會把每件作品拆成一單，也會為了加分去消耗一次性券。
  >
  > §12.1 目標 3 改成：「再相同時，**少用一次性的券**；一定要用時，先用快到期的」。
  > §12.5 測試新增：「1 張可重複使用 30% 券配 4 件作品 → 1 單」「可重複使用券已能達到同樣金額時，不使用一次性券」。

  修正版我用暴力窮舉（列舉所有分組與用券方式，一次性券最多用一次）比對 300 組隨機案例（2～5 件作品、0～2 張可重複使用券、0～2 張一次性券，含門檻與件數條件），結果全部一致；上表三個案例也都得到「應有的結果」。

### C-14　試算沒有排除已過期或還沒開始的券（中）

- **章節**：§12.1 輸入、§12.2 第 1、3 步、§5.3 `startsAt`／`expiresAt`
- **問題**：§12.1 只排除 `plannerUsable: false` 和「留著不用」的券。券同步最多 6 小時一次，本機很可能留著已經過期（`limit_date` 過了）或 `start_date` 還沒到的券。試算會建議使用一張結帳時選不到的券。另外 v0.4 的到期分數 `floor(10⁶ / (剩餘天數 + 1))` 在剩餘天數為 −1 時會除以 0。
- **建議修正**（補進 §12.1 輸入）：
  > 試算開始時，排除 `expiresAt ≤ 試算時間` 或 `startsAt > 試算時間` 的券，並在畫面列出「已過期，未列入」「尚未開始，未列入」。試算結果顯示「依 YYYY-MM-DD HH:mm 同步的券計算」，距離上次同步超過 24 小時時提示先同步。

### C-15　`payment` 型的折扣率券沒有定義；`appliesToDiscounted`、`maxItemPrice` 對 `payment` 券是否適用沒寫（中）

- **章節**：§12.2 第 2 步、§5.3 `Coupon`
- **問題**：
  1. `payment` 型的 `save` 寫死成 `min(value, B)`，這只對定額券成立。資料模型允許 `kind: 'rate'` 搭配 `eligibility.type: 'payment'`，此時 `value` 是 30（代表 30%），照公式會算成「折 ¥30」。
  2. 非 `payment` 型的 `E` 會依 `appliesToDiscounted` 排除打折中的作品，`payment` 型的 `B` 卻沒有提到。§10.2 實測的 ¥400 券寫「可用於所有作品」，但沒寫打折中能不能用；兩種型別的處理不一致。
  3. `Coupon.floors`（7 個樓層旗標）在 §12.2 完全沒用到，不知道是否也要比對。
- **建議修正**（補進 §12.2 第 2 步 `payment` 型那一點）：
  > - `payment` 型且 `kind: 'rate'`：目前沒有實例，標成 `plannerUsable: false`（「整筆折抵的折扣率券，計算方式待確認」），列入 §10.2。
  > - `B` 也套用 `appliesToDiscounted` 與 `maxItemPrice` 的排除規則（和非 `payment` 型相同）；`appliesToDiscounted` 為 null 時依同一個設定處理並標示警告。
  > - `floors` 只用於顯示與 `couponExpiring` 的「追蹤清單裡有可用作品」粗篩，不參與 `save`。（若確認樓層旗標和 `site_ids` 不一致時以哪個為準，列入 §10.2。）

### C-16　補年份規則推不出「前一年」，和自己的測試矛盾（中）

- **章節**：§5.5 `discount_end_date`
- **問題**：規則是「用 `checkedAt` 在 JST 的年份 `y`；候選早於 `checkedAt − 2 天` 就改用 `y + 1`」。這條規則只會產生 `y` 或 `y + 1`，永遠不會產生 `y − 1`。實測：
  | 查價時間（JST） | 看到 | 規則的結果 | 規格測試的期望 |
  |---|---|---|---|
  | 2026-12-30 | `12/31 23:59` | 2026-12-31 ✅ | 同年 |
  | 2026-12-30 | `01/02 23:59` | 2027-01-02 ✅ | 隔年 |
  | 2027-01-01 00:30 | `12/31 23:59` | **2027-12-31** ❌ | 前一年（2026-12-31） |
  | 2026-11-23 | `11/20 13:59`（3 天前已結束的快取） | **2027-11-20** ❌ | 應該是「已結束」 |
  第三列：折扣被當成一年後才結束，`ending` 不會觸發，儀表板顯示錯誤的截止日。第四列同理，而且 `episodeKey` 會用這個錯誤的 `discountEnd`。
- **建議修正**（取代 §5.5 `discount_end_date` 那一點）：
  > - `discount_end_date`（`MM/DD HH:mm`）先用 `^(\d{2})\/(\d{2}) (\d{2}):(\d{2})$` 比對。以 `checkedAt` 在 JST 的年份 `y` 建立 `y − 1`、`y`、`y + 1` 三個候選（日期不存在的候選直接略過，例如非閏年的 2/29），取**最接近 `checkedAt`** 的一個。
  > - 選出的日期早於 `checkedAt`：代表這段折扣已經結束（CDN 快取的舊資料）。照存，但不觸發 `ending`，也不當成新的一段優惠。
  > - 選出的日期晚於 `checkedAt + 180 天`，或三個候選都不存在：當作「截止時間不明」。
  > - 如果 API 回傳含年份的完整格式，直接用 `parseJst()` 解析。
  >
  > 測試補上：`2026-11-23` 看到 `11/20 13:59` → `2026-11-20`（已結束）；`2027-12-20` 看到 `02/29 23:59` → `2028-02-29`；`2027-03-01` 看到 `02/29 23:59` → 不明。

  我實作了這條規則，上表四列與三個新測試都得到期望結果。

### C-17　數字與日期解析的邊界：不存在的日期、超大數字（低）

- **章節**：§5.5、§3.2.3 `intLike`
- **問題**（V8／Node.js v24 實測）：
  1. 格式正確不代表日期存在。`^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$` 通過後轉成 `+09:00` 字串給 `new Date()`：`2026-02-30` 會變成 3/1、`2026-04-31` 會變成 5/1、`24:00:00` 會變成隔天 00:00，都不會報錯（`13` 月和 `:60` 分才會得到 Invalid Date）。
  2. `limit_date` 沒有範圍：當成毫秒會算出 1970-01-21；極大值會讓 `toISOString()` 丟 `RangeError`，若沒接住會讓整次同步失敗，而不是「這張券解析失敗」。
  3. `intLike` 的字串分支沒有長度與範圍：`"99999999999999999999"` 會轉成 `1e20`，400 個 `1` 會轉成 `Infinity`。§3.2.3 說「數字都加範圍」，但 `intLike` 的定義沒有示範怎麼加，實作時容易漏掉。
- **建議修正**：
  > - §5.5：`parseJst()` 在 regex 比對後，用 `Date.UTC(y, m − 1, d, h, mi, s) − 9 × 3,600,000` 算出時間，再檢查 `getUTC*()` 換算回來的年月日時分秒和原字串完全相同，而且 `h ≤ 23`；不同就當作解析失敗。
  > - §5.5：`limit_date` 用 `z.number().int().min(946684800).max(4102444800)`（2000～2100 年）。
  > - §3.2.3：`intLike` 改成帶範圍的工廠函式：
  >   `const intIn = (min: number, max: number) => z.union([z.number().int(), z.string().max(9).regex(/^\d+$/).transform(Number)]).pipe(z.number().int().min(min).max(max));`
  >   價格用 `intIn(0, 1_000_000)`、折扣率 `intIn(0, 100)`、定額面額 `intIn(1, 100_000)`。

### C-18　`campaign_id` 是空字串時 `??` 不會跳過；連續兩檔活動不會重設；key 沒有分隔符（中）

- **章節**：§6.1、§5.1 `campaign_id`
- **問題**（實測）：
  1. §5.1 說 `campaign_id`「可能是空的」。如果 API 回傳 `""`，`"" ?? discountEnd ?? ...` 的結果是 `""`（`??` 只跳過 `null`／`undefined`）。於是同一件作品**所有**非活動折扣的 `episodeKey` 都是 `""`，`sale` 的去重 key 永遠一樣，第一次通知之後 180 天內都不會再通知。
  2. DLsite 常有一檔活動結束、下一檔馬上開始的情況。每 6 小時查價一次，很可能看不到中間「沒打折」的那一刻。依 §6.1，`episode` 只在「打折開始」寫入、「打折結束」清掉，所以新活動沿用舊的 `episodeKey`：`sale` 不會通知，`lowest` 的基準「這段優惠開始之前」也會算錯。
  3. key 直接串接沒有分隔符：`id + 'target' + 1 + '00abc'` 和 `id + 'target' + 100 + 'abc'` 完全相同（實測）。`campaign_id` 是 API 給的任意字串，碰撞雖然少見，但沒必要冒這個險。
- **建議修正**（取代 §6.1 第 2 點與去重 key 表格上方的說明）：
  > - `campaign_id`、`discount_end_date` 在 zod 轉換時，空字串與只有空白的字串一律轉成 `undefined`。
  > - `episodeKey` = `campaignId` ?? `discountEnd` ?? `"start:" + 第一次看到這次打折的 JST 日期`。
  > - 以下任一情況都視為「新的一段優惠」：打折從無到有；或打折中 `campaignId` 改變（兩邊都有值而且不同）；或打折中 `discountEnd` 往後延超過 7 天且 `campaignId` 為空。新的一段優惠會重設 `episode`，並把 `sale` 的 `RuleState` 視為從不成立變成成立。
  > - 去重 key 一律用 `JSON.stringify([id, rule, ...其他欄位])` 組成，不直接串接字串。

### C-19　`ending`「不單獨再發」自相矛盾；`deeper`、`couponExpiring`、未打折時的 `lowest` 不適用 `RuleState`（中）

- **章節**：§6 表格、§6.1、§5.3 `RuleState`
- **問題**：
  1. `ending` 的目的就是「優惠快結束時提醒」，通常發生在 `sale` 已經通知過的幾天之後。§6.1 寫「同一件作品符合多條規則時只發一則……`ending` 不單獨再發」。如果「不單獨再發」是字面意思，`ending` 只會在和其他規則同時觸發時出現，也就是幾乎永遠不會出現；如果意思是「同時成立時合併」，那和前半句重複。
  2. `deeper`（折扣又加深）是一個事件，不是一個「成立／不成立」的狀態，用 `RuleState` 的「從不成立變成立」描述不清楚：同一段優惠從 20% → 30% → 50%，每次加深都要通知嗎？
  3. `couponExpiring` 的對象是券，不是作品，但 `RuleState` 的 key 是 `` `${id}:${rule}` ``，`id` 被定義成作品編號。
  4. `lowest` 在**沒有打折**時（例如原價永久調降）也可能成立，但「這段優惠開始之前」與 `episodeKey` 在沒打折時都沒有定義，key 會變成 `id + 'lowest' + undefined`。
- **建議修正**（在 §6.1 去重 key 表格加一欄「條件」，取代原表格）：
  > | 規則 | 條件（`RuleState.active`） | 通知時機 | 去重 key |
  > |---|---|---|---|
  > | `sale` | 打折中 | 不成立→成立，或進入新的一段優惠（C-18） | `[id, 'sale', episodeKey]` |
  > | `target` | 現價 ≤ 目標價 | 不成立→成立 | `[id, 'target', targetPrice, episodeKey ?? 跌破日期]` |
  > | `lowest` | **打折中**且現價 ≤ 史低基準 | 不成立→成立 | `[id, 'lowest', episodeKey]` |
  > | `ending` | 打折中、`discountEnd − 現在 ≤ 24 小時`，而且 `sale`／`target`／`lowest` 至少一條成立 | 不成立→成立；**可以單獨發** | `[id, 'ending', episodeKey]` |
  > | `deeper` | （事件）打折中且 `discountRate` 大於這段優惠目前見過的最大值 | 每次創新高 | `[id, 'deeper', episodeKey, discountRate]` |
  > | `couponExpiring` | 券在 7 天內到期，且追蹤清單裡有作品可用 | 不成立→成立 | `['coupon', couponKey, expiresAt]` |
  >
  > - 同一次查價裡，同一件作品有多條規則要通知時合併成一則（內文列出全部）。
  > - `RuleState` 的 key 改成 `JSON.stringify([對象種類, 對象編號, rule])`，對象種類為 `'work'` 或 `'coupon'`。
  > - 原價永久調降不算 `lowest`，v1 不通知（儀表板照常顯示）。

### C-20　`priceLog` 只更新 `lastSeenAt` 會把沒查價的空白蓋掉；活動改變但價格沒變時不會新增紀錄（中）

- **章節**：§5.3 `PriceLogEntry`、§3.6
- **問題**：
  1. 規則是「價格、原價或打折狀態變動時新增一筆；沒變動時只更新最後一筆的 `lastSeenAt`」。假設 11/1 查到 ¥1,980，瀏覽器關到 11/4 再開，查到的還是 ¥1,980：照規則只把 `lastSeenAt` 改成 11/4，紀錄變成「11/1～11/4 一直是 ¥1,980」。但這 3 天裡可能有過一次短期特價。§3.6 要求「沒有查價的期間畫成虛線，不假裝價格沒變」，在這個資料模型下**無法做到**，因為空白只存在於「價格有變」的交界。
  2. 「價格、原價、打折狀態」以外的變動不會新增紀錄。連續兩檔活動價格相同（`campaignId` 不同、`discountRate` 相同）時，兩段優惠會被合成一筆，§6.1 的「這段優惠開始之前的最低價」就找不到邊界。
  3. 作品查不到（下架、API 沒有回傳這一件）時怎麼記，沒有寫。
- **建議修正**（取代 §5.3 `PriceLogEntry` 上方的註解）：
  > ```ts
  > // 自己的查價紀錄（IndexedDB "priceLog"，key: [id, at]）
  > // 以下任一情況新增一筆，否則只更新最後一筆的 lastSeenAt：
  > //   1. price、officialPrice、isDiscount、discountRate、campaignId 任一改變
  > //   2. 這次查價時間 − 最後一筆的 lastSeenAt > 2 × 查價週期（預設 12 小時）
  > //      → 代表中間有一段沒查價；畫圖時「上一筆 lastSeenAt 到這一筆 at」畫虛線
  > //   3. 作品查不到（API 沒回傳、is_sold_out）：新增 status: 'unavailable' 的一筆，price 沿用上一筆，不參與史低
  > ```
  > `PriceLogEntry` 新增 `status?: 'unavailable'` 與 `origin?: 'import'`（S-20）。史低與 `lowest` 基準只計算 `status` 為空、`origin` 為空的紀錄。

### C-21　DLWatcher 欄位的日期格式、換算與保存欄位沒有定義（低）

- **章節**：§5.2、§5.3 `HistoryRecord`、§3.6、§6.1
- **問題**：
  1. §5.5 只規定 DLsite 的日期格式。DLWatcher 的 `lowestPrice.priceInfo.start／end`、`recentSalePriceLog[].start／end` 是什麼格式、什麼時區，規格沒寫；§5.5 又禁止在 `lib/dates.ts` 以外直接 `new Date(x)`，實作的人不知道該用哪個函式。
  2. 走勢點換算：`日期 = 該年 1/1 + x × 該年天數`，沒說 1/1 是 JST 還是 UTC；`y × regularPrice` 是小數，沒說怎麼取整。
  3. §5.2 列了 `priceLogGraph.regularPrice`、`ebmInput.sale_count`，但 `HistoryRecord` 沒有對應欄位；S-19 的合理性檢查也需要 `regularPrice`。
  4. §3.6「DLWatcher 停止服務時，通知的史低基準只用自己的紀錄」和「保留上一次的 DLWatcher 資料」之間：保留下來的舊資料還要不要算進基準？沒有寫。
- **建議修正**：
  > - §5.5 新增：「DLWatcher 的日期欄位格式在 M3 依實際回應確認後寫進 `lib/dates.ts`（`parseDlwatcherDate()`），確認前一律當作解析失敗。」
  > - §5.2：「走勢點以 JST 的 1/1 00:00 為起點；價格 = `Math.round(y × regularPrice)`。」
  > - §5.3 `HistoryRecord` 新增 `regularPrice: number`、`saleCount?: number`。
  > - §3.6：「保留下來的 DLWatcher 資料照常算進史低基準，畫面標示『DLWatcher 資料取得於 YYYY-MM-DD』；只有在設定裡關閉 DLWatcher 時才完全不用。」

### C-22　`appliesToDiscounted` 用字串比對，否定句會被誤判（低）

- **章節**：§5.3 `appliesToDiscounted`、§10.1
- **問題**：規則是「`conditionText` 含『割引中の作品にも適用』→ true」。實測 `'割引中の作品にも適用出来ません'.includes('割引中の作品にも適用')` 是 `true`：寫「不能用在打折作品」的券會被當成「可以用」，試算就會建議一張實際上套不上去的券。另外 §10.1 提到券名的【割引併用可】，資料模型沒有使用。
- **建議修正**（取代 §5.3 `appliesToDiscounted` 的註解）：
  > `appliesToDiscounted`：先檢查否定說法（`適用出来ません`、`適用できません`、`対象外`、`併用不可` 出現在「割引中」之後 20 字內）→ false；再檢查肯定說法（`割引中の作品にも適用出来ます`、`割引中の作品にも適用できます`，或券名含【割引併用可】）→ true；其他 → null。比對前先把全形與半形空白去掉。單元測試包含上面每一種說法與它們的否定版本。

### C-23　同一個 `coupon_id` 可能有多張，用 `id` 當 key 會少算（低）

- **章節**：§5.3 `Coupon.id`、§12.5「兩張完全相同的券」、F16「這張券留著不用」
- **問題**：§12.5 的邊界案例有「兩張完全相同的券」，代表規格預期同一種券可能有兩張（例如同一檔活動領了兩次的一次性券）。這兩張的 `coupon_id` 很可能相同（未驗證）。如果 `coupons` 以 `id` 存放、「留著不用」以 `id` 記錄、`couponExpiring` 以 `couponId` 去重，兩張券會被合成一張。
- **建議修正**（補進 §5.3 `Coupon`）：
  > `key: string`：本機唯一識別，`` `${coupon_id}#${limit_date ?? end_date}#${同組序號}` ``。儲存、「留著不用」、`couponExpiring` 都用 `key`；`id` 只用來顯示和比對。同步時若同一個 `key` 出現兩次，以序號區分。（API 會不會對同一種券回傳多筆，列入 §10.2。）

### C-24　未登入時若 API 回傳 `[]`，本機的券會被清空（中）

- **章節**：§5.4 同步結果判斷表、§10.3「未登入時的優惠券 API」、M7
- **問題**：判斷表把「最外層是陣列（含 `[]`）」一律當成功並整批取代。§10.3 列了「未登入時拿到 HTML、`opaqueredirect` 還是例外」與「登入但沒有券時是否回傳 `[]`」，卻沒有考慮**未登入也回傳 `[]`** 的可能（很多 API 對未登入的使用者回空陣列，而不是轉址）。如果是這樣，使用者一登出，下一次自動同步就把本機的券全部清掉，違反 M7 的完成標準「登出後同步，本機的券保留」。
- **建議修正**（判斷表「成功」那列拆成兩列）：
  > | 最外層是陣列、而且不是空的 | 成功 | 以這次結果整批取代本機的券 |
  > | 最外層是 `[]`，本機原本有券 | 可能未登入，也可能券都用完了 | **保留**，popup 顯示「這次同步沒有讀到任何券。如果你已登入而且券確實都用完了，按『清空本機的券』」 |
  > | 最外層是 `[]`，本機原本沒有券 | 成功 | 不變 |
  >
  > §10.3「未登入時的優惠券 API」補上：「未登入時是否也回傳 200 與 `[]`」。

### C-25　章節之間的不一致（低）

| # | 位置 | 問題 | 建議 |
|---|---|---|---|
| a | F15「最多 15 件」vs §12.2 表格「> 15：近似解」 | 兩者矛盾，近似解永遠用不到；近似解又要寫測試 | v1 上限 15 件，刪掉 `> 15` 那一列與 §12.5 的近似解測試，放到第二階段；或把 F15 改成「15 件以上用近似解」 |
| b | §3.3「匯出時優惠券要另外勾選」vs §3.7「不匯入優惠券」 | 匯出的券無法還原，用途不明 | 刪掉匯出券的選項，或寫明「僅供自己查看，不能匯入」 |
| c | §3.2.4「試算資料讀取」訊息 vs §4.2「頁面用 `chrome.storage.onChanged` 更新畫面」 | 頁面讀資料到底是直接讀 storage 還是透過訊息 | 寫明「讀取：頁面直接讀 `chrome.storage.local` 與 IndexedDB；寫入：一律送訊息給 background」，刪掉「試算資料讀取」 |
| d | §3.2.4 content script 訊息清單 | 缺少徽章開啟擴充功能頁面的訊息（F-10） | 新增 `openPage {page: 'dashboard' \| 'lookup', id?}` |
| e | §4.1 `queue: { source, ids[], ... }` | 兩個來源（DLsite、DLWatcher）共用一個 key，一個在退避時另一個也卡住 | 改成 `queues: { productInfo: {...}, dlwatcher: {...} }` |
| f | §6.1「剛加入追蹤的作品第一次查價只建立基準」vs §3.6「按加入追蹤時把當下查到的價格寫成第一筆」 | 從 F12 加入的作品，下一次排程查價算不算「第一次」 | `TrackedItem` 新增 `baselineAt?: string`；第一次寫入 `snapshots` 時設定，`baselineAt` 為空時不發通知。匯入的作品同樣適用 |
| g | §5.3 `TrackedItem.source` | 從 F12「加入追蹤」加入的來源沒有定義 | 寫明用 `'manual'`，或新增 `'lookup'` |
| h | §5.4 判斷表第一列「`response.url` 的 host 不是 `www.dlsite.com`」 | `redirect: 'manual'` 時不會跟隨轉址，`response.url` 一定是請求網址，這個條件永遠不成立 | 刪掉，或註明「保險用」 |
| i | §3.2.3 `price_sum` 正規化 | 接受清單沒有 `null`，下一句卻說 `null` 視為 0 | 改成「接受 `null`、`intLike`、`[]`、`[intLike]`」 |
| j | §3.2.6「10 萬字惡意字串、限時 50 ms」 | 先截斷到 200 字才跑 regex，測試永遠會過 | 改成「regex 函式本身（不經截斷）對 10 萬字惡意字串在 50 ms 內完成」，並把價格、日期 regex 寫進規格 |
| k | §7.1 `unlimitedStorage` | 追蹤上限 1,000 件，資料量估計不到 10 MB，理由沒寫 | 寫明理由（IndexedDB 長期累積的 `priceLog`），或刪掉 |
| l | §10.3 | `externally_connectable`、WXT closed shadow root、`storage.session` 存取層級已由文件確認 | 見 F-15 |

---

## 五、新發現：可行性

### F-10　注入的徽章不能直接連到擴充功能頁面（低）

- **章節**：§3.2.5 最後一點、F8、§7.1 `web_accessible_resources`
- **問題**：§3.2.5 寫「徽章點擊後開啟擴充功能自己的頁面」。DLsite 頁面裡的 `<a href="chrome-extension://…/dashboard.html">` 會被 Chrome 擋下，因為儀表板不在 `web_accessible_resources`。最省事的「修法」是把儀表板加進 `web_accessible_resources`，但那會讓任何 DLsite 頁面都能用 iframe 嵌入儀表板（違反 §3.2.5「擴充功能頁面不用 iframe 嵌進 DLsite 頁面」的精神），也讓網站能偵測擴充功能。
- **建議修正**（補進 §3.2.5 與 §3.2.4 白名單）：
  > 徽章的連結用按鈕實作：使用者點擊（`isTrusted`）時，content script 送 `openPage { page: 'dashboard' | 'lookup', id? }`，background 用 `chrome.tabs.create` 或 `chrome.windows.create` 開啟。擴充功能的 HTML 頁面一律不放進 `web_accessible_resources`。

### F-11　右鍵選單要在 `onInstalled` 建立；網址 regex 不接受含連字號的分站（低）

- **章節**：§7.1 右鍵選單、§4.1、§3.2.2
- **問題**：
  1. Chrome 文件說選單 `id`「不能和這個擴充功能的其他 ID 相同」，範例在 `runtime.onInstalled` 裡建立選單。§4.1 只寫事件監聽器要在最上層註冊，沒寫選單在哪裡建立；若每次 service worker 啟動都 `create`，會在 `lastError` 出現重複 ID 的錯誤。
  2. `targetUrlPatterns`：Chrome 文件說它和 `documentUrlPatterns` 類似，會比對 `<a>` 的 `href`，格式是 match pattern。match pattern 的路徑部分可以包含 `=`，`*` 可以跨過 `/`，所以 `https://www.dlsite.com/*/work/=/product_id/*` 依文法可以比對 `/maniax/work/=/product_id/RJ01014447.html`（依文件推論，**未實測**）。
  3. §3.2.2 的路徑 regex 用 `^/[a-z]+/`，實測不接受 `/maniax-touch/work/=/product_id/...`。§5.4 提到 `site_ids` 有 `touch` 版；如果手機版作品頁的網址是這種形式（**未驗證**），從手機版頁面加入購物車、或在手機版列表頁按右鍵，都取不到編號。
- **建議修正**：
  > - §4.1 補一點：「右鍵選單在 `runtime.onInstalled` 先 `chrome.contextMenus.removeAll()` 再 `create`，不在 service worker 每次啟動時建立。」
  > - §10.3「作品編號」那列補上：「手機版（`touch`）作品頁的網址格式；若含連字號，§3.2.2 的路徑 regex 改成 `^/[a-z]+(-touch)?/…`，分站列舉值同步加入。」

### F-12　zod 4 的 `jitless` 設定在官方文件找不到（低）

- **章節**：§7.2 第 1 點、§10.3「zod 4」
- **問題**：我讀過 zod.dev 的 v4 發佈說明、API 頁與 `@zod/core` 頁，都沒有找到 `z.config({ jitless: true })`，也沒有提到 CSP 或 eval（API 頁超過讀取長度，後段沒讀到）。這個設定可能存在於原始碼但沒寫進文件，也可能名稱不同，**未驗證**。另外，`z.config` 要在「第一次 parse 之前」呼叫，還是要在「schema 定義之前」呼叫，也不確定。
- **建議修正**（改寫 §7.2 第 1 點）：
  > 使用 zod 4 時，M1 先確認 `jitless` 設定的正確寫法（看安裝版本的原始碼或型別定義），並在每個進入點最上方、任何 schema 模組被 import 之前呼叫。M1 的檢查方式：在 popup、儀表板、試算頁、background 監聽 `securitypolicyviolation` 事件（background 看 console），跑一次完整的解析測試，不能出現任何違規。確認不了就改用 zod 3（沒有這個問題）。

### F-13　「立即同步」選到的分頁可能沒有 content script（低）

- **章節**：F14「立即同步」流程
- **問題**：`chrome.tabs.query({ url: 'https://www.dlsite.com/*' })` 會回傳**所有** DLsite 分頁，包含 §3.2.5 `exclude_matches` 排除的結帳、帳號設定頁（那些頁面沒有 content script）、還在載入中的分頁、被瀏覽器丟棄（discarded）的分頁。對它們 `sendMessage` 會得到「Receiving end does not exist」錯誤。另外 `tabs.sendMessage` 預設送給分頁裡所有的 frame。
- **建議修正**（補進 F14「立即同步」流程）：
  > background 依序嘗試 `status === 'complete'`、`discarded === false` 的 DLsite 分頁（目前視窗的作用中分頁優先），用 `chrome.tabs.sendMessage(tabId, msg, { frameId: 0 })`；收到「Receiving end does not exist」就試下一個；全部失敗才顯示「請先開啟任一 DLsite 頁面再同步」。

### F-14　一次性券展開後的張數 `k′` 沒有上限（低）

- **章節**：§12.2 第 1、7 步
- **問題**：§12.2 的運算量是 `(k′ + 1) × 3ⁿ`。n = 15 時 3¹⁵ ≈ 1,435 萬（表格的數字我重算過正確）。`k′` 是所有一次性券展開後的總數，最多到 `Σ min(uᵢ, n − 1)`；如果持有 10 張一次性券，n = 15 時約 1.6 億次 tuple 比較，每次比較 4 個欄位，「約 1～3 秒」的估計**未驗證**，可能明顯更久。完全相同的一次性券也會被重複計算（它們的順序不影響結果）。
- **建議修正**（補進 §12.2 第 7 步）：
  > - 完全相同的一次性券（`kind`、`value`、`eligibility`、門檻、`maxItemPrice`、`appliesToDiscounted` 都相同）只保留到期最早的 `min(張數, n − 1)` 張。
  > - `k′ > 8` 且 `n ≥ 13` 時，先只用到期最早的 8 張一次性券計算，畫面標示「一次性券較多，只考慮最快到期的 8 張」。
  > - M8 實測 n = 15、`k′` = 0、4、8 的計算時間，寫進測試報告。

### F-15　`web_accessible_resources` 可能被 WXT 自動加入；§10.3 有三項可以結案（低）

- **章節**：§7.1、§10.3
- **問題與確認**：
  1. WXT 的 shadow root UI 需要把 content script 的 CSS 載入 shadow root。WXT 是否會因此自動在 manifest 加上 `web_accessible_resources`（以及 `matches` 與 `use_dynamic_url` 怎麼設），**未驗證**。如果會，§7.1「沒有就整段省略」和 `check-manifest` 的檢查會衝突。
  2. 以下三項 Chrome／WXT 文件已經寫明，§10.3 可以改成「文件已確認」：
     - `externally_connectable`：`ids` 留空或不填就沒有擴充功能能連線；`matches` 留空就沒有網頁能連線。
     - WXT `createShadowRootUi` 有 `mode?: 'closed' | 'open'`，預設 `open`。
     - `chrome.storage.session` 預設不開放給 content script，配額 10 MB。
  3. CSP：Chrome 文件確認 `extension_pages` 的政策**也適用於 service worker**，所以 `connect-src` 也會擋 background 的 fetch（§10.3 第一項的後半可以結案）。文件寫 MV3 的最低要求是 `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`，不能比這更寬；§7.1 沒有 `'wasm-unsafe-eval'`，是更嚴格的寫法，應該可以接受。文件沒有說明能不能加 `img-src`、`connect-src`，只提醒加上 `connect-src` 時要注意；所以「Chrome 是否接受」仍要在 M1 確認。
- **建議修正**：
  > - §7.1 `web_accessible_resources` 那一點補上：「若 WXT 為了 shadow root UI 自動加入 CSS 檔，接受這一項，但 `check-manifest` 要檢查：`resources` 只有 CSS 與圖示、`matches` 只有 `https://www.dlsite.com/*`、`use_dynamic_url: true`（WXT 若無法設定，就在 `wxt.config.ts` 的 `manifest` hook 補上）。」
  > - §10.3 依上面第 2、3 點更新。

---

## 六、建議修改 SPEC.md 的項目（依優先順序）

| 順序 | 修改 | 對應發現 | 章節 |
|---|---|---|---|
| 1 | 到期分數改成「只有一次性券計成本」的保留分數；§12.1 目標 3 改寫；加兩個測試 | C-13 | §12.1、§12.2、§12.5 |
| 2 | 新增「導覽與資源載入也算帶 cookie 的 GET」：`lib/nav.ts` 唯一出口、ESLint、測試；注入 UI 不放任何網址 | S-13、F-10 | §3.4、§3.2.5、§3.2.4 |
| 3 | 補年份改成「三個候選取最接近」；`parseJst()` 回推檢查；`limit_date` 範圍；`intIn()` | C-16、C-17 | §5.5、§3.2.3 |
| 4 | 通知：空字串轉 `undefined`、新的一段優惠的判定、`JSON.stringify` 組 key；規則表加「條件」欄，`ending` 可單獨發 | C-18、C-19 | §6、§6.1、§5.3 |
| 5 | `priceLog` 遇到查價空白就新增一筆；`status`、`origin` 欄位 | C-20 | §5.3、§3.6 |
| 6 | 徽章不主動發請求，只有點擊「查史低」才查 | S-14 | F8、§3.5、§3.3 |
| 7 | 同步結果 `[]` 且本機有券時保留；§10.3 補未登入是否回 `[]` | C-24 | §5.4、§10.3 |
| 8 | 試算排除過期與未開始的券；`payment` 折扣率券先標成不可試算；`B` 套用同樣的排除規則 | C-14、C-15 | §12.1、§12.2 |
| 9 | `cartSnapshot` 限制來源頁面、一次文件一次、每日新增上限；`couponSyncResult` 用一次性 token | S-15、S-16 | §3.2.4、§5.4 |
| 10 | 擴充功能頁面來源判斷改用 `chrome-extension://${id}` 字串並加測試 | S-17 | §3.2.4 |
| 11 | 原型污染規則移到 §3.2.3 並涵蓋 API 回應與 storage；匯出格式用陣列 | S-21 | §3.2.3、§3.7 |
| 12 | 匯入 `priceLog` 的格式、排序、範圍規則；匯入紀錄不當通知基準 | S-20 | §3.7、§5.3 |
| 13 | DLWatcher 合理性檢查、兩個史低並列顯示、連續失敗自動暫停 | S-19 | §3.6 |
| 14 | `appliesToDiscounted` 先判否定、再判肯定 | C-22 | §5.3 |
| 15 | `apiGet` 檢查參數值與呼叫環境；`couponList` 加 `mode: 'same-origin'` | S-23 | §3.4 |
| 16 | 通知與券名清除 `Cf` 字元；「通知不顯示作品名稱」選項 | S-18 | §6.2 |
| 17 | `DOMParser` 後先移除 `script`／`style`，禁止搬移節點 | S-22 | §3.2.1 |
| 18 | `Coupon.key` 本機唯一識別 | C-23 | §5.3、§10.2 |
| 19 | DLWatcher 日期格式、走勢換算、`HistoryRecord` 欄位、舊資料是否算進基準 | C-21 | §5.2、§5.3、§5.5、§3.6 |
| 20 | 「立即同步」逐一嘗試分頁、`frameId: 0` | F-13 | F14 |
| 21 | 右鍵選單在 `onInstalled` 建立；`touch` 網址列入 §10.3 | F-11 | §4.1、§10.3 |
| 22 | 一次性券去重與 `k′` 上限；M8 實測計算時間 | F-14 | §12.2 |
| 23 | zod `jitless` 寫法在 M1 確認，確認不了就用 zod 3 | F-12 | §7.2 |
| 24 | 供應鏈：固定 pnpm 版本、`minimumReleaseAge`、action 固定 SHA、掃描打包結果 | S-24 | §7.2 |
| 25 | `web_accessible_resources` 與 WXT 的關係；§10.3 三項結案、CSP 項目更新 | F-15 | §7.1、§10.3 |
| 26 | 章節不一致 a～l | C-25 | 各章節 |

---

## 附錄：本次沒有驗證的事

以下內容需要實際的 Chrome、WXT 專案或 DLsite 才能確認，本次只依文件、標準與既有知識判斷：

**Chrome 與 Web 平台**
- content script 以 `redirect: 'manual'` 對同源網址發 fetch 時，是否得到 `type: 'opaqueredirect'`、`status: 0`。依 Fetch 標準與 Chrome 文件（content script 的請求以頁面來源發出）應該成立，但沒有在 content script 裡實測。
- content script 發出的同源請求，是否會經過 DLsite 頁面的 service worker（影響 S-16）。
- 有 host permission 的擴充功能請求，在 cookie 的 SameSite 判斷上是否被當成同站（影響 S-23 中 `credentials: 'omit'` 的必要性；規格已經寫 `omit`，所以不影響安全）。
- 在 Chrome 裡 `new URL('chrome-extension://<id>/').origin` 的實際值（Node.js 是 `"null"`）。
- `sender.origin` 對擴充功能頁面（popup、分頁中的儀表板、`lookup.html`）是否都有值；文件只寫 Chrome 80 起有這個欄位。
- §7.1 收緊的 `extension_pages` CSP（加上 `img-src`、`connect-src`）是否被 Chrome 接受。文件確認它也適用於 service worker，但沒說能不能加這兩個指令。
- `contextMenus` 的 `targetUrlPatterns` 對 `/=/` 路徑的實際比對結果（依 match pattern 文法推論可以）。
- 擴充功能從 service worker 發出的請求是否帶 `Origin: chrome-extension://<id>`（影響 DLWatcher 能否辨識本擴充功能）。
- 預先轉譯（prerender）的 DLsite 頁面裡，content script 送出的訊息 `frameId`、`documentLifecycle` 的值。
- 使用者真的點擊 `<label>` 時，轉送到關聯控制項的 `click` 是否為 `isTrusted`（影響 S-15 的手法，不影響結論）。

**WXT 與套件**
- WXT 的 shadow root UI 是否會自動加入 `web_accessible_resources`，以及能否設定 `use_dynamic_url`。
- WXT 能否正確打包 Web Worker（規格已列入 M8）。
- zod 4 的 `jitless` 設定名稱與呼叫時機；`z.record()` 對 `"__proto__"` key 的實際行為。
- pnpm `minimumReleaseAge` 的最低支援版本。
- §12.2 在 n = 15、`k′` 較大時的實際計算時間。

**DLsite 與 DLWatcher**
- 未登入時優惠券 API 回傳什麼（HTML、轉址、例外，或 200 與 `[]`）。
- 同一種券有多張時，API 是否回傳多筆相同的 `coupon_id`。
- 商品 API 回應的最外層格式（以編號為 key 的物件或陣列）。
- `campaign_id` 沒有活動時是 `null`、空字串還是不出現。
- 手機版（`touch`）作品頁的網址格式。
- DLWatcher 日期欄位的格式與時區。
- `img.dlsite.jp` 是否檢查 Referer（規格已列入 §10.3）。

**本次已驗證（Node.js v24 實測或官方文件）**
- §12.2 DP 結構：依規格實作並與暴力窮舉比對 300 組隨機案例（用 C-13 修正後的分數），全部一致；v0.4 原本的分數會拆單（C-13 的三個反例）。
- §12.3 範例的各單金額、合計、比較列。
- §5.5 補年份規則的四個案例與修正版規則；`new Date()` 對 `02-30`、`04-31`、`24:00` 的處理；台灣時區下沒有時區的字串比 JST 晚 1 小時；`limit_date: 1796227116` 的換算。
- `??` 對空字串的行為；去重 key 串接的碰撞。
- `intLike` 對超長數字字串的轉換結果；浮點捨去的 1 圓誤差。
- 規格中每個 regex 對 10 萬字惡意字串的執行時間。
- 圖片網址前綴檢查對各種變形網址的結果。
- Chrome 文件：service worker 生命週期、alarms 最短週期、`storage.session` 存取層級與配額、`externally_connectable` 留空的意義、`MessageSender` 欄位、CSP 適用範圍、content script 請求的來源；WXT 文件：`createShadowRootUi` 的 `mode` 選項。
