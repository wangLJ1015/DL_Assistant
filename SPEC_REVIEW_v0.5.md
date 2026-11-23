# SPEC.md v0.5 審查報告（第三輪）

> 審查對象：`SPEC.md` v0.5（2026-11-23，commit `94b1f01`）
> 審查日期：2026-11-23
> 審查方式：只讀規格書、`SPEC_REVIEW.md`（第一輪）、`SPEC_REVIEW_v0.4.md`（第二輪）與公開文件（Chrome Extensions、WXT、pnpm 文件，zod 原始碼）。沒有開啟或登入 DLsite，也沒有請求任何 DLsite 網址。試算 DP、日期規則、通知狀態機、`priceLog` 規則、regex 與捨去都用 Node.js v24 實際跑過（腳本放在暫存資料夾，不在專案內）；需要實際瀏覽器、WXT 專案或 DLsite 才能確認的地方標為「未驗證」，集中在附錄。
> 編號延續第二輪：安全從 S-25、正確性從 C-26、可行性從 F-16 開始。本輪新增「完整性」類別，編號從 K-1 開始（第二輪的章節不一致歸在 C-25）。

---

## 摘要

| 嚴重度 | 安全 | 正確性 | 可行性 | 完整性 | 合計 |
|---|---|---|---|---|---|
| 高 | 0 | 0 | 0 | 0 | **0** |
| 中 | 2 | 5 | 1 | 2 | **10** |
| 低 | 5 | 5 | 5 | 3 | **18** |
| 合計 | 7 | 10 | 6 | 5 | **28** |

第二輪 31 項：**24 項已修正、7 項部分修正、0 項修正後引入新問題**。26 項修改清單都有對應的文字進入 v0.5。本輪沒有「高」：試算 DP 的結構與新的保留分數，用暴力窮舉比對 600 組隨機案例全部一致；§5.5 的 9 個測試全部通過；`fetch` 已經沒有任何路徑打得到領券端點。

**最重要的 5 項修正**

1. **§6.1 通知狀態機要寫成有順序的步驟**（C-26、C-27、C-28，中）。照 v0.5 字面實作，會出現三個漏洞，前兩個已用模擬程式重現：(a) 剛加入的作品只設定 `baselineAt`，沒有同時記下 `RuleState`，6 小時後的下一次查價就會補發「特價」通知，違反 M4 的完成標準；(b) 連續兩檔活動時，只有 `sale` 會重新上膛，第二檔創下新史低時 `lowest` 不會通知；(c)「打折中」沒有單一定義，§5.5「已結束的折扣照存」和 `sale` 的條件互相矛盾。
2. **導覽的唯一出口只靠語法比對的 ESLint 規則，漏洞很多**（S-25，中）。WXT 程式慣用 `browser.tabs.create`（不是 `chrome.`），`tabs.update`、`location.href =`、`<form>`、`{...props}` 都不在規則內；`no-restricted-syntax` 也看不出 `href={url}` 的 `url` 從哪裡來。建議改成型別、專用元件與打包結果掃描三層。
3. **content script 是唯一帶 cookie、又沒有瀏覽器第二道防線的環境**（S-26，中）。擴充功能頁面有 CSP 擋連線，content script 沒有；打包進 content script 的每個套件都能以登入狀態對 `/home/mypage/coupon` 發請求。content script 應該只放最少的程式碼（不放 React、Tailwind），並在 CI 掃描它的打包結果。
4. **商品 API 與 DLWatcher 只讓 background 呼叫，並列出完整的訊息清單**（F-16、K-2，中）。目前擴充功能頁面也能直接呼叫，§3.1 的頻率限制、退避與 24 小時快取都存在 background，跨環境無法共用。擴充功能頁面的訊息清單寫成「…等」，漏了 `track`、`lookup`、重新查價、清空券等；`立即同步` 從 background 送給 content script 的訊息沒有定義。
5. **補上 `Settings` 資料模型與 storage key 清單**（K-1，中）。查價週期、DLWatcher 開關與自動暫停、「我用特定付款方式」、`appliesToDiscounted` 為 null 時的處理、各通知規則的開關、「留著不用」的券，全部沒有欄位定義。M1 要做 storage 存取層，這一項是 M1 的前置條件。

緊接在後的是 C-31（`priceLog` 的「查不到」紀錄在作品恢復販售後不會結束）與 C-32（優惠券回應若整批解析失敗，本機的券會被清空）。

**M1 準備度**：**有條件可以開始**。M1 的範圍（WXT 骨架、ESLint、`apiGet`、storage、商品 API 查價、手動加入）只受 S-25、S-27、F-16、F-21、K-1、K-2、K-4 影響，改動量小（見第八節「M1 前最少修改」）。通知、`priceLog`、試算的問題要在 M3、M4、M8 開工前修正，不擋 M1。

---

## 一、第二輪修正驗證

狀態說明：✅ 已修正　◐ 部分修正（還有缺口）　⚠️ 修正後引入新問題

### 1.1 第二輪 31 項發現

| 編號 | 狀態 | 說明 |
|---|---|---|
| S-13 | ◐ | §3.4 新增「導覽與資源載入」一段：`nav.ts` 唯一出口、`buildWorkUrl`、JSX `href` 規則、注入 UI 不放網址、測試，方向完全正確。缺口：ESLint 規則只列 `chrome.tabs.create`、`chrome.windows.create`、`window.open`，WXT 慣用的 `browser.*`、`tabs.update`、`location` 指派、`<form>` 都漏了；`no-restricted-syntax` 也無法判斷資料來源（S-25）。 |
| S-14 | ✅ | F8、§3.5、§3.3 都寫明「徽章不主動發請求，點擊才查」。剩餘風險：頁面可以用 `history.pushState` 讓徽章對別的作品送 `badgeInfo`（S-28）。 |
| S-15 | ✅ | `cartSnapshot` 限購物車頁、一份文件一次、每次 50、每日 200、「自動加入」標示都已寫入。補充：`sender.url` 可能隨 `pushState` 改變（未驗證），所以真正的上限是「每日 200 件」，這已經足夠。 |
| S-16 | ✅ | 一次性 `syncToken` 綁定 `tabId`／`documentId`，用過作廢。缺口：「立即同步」怎麼授權「略過 6 小時」沒寫（S-30）；check-and-set 要排隊（F-18）。 |
| S-17 | ✅ | 改用 `EXT_ORIGIN` 字串比對，加上 `sender.url` 前綴與四種拒絕案例的測試。 |
| S-18 | ◐ | 規則補上 `Cf`、U+2028／U+2029，涵蓋券名，也加了「通知不顯示作品名稱」。但規格裡那段 regex 字面直接放了 U+2028／U+2029 兩個字元，**照貼進程式是 `SyntaxError`**（實測），截斷 60 字也可能切斷 emoji（C-34）。 |
| S-19 | ◐ | 合理性檢查、兩個史低並列、7 天自動暫停都已寫入。`end ≤ 現在 + 1 天` 可能在「這次特價就是史低」時把整份資料判為不通過；`lowest ≤ regularPrice` 在原價調降後永遠不通過（C-33）。 |
| S-20 | ◐ | 格式、排序、筆數、`origin: 'import'`、不當通知基準都已寫入。小缺口：「早於本機第一筆 `at`」只看 `at`，匯入紀錄的 `lastSeenAt` 仍可能和本機重疊（C-35）。 |
| S-21 | ✅ | 原型污染規則移到 §3.2.3，涵蓋 API、匯入、storage，`Object.entries`＋請求編號比對、`z.record` key regex、三種 key 的測試都在。 |
| S-22 | ✅ | `htmlToText()` 唯一使用 `DOMParser`、先移除 `script` 等元素、禁止節點搬家。 |
| S-23 | ✅ | 參數值檢查、呼叫環境檢查、`mode: 'same-origin'` 都已寫入。依 Web 標準，service worker 的 `self.location` 是 `WorkerLocation`，值是 `chrome-extension://<id>/background.js`，`protocol === 'chrome-extension:'` 的檢查可行；Vitest 裡沒有 `location`，測試要自己提供。 |
| S-24 | ✅ | `packageManager`、`minimumReleaseAge`、action 固定 SHA、打包結果掃描都已寫入。pnpm 11 的設定名稱有變動（F-20）。 |
| C-13 | ✅ | 保留分數改成「只有 `L` 的券計成本」，§12.1 目標 3、§12.5 的兩個測試都已更新。重新實作後與暴力窮舉比對 600 組全部一致；§12.3 範例得到 3 單，「1 張可重複使用券配 4 件」得到 1 單。剩下兩個同分時的取捨問題（C-29）。 |
| C-14 | ✅ | 試算排除過期與未開始的券，並顯示同步時間。 |
| C-15 | ✅ | `payment` 折扣率券標成不可試算，`B` 套用相同的排除規則，`floors` 不參與 `save`，§10.2 k、m 已列入。 |
| C-16 | ✅ | 三個候選取最接近。§5.5 的 6 個補年份測試全部通過（實測結果見第四節）。邊界：截止日在 6 個月以後的折扣會被當成「已結束」（C-28）。 |
| C-17 | ✅ | `parseJst()` 回推檢查、`limit_date` 範圍、`intIn()` 都已寫入；`02-30`、`24:00`、`0099` 年都會被拒絕（實測）。 |
| C-18 | ✅ | 空字串轉 `undefined`、新的一段優惠的三種判定、`JSON.stringify` 組 key。小缺口：沒寫明 `episodeKey` 用存起來的 `episode.key`，還是每次重算（K-3）。 |
| C-19 | ◐ | 規則表加了條件欄，`ending` 可以單獨發，`RuleState` 的 key 改成三元組。缺口：(1) `ending` 的「`sale`／`target`／`lowest` 至少一條成立」一定成立（打折中時 `sale` 一定成立），等於沒有這個條件；(2) 新的一段優惠只重設 `sale`；(3) 建立基準時沒有寫入 `RuleState`（C-26、C-27）。 |
| C-20 | ◐ | 三種新增條件與 `status`、`origin` 欄位都已寫入，「沒查價的空白」可以畫成虛線了。缺口：`unavailable` 的紀錄在作品恢復後不會結束、連續查不到會每次新增一筆（C-31）。 |
| C-21 | ✅ | `parseDlwatcherDate()`、JST 起點、`Math.round`、`regularPrice`、`saleCount`、舊資料照算基準都已寫入。 |
| C-22 | ✅ | 先判否定、再判肯定，規則已寫進 §5.3。有一種會誤判成「不適用」的寫法（偏保守，見 C-35）。 |
| C-23 | ✅ | `Coupon.key` 已加入並用於儲存、「留著不用」與去重。 |
| C-24 | ✅ | `[]` 且本機有券時保留並標示 `empty`。另一條清空路徑還在：非空陣列但每張都解析失敗（C-32）。 |
| C-25 | ✅ | a～l 全部處理：試算上限 15、匯出不含券、讀取直接讀 storage、`openPage`、兩條佇列、`baselineAt`、`source: 'lookup'`、刪掉 `response.url` 那列、`price_sum` 接受 `null`、regex 測試不經截斷並寫出價格 regex、`unlimitedStorage` 理由、§10.3 結案項目。 |
| F-10 | ✅ | `openPage` 訊息與「HTML 頁面不放進 `web_accessible_resources`」已寫入。 |
| F-11 | ✅ | 右鍵選單在 `onInstalled` 重建；`touch` 網址列入 §10.3。實測目前的 regex 仍不接受 `/maniax-touch/...`，等 M1 確認。 |
| F-12 | ✅ | 改成「確認不了就用 zod 3」。本輪讀了 zod 原始碼，`jitless` 確實存在，這一項可以結案（F-20）。 |
| F-13 | ✅ | 逐一嘗試分頁、`frameId: 0`、處理「Receiving end does not exist」。觸發同步的訊息本身沒有定義（K-2）。 |
| F-14 | ✅ | 相同的一次性券去重（保留 `min(張數, n)` 張，比第二輪建議的 `n − 1` 更正確）、`k′ > 8` 截斷、M8 實測。本輪用 typed array 實作估算 n = 15：`k′` = 0／4／8 分別約 125／414／653 ms（Node.js，見第四節）。 |
| F-15 | ◐ | §7.1 的 `web_accessible_resources` 檢查與 §10.3 都已更新。但 WXT 0.21.5 文件寫明 `createShadowRootUi`「要透過網路載入 CSS」，而且本輪在目前的 API 文件頁找不到 `mode: 'closed'` 選項；§10.3 寫「文件已確認支援 closed」要改回待確認（F-19）。 |

### 1.2 第二輪 26 項修改清單

| 順序 | 內容 | 狀態 |
|---|---|---|
| 1 | 保留分數 | ✅（同分取捨見 C-29） |
| 2 | 導覽與資源載入 | ◐（S-25） |
| 3 | 補年份、`parseJst`、`limit_date`、`intIn` | ✅ |
| 4 | 通知 key、條件欄、`ending` | ◐（C-26、C-27） |
| 5 | `priceLog` 新增條件 | ◐（C-31） |
| 6 | 徽章不主動發請求 | ✅ |
| 7 | `[]` 保留本機券 | ✅（另見 C-32） |
| 8 | 試算排除過期券、`payment` 折扣率券 | ✅ |
| 9 | `cartSnapshot`、`syncToken` | ✅ |
| 10 | 擴充功能頁面來源判斷 | ✅ |
| 11 | 原型污染 | ✅ |
| 12 | 匯入 `priceLog` | ◐（C-35） |
| 13 | DLWatcher 合理性檢查 | ◐（C-33） |
| 14 | `appliesToDiscounted` | ✅ |
| 15 | `apiGet` 參數值與環境 | ✅ |
| 16 | 通知清除 `Cf` | ◐（C-34） |
| 17 | `DOMParser` 細節 | ✅ |
| 18 | `Coupon.key` | ✅ |
| 19 | DLWatcher 日期與欄位 | ✅ |
| 20 | 立即同步逐一嘗試 | ✅（訊息定義見 K-2） |
| 21 | 右鍵選單、`touch` | ✅ |
| 22 | 一次性券去重、`k′` 上限 | ✅ |
| 23 | zod `jitless` | ✅（可結案，F-20） |
| 24 | 供應鏈 | ✅（pnpm 11 用語見 F-20） |
| 25 | `web_accessible_resources` 與 WXT | ◐（F-19） |
| 26 | 章節不一致 a～l | ✅ |

### 1.3 第一輪重點項目抽查

| 編號 | 狀態 | 說明 |
|---|---|---|
| S-1 | ✅ | `DOMParser`＋禁止清單＋ESLint 仍在，v0.5 沒有改動。 |
| S-2 | ✅ | 圖片改成解析後比對 `origin`，第二輪提到的 `startsWith` 不一致已解決。 |
| S-3 | ✅ | 端點表、完全比對、行為測試仍在；測試清單含 `/home/mypage/coupon/list`。實測 `new URL()` 會先解掉 `..` 與 `%2e%2e`，所以 `pathname` 完全比對不會被路徑技巧繞過。 |
| S-6 | ✅ | `isWorkId()` 與網址 regex 不變。實測 9 碼編號被拒、`/../` 在 `new URL()` 時就被正規化。 |
| S-9 | ✅ | `externally_connectable` 鎖定、不註冊 `onMessageExternal`。ESLint 也要把 `browser.runtime.onMessageExternal` 列進去（S-25）。 |
| C-1 | ✅ | `g` 只用 `R`，DP 與暴力窮舉一致。 |
| C-5 | ✅ | `Math.floor(price * pct / 100)`：`(180, 35) → 63`、`(90, 70) → 63`；寫成 `180 × (35 / 100)` 仍是 62.999…（實測）。 |
| C-6 | ✅ | 在 `TZ=Asia/Taipei` 下 `parseJst('2026-11-28 23:59:59')` 得到 `14:59:59Z`；直接 `new Date()` 得到 `15:59:59Z`，差 1 小時（實測）。 |
| C-8 | ✅ | 同步判斷表、`redirect: 'manual'`、同步鎖仍在，`[]` 的處理更完整。 |
| C-9 | ◐ | 「狀態轉換才通知」的骨架仍在，但基準建立與新的一段優惠的處理有漏洞（C-26、C-27）。 |
| F-2 | ✅ | §4.1 兩條佇列、`drain` alarm、重建 alarms、`lastRunAt` 仍在。 |

---

## 二、注入與攻擊面總覽（第三次盤點）

### 2.1 外部資料進入程式的入口

| 入口 | 攻擊者 | v0.5 的防線 | 評估 |
|---|---|---|---|
| `condition_info` HTML | 券的填寫者 | `htmlToText()`（`DOMParser`、移除 `script` 等、只取文字、截斷） | 足夠 |
| `conditionText` → `appliesToDiscounted` | 券的填寫者 | 先否定後肯定 | 足夠；有偏保守的誤判（C-35） |
| 作品名稱、券名 → React | API、合作網站 | 預設跳脫 | 足夠 |
| 作品名稱、券名 → 系統通知 | API、合作網站 | 清除 `Cc`／`Cf`、截斷 60 字 | regex 寫法要修（C-34） |
| Chart.js 標籤 | API、DLWatcher | 只用 canvas tooltip | 足夠 |
| 圖片網址 | API | 補 `https:`、比對 `origin` 與帳密 | 足夠 |
| 商品 API 回應的 key | DLsite | `Object.entries`、`isWorkId`、必須是請求的編號 | 足夠 |
| 商品 API 的數字、字串 | DLsite | `intIn()`、長度、`campaign_id` 空字串轉 `undefined` | 足夠 |
| 商品 API 的「查不到」 | DLsite | `status: 'unavailable'` | 紀錄規則有缺口（C-31）；單一壞編號會不會讓整批失敗未驗證（F-21） |
| DLWatcher 整份資料 | DLWatcher、網域新持有者 | zod、合理性檢查、保留舊資料、7 天自動暫停 | 大致足夠；檢查條件會誤殺（C-33） |
| 優惠券 API 回應 | DLsite、頁面的 service worker（未驗證） | 1 MB、`text()`＋`JSON.parse`、逐筆 zod、token | 整批解析失敗會清空本機券（C-32） |
| 購物車頁 DOM | 頁面上的腳本 | 選擇器、`isWorkId`、購物車路徑、一份文件一次、每日 200 | 足夠（`sender.url` 可能被 `pushState` 改，但每日上限仍有效） |
| 加入購物車按鈕 | 頁面上的腳本 | `isTrusted`、「自動加入」標示 | 足夠 |
| 作品頁網址（徽章、`track`、`lookup` 的編號） | 頁面上的腳本 | 由網址取編號 | `pushState` 可以換掉編號（S-28） |
| `contextMenus` 的 `linkUrl` | 頁面上任何連結 | `new URL`＋host＋路徑 regex | 足夠 |
| `lookup.html?id=` | 只有擴充功能自己能開 | 兩次 `isWorkId`、`getAll().length === 1` | 足夠 |
| 儀表板的篩選參數 | 只有擴充功能自己能開 | **沒有定義** | 補格式與驗證（K-2） |
| `runtime.onMessage`（content script） | 被入侵的渲染程序、被操控的 content script | 來源 6 條件、白名單、zod、數量上限、token | 足夠 |
| `runtime.onMessage`（擴充功能頁面） | 無 | `EXT_ORIGIN`、`sender.url` | 足夠；訊息清單不完整（K-2） |
| content script 的 `onMessage`（background → content） | 無（網頁不能送） | 沒有寫 | 補 `syncNow` 的定義與 `sender.id` 檢查（K-2） |
| 匯入 JSON | 網路上流傳的檔案 | 5 MB、strict、只收清單與 `priceLog`、`Map` | 大致足夠（C-35） |
| storage 讀回的資料 | 被其他程式改寫的設定檔（本機） | 載入後放進 `Map` | 足夠 |
| 建置相依套件 | 被入侵的 npm 套件 | lockfile、不執行 install script、`minimumReleaseAge`、bundle 掃描 | content script 要另外收緊（S-26） |

### 2.2 所有對外請求、導覽與資源載入

| 出口 | 帶 cookie？ | 誰能觸發 | 防線 | 評估 |
|---|---|---|---|---|
| `productInfo` fetch | 否（`omit`） | background、擴充功能頁面 | `apiGet`、完全比對、CSP `connect-src` | 足夠；建議只限 background（F-16） |
| `dlwatcher` fetch | 否 | background、擴充功能頁面 | 同上 | 同上 |
| `couponList` fetch | **是** | 只有 content script | `apiGet`、`same-origin`、`redirect: 'manual'`、環境檢查 | 程式本身足夠；**沒有瀏覽器層的第二道防線**（S-26） |
| 擴充功能頁面的 `<img>` | `img.dlsite.jp`（可能帶 `.dlsite.com` 網域的 cookie，未驗證） | 擴充功能頁面 | 只收 `img.dlsite.jp`、CSP `img-src` | 足夠（只讀） |
| 開分頁、開視窗 | **是**（導覽） | `nav.ts` | `buildWorkUrl`、`nav.ts` 常數、ESLint | ESLint 規則有漏洞（S-25）；優惠券管理頁常數會跟隨轉址（S-31） |
| `<a href>`（擴充功能頁面） | **是**（使用者點擊導覽） | React 元件 | JSX `href` 規則 | 同 S-25 |
| 通知點擊 | **是** | background | `buildWorkUrl` | 足夠 |
| 注入 DLsite 頁面的 UI | 不放網址 | content script | §3.2.5 | 足夠；WXT 的 CSS 載入要注意（F-19） |
| 右鍵選單 | 不發請求 | — | 不 fetch `linkUrl` | 足夠 |
| WXT 自己的 CSS 載入 | 擴充功能內部網址 | content script | 無 | 不是對外請求，但違反「唯一 `fetch`」的字面（F-19） |
| 表單送出 | 不應該有 | — | **沒有規則**；CSP 沒有 `form-action` | 補（S-25、S-27） |

### 2.3 會改變帳號狀態的 GET（`/home/mypage/coupon`）

v0.5 下，程式打到領券端點只剩這幾條路，各自的狀態如下：

| 路徑 | 是否擋得住 | 說明 |
|---|---|---|
| `fetch`／XHR 等 | ✅ | `apiGet` 完全比對＋行為測試；擴充功能環境另有 CSP |
| 被轉址 | ✅ | `couponList` 是 `manual`，其他是 `error` |
| 導覽（開分頁、連結、通知） | ◐ | 規則正確，ESLint 有漏洞（S-25）；`nav.ts` 的 `/home/mypage/coupon/list` 常數在導覽時會跟隨轉址（S-31） |
| 注入 UI 的資源 | ✅ | 不放任何網址 |
| 相依套件在 content script 裡發請求 | ◐ | 只有供應鏈規則，沒有執行期防線（S-26） |
| 打包結果 | ◐ | 已掃描網域，沒有掃描路徑；建議加 `mypage/coupon(?!/list)`（S-25、S-26） |

### 2.4 ReDoS 實測

規格裡每個 regex 直接對 10 萬字惡意字串跑（不經截斷），Node.js v24，最慢一次的時間：

| Regex | 位置 | 最慢 | 結果 |
|---|---|---|---|
| `^(RJ\|RE\|BJ\|VJ)(\d{6}\|\d{8})$` | §3.2.2 | 1.26 ms | 安全 |
| 作品網址路徑（含 `(-touch)?` 版） | §3.2.2 | 0.63 ms | 安全；不接受 `/maniax-touch/`（等 M1 確認） |
| `^/product/(RJ\|RE\|BJ\|VJ)(\d{6}\|\d{8})\.json$` | §3.4 | 0.08 ms | 安全 |
| `^\d+$`（`intIn`） | §3.2.3 | 0.51 ms | 安全 |
| 價格 `^[\s¥￥]*(\d{1,3}(?:,\d{3})*\|\d{1,7})\s*円?$` | §3.2.6 | 0.34 ms | 安全；但會接受 `￥1,000,000,000,000`，需要範圍檢查（C-35） |
| `parseJst` | §5.5 | 0.05 ms | 安全 |
| `discount_end_date` | §5.5 | 0.03 ms | 安全 |
| 匯入時間 `^\d{4}-…\.\d{3}Z$` | §3.7 | 0.06 ms | 安全 |
| 通知清理 `[\p{Cc}\p{Cf}  ]`（跳脫寫法） | §6.2 | 2.55 ms | 安全；**規格裡的字面寫法是語法錯誤**（C-34） |
| `\s+` | §6.2 | 2.02 ms | 安全 |
| `appliesToDiscounted` 否定判斷（推定寫法 `割引中.{0,20}?(…)`） | §5.3 | 3.02 ms | 安全（有上限的量詞） |

---

## 三、新發現：安全

### S-25　導覽唯一出口的 ESLint 規則有漏洞，`no-restricted-syntax` 也看不出資料來源（中）

- **章節**：§3.4「導覽與資源載入」、§3.2.4、§7.1
- **問題**：
  1. WXT 的程式慣用 `browser.tabs.create`（`wxt/browser` 匯出的 `browser`），規則只寫 `chrome.tabs.create`。`chrome.tabs.update`、`chrome.windows.update`、`location.href = …`、`location.assign()`、`<form action>`、`<area href>`、`document.createElement('a').href = …` 也都會以登入狀態導覽到 DLsite，規則都沒涵蓋。
  2. `no-restricted-syntax` 用的是 esquery 語法選擇器，只看得到程式碼的**形狀**，看不到值從哪裡來。`href={url}`（`url` 其實是 `buildWorkUrl()` 的結果）會被誤擋；`<a {...linkProps}>`、`React.createElement('a', { href })`、`import { buildWorkUrl as b }`、在檔案裡自己定義一個同名函式，都能繞過。
  3. 打包結果掃描（§7.2）只檢查網域，沒檢查路徑，`https://www.dlsite.com/home/mypage/coupon` 可以出現在打包結果裡而不被發現。
- **情境**：日後在儀表板加「前往我的優惠券」，有人寫 `browser.tabs.create({ url: 'https://www.dlsite.com/home/mypage/coupon' })`。ESLint 沒擋（規則只認得 `chrome.`）、`nav.ts` 的測試沒擋（不在 `nav.ts`）、打包掃描沒擋（網域合法），使用者一點就打開領券端點。
- **建議修正**（取代 §3.4「ESLint：只有 `lib/nav.ts` 可以呼叫…」那一點）：
  > - **型別**：`lib/nav.ts` 匯出品牌型別 `type DlsiteNavUrl = string & { readonly __brand: 'DlsiteNavUrl' }`，只有 `buildWorkUrl()` 與 `nav.ts` 的常數能產生這個型別。`nav.ts` 的 `openTab(url: DlsiteNavUrl | ExtPageUrl)`、`openPopupWindow(...)` 是開分頁與視窗的唯一函式。
  > - **元件**：擴充功能頁面一律用 `components/WorkLink.tsx`（參數是 `site`、`id`）與 `components/NavLink.tsx`（參數是 `nav.ts` 的常數名稱）產生連結。ESLint 用 `react/forbid-elements` 禁止 `<a>`、`<form>`、`<area>`，用 `react/forbid-dom-props` 禁止 `href`、`action`、`formAction`，這兩個元件檔案例外。
  > - **語法規則**（`no-restricted-syntax`，`nav.ts` 例外）：禁止 `(chrome|browser).tabs.(create|update|duplicate)`、`(chrome|browser).windows.(create|update)`、`window.open`、`location.assign`／`location.replace`、對 `location` 或 `location.href` 指派；`(chrome|browser).runtime.onMessageExternal`／`onConnectExternal` 全面禁止。
  > - **打包掃描**：`scripts/check-manifest.ts` 對 `.output/chrome-mv3/**/*.js` 檢查 `/mypage\/coupon(?!\/list)/`、`/home/buy`、`/cart/add`（加入購物車的實際路徑 M2 確認後補上），出現就失敗。
  > - **規則自我測試**：`tests/lint-fixtures/` 放每一種違規寫法的範例檔，CI 確認 ESLint 對每個檔案都報錯（避免規則寫錯而永遠不觸發）。

### S-26　content script 是唯一帶 cookie、又沒有瀏覽器第二道防線的環境（中）

- **章節**：§3.2.5、§3.4、§7.1、§7.2
- **問題**：擴充功能頁面與 service worker 受 §7.1 的 CSP `connect-src` 約束；content script 不受擴充功能 CSP 的 `connect-src` 約束，它發出的請求以 DLsite 頁面的來源送出、帶登入 cookie。所以 content script 裡打包進去的每一行程式碼（React、Tailwind runtime、zod、WXT 的 content script 工具、它們的相依套件），只要有一個被植入惡意版本，就能在使用者每次打開 DLsite 時，以登入狀態呼叫 `/home/mypage/coupon` 或其他帳號端點。ESLint 與 `apiGet` 只約束我們自己寫的程式，不約束 `node_modules`。這正是使用者最在意的帳號安全，而目前它只靠 §7.2 的供應鏈規則。
- **情境**：某個 UI 相依套件的維護者帳號被盜，發佈的新版在 `typeof chrome !== 'undefined' && location.host === 'www.dlsite.com'` 時呼叫 `fetch('/home/mypage/coupon')`。`minimumReleaseAge` 只延後 1 天，`pnpm audit` 在通報前不知道，網域白名單掃描也看不出來（同網域、相對路徑）。
- **建議修正**（新增到 §3.2.5）：
  > **content script 只放最少的程式碼。**
  > - `dlsite.content.ts` 不使用 React、Tailwind、Chart.js。徽章與按鈕用原生 DOM（`createElement`＋`textContent`）建在 closed shadow root 裡，樣式用一段 inline `<style>` 文字（不含 `url()`）。
  > - content script 可以 import 的模組用 ESLint `no-restricted-imports` 列白名單：`lib/ids.ts`、`lib/text.ts`、`lib/selectors.ts`、`lib/messages.ts`、`lib/api/endpoints.ts`（只用 `couponList`）、`lib/coupons/parse.ts`、zod、`wxt` 的 content script 工具。新增項目要改規格。
  > - `scripts/check-manifest.ts` 記錄 content script 打包檔的大小與包含的套件清單（從 source map 取得），和上一版相比有新增套件就失敗，要人工確認。
  > - 已知限制寫進 §11 風險表：「content script 的請求不受擴充功能 CSP 約束；被入侵的相依套件能以登入狀態發請求。對策：content script 最小化、import 白名單、打包差異檢查。」

### S-27　CSP 只限制了連線與圖片，其他資源與表單送出都沒限制（低）

- **章節**：§7.1、§3.2.2 最後一點
- **問題**：§7.1 的 `extension_pages` 沒有 `default-src`，所以 `style-src`、`font-src`、`media-src`、`frame-src` 都不受限制（沒有 `default-src` 就沒有退回值），`<link rel=stylesheet href="https://任意網址">`、CSS `@import`、`<iframe>` 都能對外連線；也沒有 `form-action`，擴充功能頁面裡的 `<form>` 可以送到任何網址（包括 DLsite 的帳號頁面）。另外 `connect-src https://www.dlsite.com` 允許整個網域；CSP 的來源可以寫到路徑，擴充功能環境其實只需要一個 DLsite 路徑。
- **情境**：日後有人加一個字型或第三方 CSS，連線不經過 `apiGet` 也不被 CSP 擋；或在設定頁誤寫一個 `<form action="https://www.dlsite.com/...">`。
- **建議修正**（取代 §7.1 的 `extension_pages`；M1 確認 Chrome 接受）：
  > `"extension_pages": "default-src 'self'; script-src 'self'; object-src 'none'; img-src 'self' https://img.dlsite.jp data:; connect-src 'self' https://www.dlsite.com/maniax/product/info/ajax https://dlwatcher.com/product/; style-src 'self'; font-src 'self'; frame-src 'none'; form-action 'none'; base-uri 'none'"`
  > - `connect-src` 寫到路徑，讓瀏覽器在擴充功能環境直接擋住 `/home/mypage/coupon`（`redirect` 已設 `error`，不受「轉址後忽略路徑」的規則影響）。
  > - `object-src 'none'` 比 MV3 最低要求的 `'self'` 更嚴格；`style-src 'self'` 不擋 React 透過 CSSOM 設定的 `style` 屬性。
  > - §10.3「收緊的 CSP」改成確認這一整條：Chrome 是否接受、是否擋住測試頁裡的 `<form>` 送出與外部 CSS。

### S-28　頁面腳本可以用 `pushState` 換掉徽章的作品編號，或把徽章移到游標下（低）

- **章節**：§3.2.4、§3.2.5、§3.5、F3、F12
- **問題**：
  1. content script 從頁面網址取作品編號。頁面腳本可以用 `history.pushState` 把網址換成別的作品而不重新載入；WXT 的 `wxt:locationchange` 這類機制會讓 content script 以為換了頁，重新送 `badgeInfo`。徽章的外觀（「追蹤中＋史低」或只有一個按鈕）高度不同，頁面讀不到 closed shadow root 的內容，但讀得到宿主元素的大小。廣告腳本因此能逐一換網址，測出使用者追蹤了哪些作品。
  2. 宿主元素在頁面的 DOM 裡，頁面可以把它設成透明、移到使用者下一次點擊的位置。使用者以為點的是別的東西，實際按到「加入追蹤」或「查史低」，產生的是 `isTrusted` 的點擊。搭配第 1 點，就能讓擴充功能以「手動加入」（不是「自動加入」）追蹤攻擊者指定的作品，或把指定的編號送給 DLWatcher。
- **影響**：只多追蹤一件、多送一次編號、洩漏追蹤清單給頁面上的第三方腳本。不影響帳號。
- **建議修正**（補進 §3.2.5）：
  > - 作品頁的作品編號在文件載入時決定一次（`document.URL`），之後不跟著 `pushState`／`locationchange` 改變；同一個 `documentId` 只送一次 `badgeInfo`（background 也檢查）。
  > - 徽章不論是否追蹤都用相同的外框大小；「追蹤中」的資訊放在固定大小的容器裡。
  > - 來自 content script 的 `track` 一律標 `autoAdded: true`（追蹤清單顯示「從作品頁加入」，可一鍵移除），和 F1／F2 相同。
  > - 設定頁提供「不在作品頁顯示徽章」。

### S-29　隱私：DLsite 與頁面上的第三方腳本能知道的事沒有寫清楚（低）

- **章節**：§3.3、§3.2.5、F14
- **問題**：§3.3 寫清楚了 DLWatcher 會知道什麼，但沒寫：
  1. DLsite 每 6 小時會收到一次「這個 IP 的追蹤清單」（商品 API 批次查詢，不帶 cookie，但 IP 和登入中的瀏覽相同）。擴充功能的請求可能帶 `Origin: chrome-extension://<id>`（未驗證），DLsite 也能認出這是本擴充功能。
  2. 頁面上的廣告與分析腳本能偵測本擴充功能：徽章的宿主元素在頁面 DOM 裡；content script 對 `/home/mypage/coupon/list/ajax` 的請求，可能出現在頁面的 `performance.getEntriesByType('resource')` 裡，還帶著回應大小（未驗證）。
  3. zod 4 的錯誤物件可以設定 `reportInput` 帶出原始值；§3.3「錯誤訊息只記錄哪個欄位不符」要明確禁止這個選項。
- **建議修正**（補進 §3.3）：
  > - 設定頁的說明加上：「DLsite 會收到追蹤清單的作品編號（查價用，不帶登入資訊），也可能從請求認出這是本擴充功能。」
  > - 「在作品頁顯示徽章」可以關閉（S-28）；說明「頁面上的其他腳本可能偵測到本擴充功能已安裝」。
  > - zod 解析不使用 `reportInput`；錯誤只記錄 `issue.path` 與 `issue.code`。
  > - §10.3 新增（M7）：content script 的 fetch 是否出現在頁面的 Resource Timing。

### S-30　「立即同步」怎麼取得「略過 6 小時」的授權沒有定義（低）

- **章節**：F14「立即同步」流程、§5.4「同步排程」、§3.2.4
- **問題**：§5.4 說「立即同步略過 6 小時的檢查」，但 background 只透過 `tabs.sendMessage` 叫 content script 同步，content script 再送 `shouldSyncCoupons`。background 要怎麼知道這次的 `shouldSyncCoupons` 是「立即同步」？如果讓 content script 自己帶 `{ force: true }`，等於讓 content script 決定要不要略過頻率限制。`syncToken` 也要綁定 `documentId`，但 background 在 `tabs.query` 時拿不到 `documentId`。
- **建議修正**（取代 F14 流程的第一點後半）：
  > background 對選到的分頁送 `syncNow`（`chrome.tabs.sendMessage(tabId, { type: 'syncNow' }, { frameId: 0 })`），並在 `chrome.storage.session` 記下 `{ pendingManual: { tabId, expiresAt: 現在 + 1 分鐘 } }`。content script 收到後送 `shouldSyncCoupons`；background 看到這個分頁有尚未過期的 `pendingManual` 時才略過 6 小時檢查，並把 `pendingManual` 作廢，再照常發 `syncToken`（此時才記下 `sender.documentId`）。content script 的 `onMessage` 只接受 `sender.id === chrome.runtime.id` 而且沒有 `sender.tab` 的訊息，只認得 `syncNow` 一種。

### S-31　`nav.ts` 的優惠券管理頁常數是離領券端點最近的網址，而導覽會跟隨轉址（低）

- **章節**：§3.4 `nav.ts` 常數
- **問題**：`https://www.dlsite.com/home/mypage/coupon/list` 和領券端點只差 `/list`。`fetch` 可以設 `redirect: 'manual'`，但分頁導覽一定會跟隨轉址；如果這個頁面在某些狀態（未登入、改版、活動頁）轉址到 `/home/mypage/coupon` 或帶參數的領券網址，擴充功能就等於替使用者打開了領券端點。規格裡沒有任何功能需要「開啟優惠券管理頁」。
- **建議修正**：
  > §3.4 `nav.ts` 的常數只留購物車頁。需要引導使用者看券時，畫面以文字說明「DLsite → マイページ → クーポン管理」，不提供連結。日後真的要加，先在 §10.3 確認這個頁面在未登入與登入時都不會轉址到 `/home/mypage/coupon`。

---

## 四、新發現：正確性

本節的結論都用 Node.js 實作規格字面後跑過。

**實測摘要**

| 項目 | 結果 |
|---|---|
| §12.2 DP vs 暴力窮舉 | 600 組隨機案例（1～6 件、0～4 張券；涵蓋折扣率、定額、`payment`、一次性、`usage` 限次、金額門檻、件數門檻、`maxItemPrice`、`appliesToDiscounted` 三種值、`noReduction`），**全部一致** |
| §12.5 邊界案例 | 4 件配 1 張 30% → 省 ¥1,080、1 單；A＋一次性 X → 省 ¥200、1 單、X 留著；`payment` ¥400 滿 ¥1,200 一次性 → ¥400；可重複使用定額 ¥400 配 ¥300×2 → 分兩單省 ¥600；捨去 63／63 |
| §12.3 範例 | 以 p1＝1,200、p4＝1,320、p7＝1,000、p2＝880、p5＝770、p3＝440、p6＝660、p8＝500、p9＝600、p10＝780 重建：DP 得到省 ¥1,716、**3 單**（p10 併入 A 那一單），實付 ¥6,434；只用 A ¥7,094、只用 B 或 C ¥7,820；全部和規格一致 |
| 計算時間（typed array，Node.js） | n = 12：11～37 ms；n = 13：12～66 ms；n = 15：`k′` = 0／4／8 為 125／414／653 ms；n = 15、`k′` = 8 的表格約 10.6 MB |
| §5.5 補年份 | 6 個規格測試全部通過；`02-30`、`24:00` 拒絕；`limit_date` 秒／毫秒正確 |

### C-26　建立基準時沒有記下 `RuleState`，6 小時後會補發通知（中）

- **章節**：§6.1「剛加入追蹤的作品」、§5.3 `TrackedItem.baselineAt`、§9 M4
- **問題**：§6.1 規定 `baselineAt` 為空時「只建立基準、設定 `baselineAt`，不發任何通知」，但沒有說要把這次的條件結果寫進 `RuleState`。實作的人照字面只設 `baselineAt`，下一次查價時 `RuleState` 不存在（視為不成立），條件成立就是「不成立 → 成立」，立刻通知。
- **情境**（模擬）：在打折中的作品頁按「加入追蹤」。第 0 小時：建立基準，沒有通知。第 6 小時：價格、活動都沒變，卻跳出「DL_Assistant：特價」。M4 完成標準「剛加入的作品不會馬上通知」只測了第一次查價，測不到這個情況。
- **建議修正**（取代 §6.1「剛加入追蹤的作品」那一點）：
  > **剛加入追蹤的作品**（`baselineAt` 為空）：這次查價照常計算 `episode` 與每條規則的條件，把結果寫進 `PriceSnapshot.episode` 與 `RuleState`，設定 `baselineAt`，但不發任何通知。之後的查價才依狀態轉換通知。M4 測試加上：「加入時已在打折，之後兩次查價都沒有通知；打折結束再開始才通知。」

### C-27　新的一段優惠只重新上膛 `sale`；評估順序沒有寫（中）

- **章節**：§6 規則表、§6.1「新的一段優惠」
- **問題**：
  1. §6.1 說新的一段優惠「把 `sale` 視為從不成立變成成立」，其他規則沒提。連續兩檔活動時，`lowest` 在第一檔已經成立，第二檔仍成立，沒有狀態轉換，所以**第二檔創新史低時不會通知**。`ending` 也一樣：第一檔的最後 24 小時剛好碰上第二檔開始時，`ending` 一直是成立的狀態。
  2. `ending` 的條件「`sale`／`target`／`lowest` 至少一條成立」：打折中時 `sale` 的條件一定成立，所以這一句永遠為真，沒有作用。原意應該是「使用者開啟的規則裡，至少一條成立」。
  3. `deeper` 要先和舊的 `maxRate` 比較再更新，新的一段優惠要先重設 `maxRate` 再比較；`lowest` 的基準要用新的 `episode.startedAt`。這些順序規格都沒寫，實作的人排錯順序，就會在新活動開始時同時發 `sale` 和 `deeper`，或讓 `lowest` 的基準包含這次的價格。
- **情境**（模擬）：原價 ¥2,000。第一檔活動 c1 ¥1,000，通知「特價＋史低」。6 小時後接著第二檔 c2 ¥800（新的史低），只通知「特價」，沒有「史低」。
- **建議修正**（取代 §6.1「狀態轉換才通知」與「新的一段優惠」兩點，寫成步驟）：
  > **每次查價，每件作品依序處理：**
  > 1. 驗證、轉換 API 資料，得到本次快照 `s`。
  > 2. `onSale = s.isDiscount && !(s.discountEnd && s.discountEnd ≤ 現在)`。規則表、`episode`、`priceLog` 以外的地方說的「打折中」都是 `onSale`（C-28）。
  > 3. 決定 `episode`：`onSale` 為 false → 清掉；`onSale` 為 true 而且（上次沒有 `episode`、`campaignId` 兩邊都有值而且不同、或 `campaignId` 為空而且 `discountEnd` 往後延超過 7 天）→ 新的一段優惠，`episode = { key: campaignId ?? discountEnd ?? 'start:' + JST 日期, startedAt: 現在, maxRate: s.discountRate }`；否則沿用上次的 `episode`。`episodeKey` 一律用 `episode.key`，建立後不重算。
  > 4. 計算每條規則的條件（`lowest` 的基準用第 3 步的 `episode.startedAt`）。`ending` 的條件改成「`onSale`、`discountEnd − 現在 ≤ 24 小時`，而且使用者開啟的 `sale`／`target`／`lowest` 至少一條的條件成立」。
  > 5. 新的一段優惠時，`sale`、`lowest`、`ending` 的上次結果一律視為不成立（`target` 不重設，因為它看的是價格，不是活動）。
  > 6. `baselineAt` 為空：寫入 `episode`、`RuleState`、`baselineAt`，不通知，跳到第 9 步（C-26）。
  > 7. 規則開啟、條件成立、上次不成立 → 列為候選。`deeper`：`onSale`、不是新的一段優惠、`s.discountRate > episode.maxRate` → 列為候選。最後 `episode.maxRate = max(episode.maxRate, s.discountRate)`。
  > 8. 候選的去重 key 不在 `notified` 裡才送出；同一件作品合併成一則，多件作品再合併。
  > 9. 寫回（順序見 F-18）。
  >
  > M4 測試加上：連續兩檔活動且第二檔是新史低 → 通知「特價＋史低」；活動進行中 `discountRate` 20% → 30% → 30% → 只在第一次變 30% 時發 `deeper`。

### C-28　「打折中」沒有單一定義；6 個月以後的截止日被當成已結束（中）

- **章節**：§5.5 `discount_end_date` 第 3、4 步，§6 規則表
- **問題**：
  1. §5.5 第 3 步：補年份後的日期早於 `checkedAt` 代表「已結束」，「照存，但不觸發 `ending`，也不當成新的一段優惠」。但 `PriceSnapshot.isDiscount` 仍是 true，§6 的 `sale` 條件只寫「打折中」。實作的人若用 `isDiscount` 判斷，`sale` 會成立並通知，和第 3 步矛盾；若另外判斷，各處寫法可能不同（規則、儀表板、試算的 `appliesToDiscounted` 都會用到「打折中」）。
  2. 「取最接近 `checkedAt` 的候選」意味著截止日在約 183 天以後的折扣，前一年的候選反而比較近，會被判成「已結束」而不是「不明」；第 4 步「晚於 `checkedAt + 180 天` → 不明」只剩 180～183 天這一小段才用得到。
- **情境**（實測）：2026-06-01 查價，看到 `12/15 23:59`（實際是 2026-12-15，197 天後結束的長期折扣）。規則選出 2025-12-15，判成「已結束」，這檔折扣不當成新的一段優惠，`sale` 不通知，儀表板顯示截止日是去年。
- **建議修正**：
  > - §6 規則表上方加：「本表的『打折中』指 `onSale`（§6.1 第 2 步），由 `lib/rules.ts` 的 `isOnSale(snapshot, now)` 統一計算；儀表板、試算也用同一個函式。」
  > - §5.5 第 3、4 步改成：「選出的日期早於 `checkedAt`、而且相差不超過 7 天：這段折扣已經結束（CDN 快取的舊資料），照存，`onSale` 為 false。相差超過 7 天，或選出的日期晚於 `checkedAt + 180 天`，或三個候選都不存在：當作『截止時間不明』，`discountEnd` 省略。」
  > - §5.5 測試新增：「2026-06-01 查價看到 `12/15 23:59` → 不明」。

### C-29　保留分數的兩個同分取捨，和 §12.1 的文字不一致（低）

- **章節**：§12.1 目標 3、§12.2 第 1、3 步
- **問題**（實測）：
  1. **`uᵢ ≥ n` 的限次券放進 `R` 之後，用掉它不計成本。** 4 件以內配一張「剩 5 次、2 天後到期」的限次券 Z 與一張真正可重複使用的券 A，折扣相同時，DP 選 Z 還是 A 只看券在陣列裡的順序：順序 `[Z, A]` 用掉 Z 的一次，`[A, Z]` 用 A。§12.1 目標 3 的精神是「能不用限次券就不用」。
  2. **加總式的保留分數，會選兩張快到期的一次性券，而不是一張期限長的。** p1、p2 各 ¥1,000；一次性 Y（10%，兩件都適用，30 天後到期）、一次性 X1（只適用 p1，3 天）、一次性 X2（只適用 p2，3 天）。DP 選 X1、X2 分兩單（保留分數 −8），不選 Y 一單（−31）。對使用者來說這可能正是想要的結果（X1、X2 本來就快作廢），但和 §12.1「少用一次性的券；一定要用時，先用快到期的」的字面（先比張數）不同，而且多了一單。
- **建議修正**：
  > - §12.2 第 1 步改成：「`uᵢ ≥ n` 的限次券放進 `R` 計算，但每用一次的保留分數和 `L` 相同（`−(剩餘天數 + 1)`）。」（修正後實測選 A。）
  > - §12.1 目標 3 改成與公式一致：「再相同時，**用掉的一次性券價值最低**：每用一張一次性或限次券，成本是它的剩餘天數 + 1，總成本越低越好。因此兩張 3 天後到期的券，可能比一張 30 天後到期的券更優先被用掉。」
  > - §12.5 新增上面兩個案例的期望結果。

### C-30　§12.2 第 6 步的「捷徑」不保證訂單數最少，而且沒有必要（低）

- **章節**：§12.2 第 6、7 步
- **問題**：捷徑是「每件作品各自挑最好的券，再把用同一張券的作品合成一單」。折扣金額正確，但同分時挑哪張券會影響訂單數。實測：p1 適用 A、B（同為 10%），p2 只適用 B，p3 只適用 C。捷徑讓 p1 挑 A，得到 3 單；DP 讓 p1 用 B，得到 2 單。要讓捷徑也做到最少訂單，等於要解集合覆蓋問題。實測 n = 15、沒有一次性券時 DP 只要約 125 ms，捷徑省下的時間沒有意義。
- **建議修正**：
  > 刪除 §12.2 第 6 步。所有情況都跑 DP；§12.2 第 7 步的表格與 Web Worker 做法不變。

### C-31　`priceLog` 的 `unavailable` 紀錄在作品恢復後不會結束；連續查不到時每次都新增（中）

- **章節**：§5.3 `PriceLogEntry` 上方的三個條件、§3.6
- **問題**：
  1. 第 3 個條件寫「作品查不到：新增 `status: 'unavailable'` 的一筆，`price` 沿用上一筆」。作品恢復販售、價格和下架前一樣時，第 1 個條件比較的 5 個欄位（`price`、`officialPrice`、`isDiscount`、`discountRate`、`campaignId`）都沒變（若實作時把它們都沿用上一筆），所以不新增紀錄，只更新那一筆 `unavailable` 的 `lastSeenAt`。結果是作品已經恢復，紀錄卻一直顯示「查不到」，而且這段期間的價格不算進史低。
  2. 第 3 個條件沒有「上一筆已經是 `unavailable` 就只更新 `lastSeenAt`」，所以下架期間每 6 小時新增一筆（模擬 3 次查價得到 3 筆）。停售一年的作品會多出約 1,460 筆。
  3. 本機沒有紀錄、整份從匯入檔匯入的作品，最後一筆是 `origin: 'import'`。匯入後 12 小時內的第一次查價，若價格相同，會去更新那一筆匯入紀錄的 `lastSeenAt`，本機看到的價格被併進一筆「不算基準」的匯入紀錄。
- **建議修正**（取代 §5.3 註解的三個條件）：
  > ```ts
  > // 以下任一情況新增一筆，否則只更新最後一筆的 lastSeenAt：
  > //   1. status（有值／沒值）、price、officialPrice、isDiscount、discountRate、campaignId 任一和最後一筆不同
  > //   2. 這次查價時間 − 最後一筆的 lastSeenAt > 2 × 查價週期（預設 12 小時）
  > //   3. 最後一筆是 origin: 'import'
  > // 作品查不到（API 沒回傳、is_sold_out）時，這次的值是 { status: 'unavailable', price 等欄位沿用最後一筆 }，
  > // 再套用上面的規則：連續查不到只更新同一筆的 lastSeenAt；恢復販售時 status 改變，一定新增一筆。
  > ```
  > M3 測試加上：「可買 → 查不到 ×3 → 可買（同價）」得到 3 筆紀錄（可買、查不到、可買）。

### C-32　非空陣列但每張券都解析失敗時，本機的券會被清空（中）

- **章節**：§5.4 同步結果判斷表
- **問題**：判斷表「最外層是陣列、而且不是空的 → 成功，以這次結果整批取代（解析失敗的券不寫入，只計數）」。DLsite 改版、某個欄位的型別全部改掉時（例如 `discount` 從字串改成數字、`condition_type` 改名），回應仍是 7 個元素的陣列，但 7 張全部解析失敗。依表格，本機的券被換成 0 張。這和 C-24 修正的「一次登出不能清空本機的券」是同一種資料損失，只是原因換成 API 改版。
- **建議修正**（判斷表「成功」那一列改成兩列）：
  > | 最外層是非空陣列，至少一張解析成功 | 成功 | 以解析成功的券整批取代；popup 顯示「有 N 張券無法解析」 |
  > | 最外層是非空陣列，**全部**解析失敗 | API 可能改版 | **保留**本機的券，標示 `unreadable`，popup 顯示「這次同步讀到 N 張券，但全部無法解析，已保留上次的資料」 |
  >
  > M7 測試加上這兩種情況。

### C-33　DLWatcher 合理性檢查會誤殺正常資料（低）

- **章節**：§3.6「DLWatcher 資料的合理性檢查」
- **問題**：
  1. `start ≤ end ≤ 現在 + 1 天`：如果這次特價就是史低，DLWatcher 的 `lowestPrice.priceInfo.end` 很可能是活動預定的結束時間（未來幾天甚至幾週，格式未驗證）。這時整份資料不通過，被當成可疑而保留舊資料，偏偏是在最需要新資料的時候。
  2. `lowest.price ≤ regularPrice`：DLsite 偶爾會調降原價。原價從 ¥2,200 降到 ¥1,100 後，過去的史低 ¥1,540 就大於現在的原價，這件作品的 DLWatcher 資料之後永遠不通過。
  3. 「比上次低超過 50%，而且自己的 `priceLog` 沒有看過接近的價格」：「接近」沒有定義。
- **建議修正**：
  > - `start ≤ 現在 + 1 天`、`start ≤ end`；`end` 只檢查不晚於 `現在 + 400 天`。（M3 依實際回應確認進行中的特價 `end` 是什麼。）
  > - `lowest.price ≤ max(regularPrice, 自己紀錄裡見過的最大 officialPrice)`。
  > - 「接近」定義為「差距在 5% 以內」。

### C-34　通知清理的 regex 照貼是語法錯誤；截斷可能切斷 emoji（低）

- **章節**：§6.2 第 2 點
- **問題**（實測）：
  1. 規格裡的 `/[\p{Cc}\p{Cf}  ]/gu` 在 `\p{Cf}` 後面直接放了 U+2028、U+2029 兩個字元（檔案裡的位元組是 `E2 80 A8`、`E2 80 A9`，畫面上看起來像兩個空白）。這兩個字元在 JavaScript 是換行符號，**不能出現在 regex 字面裡**，複製貼上會得到 `SyntaxError: Invalid regular expression: missing /`。
  2. 「截斷到 60 字」若用 `s.slice(0, 60)`，會在 emoji 等補充平面字元中間切開，留下單獨的代理字元（實測 `'😀'.repeat(40).slice(0, 59)` 結尾是單獨的高位代理）。
  3. 移除 `Cf` 也會移除 U+200D（ZWJ），家庭 emoji 會被拆成三個人臉；這只影響顯示，可以接受，寫明即可。
- **建議修正**（取代 §6.2 第 2 點的程式碼）：
  > `s.replace(/[\p{Cc}\p{Cf}  ]/gu, '').replace(/\s+/g, ' ').trim()`（U+2028／U+2029 一定要用 `\u` 跳脫寫法），再用 `Array.from(s).slice(0, 60).join('')` 截斷到 60 個字元。

### C-35　較小的解析與合併問題（低）

| # | 位置 | 問題 | 建議 |
|---|---|---|---|
| a | §3.2.6 價格 regex | 規格裡沒有任何功能讀頁面上的價格（價格都來自商品 API）；這個 regex 又會接受 `￥1,000,000,000,000`（實測） | 沒有用途就刪掉。要保留的話，比對後再用 `intIn(0, 1_000_000)` 的同一個範圍檢查 |
| b | §3.7 匯入 `priceLog` | 「只匯入早於本機第一筆 `at`」沒限制 `lastSeenAt`，匯入的一筆可能從本機第一筆之前一直延伸到之後 | 改成「匯入紀錄的 `lastSeenAt` 必須早於本機第一筆 `at`，不符的那一筆截到本機第一筆 `at` 前 1 毫秒」，或採用第六節的簡化 |
| c | §3.7 時間檢查 | `new Date(s).toISOString() === s` 是單一參數的 `new Date()`，§5.5 規定只能寫在 `lib/dates.ts` | 寫明這個檢查放在 `lib/dates.ts` 的 `isCanonicalIso()` |
| d | §5.3 `appliesToDiscounted` | 「割引中の作品にも適用出来ます。※一部対象外の作品があります」：「対象外」落在「割引中」後 20 字內，被判成 false（偏保守，試算會少用一張可用的券） | 否定詞要緊接在「割引中の作品(に\|には\|は)」之後（中間不超過 3 個字），測試加入這個句子 |
| e | §5.3 `floors`、§6 `couponExpiring` | `couponExpiring` 的「追蹤清單裡有作品可用」用 `floors` 粗篩，但 §10.2 m 說樓層旗標和 `site_ids` 不一致時以後者為準 | 改成用 §12.2 的 `E(c, {p})`（任一追蹤作品適用就算） |
| f | §3.1、§3.5 | 臨時查詢的快取放在 `storage.session`，瀏覽器重開就清空；重開後再查同一件作品，會在 24 小時內第二次請求 DLWatcher | 把「每件作品最近一次請求 DLWatcher 的時間」存在 `storage.local`（只存編號與時間），所有請求都先檢查它 |

---

## 五、新發現：可行性

### F-16　商品 API 與 DLWatcher 應該只讓 background 呼叫（中）

- **章節**：§3.4 端點表「可呼叫的地方」、§3.1、§3.5、§4
- **問題**：端點表允許 `productInfo`、`dlwatcher` 從「background、擴充功能頁面」呼叫。但 §3.1 的「請求之間至少 1 秒／2 秒」、退避、「連續失敗 3 次暫停 6 小時」、DLWatcher「每件 24 小時一次」、§3.5 的查詢快取與「每分鐘 10 次」，全部是 background 的狀態。popup、儀表板、`lookup.html` 各自呼叫 `apiGet` 時，這些限制不會共用；兩個分頁同時開著儀表板按「重新查價」，就會對 DLsite 發出兩倍請求。§4 架構圖也只畫了 background 呼叫 `apiGet`。
- **建議修正**：
  > - 端點表 `productInfo`、`dlwatcher` 的「可呼叫的地方」改成「**只有** background」；`apiGet` 的環境檢查改成 `globalThis.location?.href === chrome.runtime.getURL('background.js')`（實際檔名依 WXT 輸出確認），或更簡單地，兩個端點的模組只被 `background.ts` import（ESLint `no-restricted-imports`）。
  > - 擴充功能頁面需要查詢時送訊息（`lookup {id}`、`recheck {ids}`，見 K-2），由 background 套用頻率限制與快取後回覆。
  > - CSP 的 `connect-src` 仍保留這兩個網址（service worker 也受它約束）。

### F-17　`onMessage` 的非同步回應要寫明用 `return true`；service worker 休眠時的 `badgeInfo` 可行（低）

- **章節**：§3.2.4、§4.2、§3.5
- **問題與確認**：
  1. Chrome 文件的 `onMessage` 監聽器型別寫 `boolean | Promise<any> | undefined`，但沒有說從哪個版本開始支援「回傳 Promise 當作回應」（Chrome 99 的 Promise 支援指的是 `sendMessage` 本身）。WXT 0.20 起不再預設使用 `webextension-polyfill`。所以 `badgeInfo`、`shouldSyncCoupons`、`lookup` 這些要等 storage 或 IndexedDB 才能回覆的訊息，應該用 `return true` 加 `sendResponse()`。
  2. service worker 休眠時，`sendMessage` 會喚醒它；監聽器在最上層同步註冊（§4.1 已寫），所以訊息不會遺失。冷啟動加上讀 `storage.local` 與開 IndexedDB，回覆會晚一些（未實測，估計數十到數百毫秒），徽章要先顯示空的固定大小外框（也符合 S-28）。
  3. content script 要處理 `chrome.runtime.lastError`（例如擴充功能剛更新，舊的 content script 失去連線，會出現「Extension context invalidated」），失敗就不顯示徽章，不重試超過一次。
- **建議修正**（補進 §3.2.4）：
  > background 需要非同步回覆的訊息一律 `return true` 並呼叫 `sendResponse()`，不依賴「回傳 Promise」。content script 送訊息時處理 `lastError` 與 `undefined` 回覆；擴充功能更新後舊分頁的 content script 失效，畫面不顯示徽章，不報錯。

### F-18　同步鎖的 check-and-set 要排隊；跨多個 key 的寫入與送通知的先後要定義（低）

- **章節**：§5.4「同步排程」、§4.2、§6.1
- **問題**：
  1. 用一筆 `chrome.storage.session` 紀錄同時當同步鎖與 token 是可行的（`storage.session` 在 service worker 重啟後還在，瀏覽器重開或擴充功能重新載入才清空）。但「讀紀錄 → 判斷沒有鎖 → 寫入新 token」中間有 `await`，兩個分頁的 `shouldSyncCoupons` 幾乎同時到達時，兩個處理函式都可能讀到「沒有鎖」，兩邊都拿到 token、都發出請求（後寫的 token 生效，先拿到的結果被拒絕）。不危險，但違反「同一時間只有一個分頁同步」。
  2. 一次查價要更新 `snapshots`、`ruleState`、`notified`、`recentNotifications`（`storage.local`）與 `priceLog`（IndexedDB），再呼叫 `chrome.notifications.create`。service worker 在中間被終止，可能「已通知但沒記下」（重啟後重複通知），或「已記下但沒通知」（漏掉）。規格沒有說選哪一種。
- **建議修正**（補進 §4.2）：
  > - 同步鎖與 token 的「讀取、判斷、寫入」放在 §4.2 的同一個 Promise 佇列裡執行。
  > - 每件作品處理完，先把 `snapshots`、`ruleState`、`notified`、`recentNotifications` 用**一次** `chrome.storage.local.set({...})` 寫入，`priceLog` 寫入 IndexedDB，然後才呼叫 `chrome.notifications.create`（寧可漏發也不重複發；漏發的通知仍在「最近的通知」看得到）。一次 `set` 寫多個 key 是否不可分割，列入 §10.3（M4）。

### F-19　WXT 的 shadow root CSS 是用網路請求載入的；`mode: 'closed'` 要重新確認（低）

- **章節**：§3.2.5、§7.1 `web_accessible_resources`、§10.3「WXT shadow root」
- **問題與確認**（WXT 0.21.5 文件）：
  1. `createShadowRootUi` 的文件寫「這個函式是 async，因為要透過網路載入 CSS」。也就是 WXT 會在 content script 裡對擴充功能自己的 CSS 檔發請求，這個檔案大概要列進 `web_accessible_resources`（未驗證）。使用 `use_dynamic_url: true` 後，`runtime.getURL()` 回傳的網址是否仍能載入，Chrome 文件沒說（未驗證）。
  2. 本輪在 `createShadowRootUi` 的 API 文件頁找不到 `mode: 'closed'` 選項（第二輪報告說找到過，可能是版本差異）。§10.3 寫「文件已確認支援 closed」要改回待確認。
  3. `cssInjectionMode: 'manual'` 可以自己決定怎麼放樣式，但 WXT 仍會產生 CSS 檔。
- **建議修正**：
  > - 採用 S-26 的做法：content script 不 import CSS 檔，徽章的樣式寫成一段字串，由 content script 自己放進 shadow root 的 `<style>`（`cssInjectionMode: 'manual'`）。這樣不需要 `web_accessible_resources`，也沒有 content script 內的 CSS 網路請求。
  > - 不用 `createShadowRootUi` 也可以：content script 自己 `attachShadow({ mode: 'closed' })`，就不用依賴 WXT 是否支援 closed。
  > - §10.3「WXT shadow root」改成：「`createShadowRootUi` 是否有 `mode: 'closed'`（以安裝版本的型別定義為準）；若採用 inline `<style>`，DLsite 頁面的 CSP 會不會擋住 content script 插入的 `<style>`。」時機 M6。

### F-20　zod `jitless` 已可確認；pnpm 11 的設定名稱改了（低）

- **章節**：§7.2、§10.3「zod 4」「pnpm」
- **確認**：
  1. zod 4 原始碼（`packages/zod/src/v4/core/core.ts`）的 `$ZodConfig` 有 `jitless?: boolean`，註解是「在不允許 eval 的環境關閉 JIT」；`z.config()` 用 `Object.assign` 寫入全域設定。`util.ts` 的 `allowsEval` 是**延遲計算並快取**的：讀到 `jitless` 為 true 就直接回傳 false，否則才在 try/catch 裡 `new Function("")`。所以只要在**第一次 parse 之前**呼叫 `z.config({ jitless: true })` 就有效，不需要在 schema 模組被 import 之前。
  2. pnpm 文件：`minimumReleaseAge` 的單位是分鐘、**預設值已經是 1440**，另有 `minimumReleaseAgeExclude`；v11 移除 `onlyBuiltDependencies`，改用 `allowBuilds`（`strictDepBuilds` 預設 true，遇到未核准的 build script 會讓安裝失敗）；另有 `trustPolicy: 'no-downgrade'`，套件的信任等級（例如原本有 provenance）下降時安裝失敗。文件頁沒寫這些設定從哪個版本開始。
- **建議修正**：
  > - §7.2 第 1 點改成：「使用 zod 4。`lib/zod-setup.ts` 只做 `z.config({ jitless: true })`，每個進入點的第一個 import 就是它（確保在任何 parse 之前執行）。M1 用 `securitypolicyviolation` 事件確認沒有違規。」§10.3「zod 4」結案。
  > - §7.2 pnpm 那兩點改成：「`packageManager` 固定 pnpm 11 的某個版本；`pnpm-workspace.yaml` 明確寫 `minimumReleaseAge: 1440`、`trustPolicy: no-downgrade`、`strictDepBuilds: true`，需要 build script 的套件寫進 `allowBuilds`。」（若固定在 pnpm 10，則用 `onlyBuiltDependencies`，並確認 `minimumReleaseAge` 的最低版本。）

### F-21　沒有 `minimum_chrome_version`；商品 API 一個壞編號會不會讓整批失敗未知（低）

- **章節**：§7.1、§4.1、§10.3「商品 API」
- **問題**：
  1. 規格依賴的平台功能各有最低版本：`MessageSender.documentId`／`documentLifecycle`（Chrome 106）、`storage.session` 10 MB（Chrome 112 起，之前是 1 MB）、`alarms` 最短 30 秒（Chrome 120）。manifest 沒有 `minimum_chrome_version`，舊版 Chrome 安裝後，§3.2.4 的「`documentLifecycle` 有值時」檢查會靜默跳過，`drain` alarm 會被拉長到 1 分鐘。
  2. 商品 API 一次查 100 件。如果其中一件是已刪除或格式怪異的編號，API 是「不回傳那一件」、回傳 `null`，還是整批 4xx／5xx，規格沒寫；若是整批失敗，一件壞掉的作品會讓其他 99 件都查不到價，還會觸發退避。
  3. `URLSearchParams` 會把 `product_id` 裡的逗號編碼成 `%2C`（實測）。DLsite 是否接受，要在 M1 確認。
- **建議修正**：
  > - §7.1 manifest 加 `"minimum_chrome_version": "120"`。
  > - §10.3「商品 API」補上：「不存在或已刪除的編號是不出現、`null` 還是整批錯誤；`product_id` 的逗號編碼成 `%2C` 是否接受。」若會整批錯誤，§4.1 補「整批 4xx 時拆成兩半重試，找出壞的編號並標成 `unavailable`，不計入退避」。

---

## 六、新發現：完整性

### K-1　沒有 `Settings` 資料模型與 storage key 清單（中）

- **章節**：§5.3、§3.6、§6、§10.1 ⑥、§12.2
- **問題**：規格到處寫「依設定」「設定頁可以關閉」，但 §5.3 沒有任何設定的型別。散落各處的設定至少有：查價週期（F4，最短 1 小時）、關閉 DLWatcher（F5）、DLWatcher 自動暫停的狀態與連續失敗的起始時間（§3.6）、「我用特定付款方式」（§10.1 ⑥）、`appliesToDiscounted` 為 null 時是否視為可用（§12.2）、通知不顯示作品名稱（§6.2）、各條通知規則的開關（§6 預設欄）、在作品頁顯示徽章（S-28）、「留著不用」的券（§5.3 說用 `key` 儲存，但沒有存放位置）。匯入規則「不匯入設定」也需要知道設定是什麼。另外 §4.1 的 `queues`、`lastRunAt`、退避狀態，§3.5 的查詢快取，§5.4 的同步鎖，都沒有列在資料模型裡。M1 要做 storage 存取層，沒有這份清單就只能邊做邊猜。
- **建議修正**（新增到 §5.3）：
  > ```ts
  > // 設定（chrome.storage.local，key: "settings"）
  > interface Settings {
  >   checkIntervalHours: number;            // 1～24，預設 6
  >   dlwatcherEnabled: boolean;             // 使用者開關，預設 true
  >   dlwatcherAutoPausedAt?: string;        // §3.6 自動暫停的時間；有值時不請求，直到使用者重新開啟
  >   usePointPaymentMethod: boolean;        // §10.1 ⑥，預設 false
  >   treatUnknownDiscountedAsUsable: boolean; // §12.2 appliesToDiscounted 為 null，預設 false
  >   hideTitlesInNotifications: boolean;    // §6.2，預設 false
  >   showBadge: boolean;                    // S-28，預設 true
  >   rules: Record<'sale' | 'target' | 'lowest' | 'ending' | 'deeper' | 'couponExpiring', boolean>;
  >   reservedCouponKeys: string[];          // F16「留著不用」
  > }
  > // 背景狀態（chrome.storage.local）："queues"、"backoff"、"lastRunAt"、"dlwatcherHealth"、"dlwatcherLastRequest"（C-35 f）
  > // session 狀態（chrome.storage.session）："lookupCache"、"couponSyncLock"、"pendingManual"（S-30）
  > ```
  > §5.3 開頭加一張「storage key 一覽」表：key、所在位置（local／session／IndexedDB）、型別、寫入者、是否匯出。

### K-2　訊息清單不完整：擴充功能頁面的寫入、background → content script、儀表板參數（中）

- **章節**：§3.2.4 來源表、F14、F6、§3.6、§5.4、F16
- **問題**：
  1. 擴充功能頁面那一列寫「匯入、匯出、移除追蹤、暫停、改目標價、改設定、立即同步等**寫入類**操作」。「等」讓實作的人自己補，zod 驗證與測試也就跟著不完整。實際需要的還有：`track {id}`（popup 與 `lookup.html` 的「加入追蹤」）、`lookup {id}`（popup「查詢這個作品」、`lookup.html`；F-16 之後必須走訊息）、`recheck {ids}`（§3.6「手動重新查價」）、`clearCoupons`（§5.4「清空本機的券」）、`setCouponReserved {key, reserved}`（F16）、`resumeDlwatcher`（§3.6）、`dismissNotification` 等。
  2. background 送給 content script 的 `syncNow`（F14 立即同步）沒有定義，content script 的 `onMessage` 該接受什麼、怎麼驗證來源也沒寫（S-30）。
  3. F6 多件合併的通知「開啟儀表板並篩選這幾件」，篩選怎麼傳給儀表板沒寫。若寫成 `dashboard.html?ids=RJ…,RJ…`，就要像 `lookup.html` 一樣驗證。
- **建議修正**：
  > - §3.2.4 擴充功能頁面那一列改成完整清單：`track {id}`、`untrack {id}`、`setPaused {id, paused}`、`setTarget {id, price?}`、`lookup {id}`、`recheck {ids ≤ 100}`、`syncCouponsNow`、`clearCoupons`、`setCouponReserved {key, reserved}`、`setSettings {partial}`、`resumeDlwatcher`、`importPreview {file 內容}`、`importCommit {previewId}`。匯出是讀取，頁面直接讀 storage 組檔案，不經過訊息。訊息的 zod schema 與這張表用快照測試鎖住。
  > - 新增「background → content script」一列：只有 `syncNow`，content script 只接受 `sender.id === chrome.runtime.id` 且沒有 `sender.tab` 的訊息。
  > - F6：多件合併時開 `dashboard.html?n=<notificationId>`，儀表板從 `recentNotifications` 讀出 `ids`（網址裡不放作品編號，也不用驗證一串編號）。

### K-3　資料欄位的語意與清理（低）

| # | 欄位 | 問題 | 建議 |
|---|---|---|---|
| a | `TrackedItem.paused` | 「暫停」是停止查價，還是只停止通知，沒寫。停止查價的話，恢復時 `RuleState` 是舊的 | 寫明「暫停 = 不查價、不通知；恢復時清掉 `baselineAt`，下一次查價重新建立基準」 |
| b | `episodeKey` | 規則表的去重 key 用 `episodeKey`，沒寫明是 `PriceSnapshot.episode.key`；`"start:" + 日期` 這種 key 只能存起來，不能重算 | 寫明一律用 `episode.key`（C-27 第 3 步） |
| c | `HistoryRecord.saleCount`、`Coupon.affectsPayment` | 定義了但沒有任何規則或畫面使用。試算判斷整筆折抵用的是 `eligibility.type === 'payment'` | 寫明用途（顯示在哪裡），或刪掉；`affectsPayment` 和 `condition_type: payment` 不一致時以哪個為準，列入 §10.2 |
| d | `PriceSnapshot` | 沒有「查不到」的狀態，儀表板只能從 `priceLog` 推 | 加 `available: boolean` |
| e | `ruleState`、`notified` | 作品移除追蹤、券同步後消失時，對應的 `RuleState` 不會刪 | 移除追蹤時刪掉該作品的 `RuleState`；每次同步券後刪掉不存在的 `coupon.key` |
| f | §3.7 匯入覆蓋 | 「覆蓋幾件」沒寫覆蓋哪些欄位；覆蓋 `addedAt` 會改變「自 YYYY-MM-DD 開始追蹤」的說明 | 已存在的作品只覆蓋 `targetPrice`、`paused`，`addedAt` 取較早的值，`baselineAt` 不變 |
| g | 匯入的 `TrackedItem` | `autoAdded`、`title`、`imageUrl`、`site` 的初始值沒寫 | `autoAdded: false`、`title: ''`、`imageUrl: ''`、`site: 'maniax'`，第一次查價後更新 |
| h | §3.5 查詢快取 | 存在 `storage.session` 的資料形狀沒定義 | 寫成 `Map<id, { snapshot, history, fetchedAt }>`，200 件上限 |

### K-4　里程碑完成標準沒涵蓋關鍵規則（低）

- **章節**：§9
- **問題**：規格在各章節列了很多單元測試，但 §9 的完成標準只挑了幾項，關鍵的安全與正確性規則沒有綁到任何里程碑。例如 M1 沒有「ESLint 規則真的會擋」的測試，M3 沒有 `priceLog` 的空白與 `unavailable`，M4 沒有連續活動，M6 沒有「徽章不發請求」，M7 沒有 `[]`／全部解析失敗／token 重放。
- **建議修正**（§9 表格上方加一句通則，並補幾項具體標準）：
  > **通則**：每個里程碑完成時，該里程碑涉及的章節裡列出的單元測試全部通過，並寫進 CI。
  > - M1：ESLint 規則自我測試（S-25 的 `tests/lint-fixtures/`）通過；`isWorkId`、`buildWorkUrl`、`intIn`、商品 API 的 `"__proto__"` key 測試通過；CSP 與 `minimum_chrome_version` 被 Chrome 接受。
  > - M3：「可買 → 查不到 → 可買」「關瀏覽器 3 天」兩個 `priceLog` 情境的紀錄筆數正確。
  > - M4：C-26、C-27 的測試情境通過。
  > - M6：開啟 10 個作品頁（含未追蹤），開發者工具的網路面板裡擴充功能沒有發出任何請求。
  > - M7：`[]`、全部解析失敗、未登入三種情況本機的券都保留；重複送同一個 `syncToken` 被拒絕。

### K-5　§10.2／§10.3 待確認清單要補的項目（低）

| 項目 | 內容 | 時機 | 來源 |
|---|---|---|---|
| 商品 API | 壞編號是否讓整批失敗；`%2C` 是否接受 | M1 | F-21 |
| 收緊的 CSP | `default-src`、`form-action`、路徑限定的 `connect-src` 是否被接受並生效 | M1 | S-27 |
| `minimum_chrome_version` | manifest 被接受 | M1 | F-21 |
| `onMessage` 非同步回應 | `return true`＋`sendResponse` 在 service worker 冷啟動時正常 | M2 | F-17 |
| `sender.url` | `pushState` 之後是否跟著改變 | M2 | S-15、S-28 |
| `storage.local.set` 多個 key | 是否不可分割 | M4 | F-18 |
| DLWatcher 進行中的特價 | `lowestPrice.priceInfo.end` 是未來的結束時間還是最後看到的時間 | M3 | C-33 |
| WXT shadow root | 是否有 `mode: 'closed'`；DLsite 的 CSP 是否擋 content script 插入的 `<style>` | M6 | F-19 |
| Resource Timing | content script 的 fetch 是否出現在頁面的 `performance` 紀錄 | M7 | S-29 |
| 優惠券管理頁 | 未登入時是否轉址到 `/home/mypage/coupon`（若保留 `nav.ts` 常數才需要） | M7 | S-31 |
| §10.2 n | `is_affect_to_payment` 對折扣率券的意義，和 `condition_type: payment` 不一致時以哪個為準 | 有實例時 | K-3 c |
| §10.2 o | `payment` 券的 `minItems` 是否只算樓層內的作品 | 有實例時 | §12.2 |

---

## 七、過度複雜、建議簡化的章節

| 章節 | 現況 | 簡化建議 | 省下的東西 |
|---|---|---|---|
| §12.2 第 6 步 | 「捷徑」有 5 個適用條件，同分時還會多出訂單（C-30） | 刪除，一律跑 DP | 一條程式路徑、一組測試、一個 bug |
| §6.1 | 規則分散在 6 段文字，`RuleState`、`episode`、`NotifiedKey` 三套機制的先後關係要讀者自己拼 | 改寫成 C-27 的 9 個步驟；`notified` 只當「service worker 重啟後避免重複」的保險 | 評估順序的歧義 |
| §3.4 導覽 | 一條能被輕易繞過的語法規則 | 改成品牌型別＋兩個連結元件＋打包掃描＋lint 自我測試（S-25） | 不用維護脆弱的 esquery 選擇器 |
| §3.2.5 注入 UI | React＋Tailwind＋WXT shadow root＋可能的 `web_accessible_resources` | content script 用原生 DOM 與 inline `<style>`（S-26、F-19） | 一整個 `web_accessible_resources` 的檢查、content script 的大部分相依套件 |
| §3.7 匯入 `priceLog` | 格式、排序、重疊、「早於本機第一筆」、`origin` 五條規則 | v1 只對「本機完全沒有紀錄」的作品匯入 `priceLog`，有紀錄的作品整份略過並在摘要顯示「N 件已有本機紀錄，未匯入」 | 合併與重疊的邊界（C-35 b） |
| §5.4 同步排程 | 6 小時檢查、同步鎖、token、立即同步散在 F14 與 §5.4 | 寫成單一函式 `requestCouponSync(sender, manual)` 的步驟，`pendingManual` 是唯一的「略過」來源（S-30） | 授權邏輯的歧義 |
| §3.2.6 價格 regex | 沒有功能使用 | 刪除（C-35 a） | 一個 regex 與它的測試 |

---

## 八、建議修改 SPEC.md 的項目（依優先順序）

| 順序 | 修改 | 對應發現 | 章節 | 最晚時機 |
|---|---|---|---|---|
| 1 | 導覽改成品牌型別＋連結元件＋擴大語法規則（含 `browser.*`、`tabs.update`、`location`、表單）＋打包路徑掃描＋lint 自我測試 | S-25 | §3.4、§7.2 | **M1** |
| 2 | `productInfo`、`dlwatcher` 只限 background；列出完整訊息清單、`syncNow`、儀表板參數 | F-16、K-2 | §3.4、§3.2.4、F6、F14 | **M1** |
| 3 | 新增 `Settings` 型別與 storage key 一覽表 | K-1 | §5.3 | **M1** |
| 4 | CSP 加 `default-src`、`form-action`、`frame-src`，`connect-src` 寫到路徑 | S-27 | §7.1、§10.3 | **M1** |
| 5 | `minimum_chrome_version: "120"`；商品 API 壞編號與 `%2C` 列入 §10.3 | F-21 | §7.1、§10.3、§4.1 | **M1** |
| 6 | §9 加通則與 M1 的 lint 自我測試等具體標準 | K-4 | §9 | **M1** |
| 7 | zod `jitless` 結案、`zod-setup.ts`；pnpm 依固定的主版本改寫設定名稱 | F-20 | §7.2、§10.3 | **M1** |
| 8 | content script 最小化、import 白名單、打包差異檢查；§11 補風險 | S-26 | §3.2.5、§7.2、§11 | M2 |
| 9 | `onMessage` 用 `return true`；處理 `lastError` | F-17 | §3.2.4 | M2 |
| 10 | `priceLog` 新增條件納入 `status` 與匯入紀錄 | C-31 | §5.3 | M3 |
| 11 | DLWatcher 合理性檢查放寬 `end`、`regularPrice` | C-33 | §3.6 | M3 |
| 12 | §6.1 改寫成 9 個步驟：`onSale`、`episode`、新的一段優惠重設 `sale`／`lowest`／`ending`、建立基準時寫入 `RuleState`、`deeper` 順序、`ending` 條件 | C-26、C-27、C-28 | §6、§6.1、§5.5 | M4 |
| 13 | 補年份：早於 7 天以上視為不明；新增測試 | C-28 | §5.5 | M4 |
| 14 | 寫入與送通知的先後；同步鎖排隊 | F-18 | §4.2 | M4 |
| 15 | 通知清理 regex 用 `\u` 跳脫；以字元截斷 | C-34 | §6.2 | M4 |
| 16 | 徽章編號只在載入時決定、固定大小、`track` 標示來源、可關閉徽章 | S-28 | §3.2.5 | M6 |
| 17 | WXT CSS：改用 inline `<style>`；`mode: 'closed'` 改回待確認 | F-19 | §3.2.5、§7.1、§10.3 | M6 |
| 18 | 隱私說明補上 DLsite 與頁面腳本能知道的事；禁用 `reportInput` | S-29 | §3.3 | M6 |
| 19 | 非空陣列全部解析失敗時保留本機券 | C-32 | §5.4 | M7 |
| 20 | 立即同步用 `pendingManual` 授權 | S-30 | F14、§5.4 | M7 |
| 21 | 刪掉 `nav.ts` 的優惠券管理頁常數 | S-31 | §3.4 | M7 |
| 22 | 刪除 §12.2 第 6 步捷徑 | C-30 | §12.2 | M8 |
| 23 | 限次券放進 `R` 也計成本；§12.1 目標 3 改成和公式一致；補兩個測試 | C-29 | §12.1、§12.2、§12.5 | M8 |
| 24 | 資料欄位語意與清理 a～h | K-3 | §5.3、§3.7 | 各里程碑 |
| 25 | 小型解析與合併問題 a～f | C-35 | §3.2.6、§3.7、§5.3、§6、§3.5 | 各里程碑 |
| 26 | §10.2／§10.3 補項 | K-5 | §10 | 各里程碑 |
| 27 | 第七節的簡化（匯入、同步排程） | — | §3.7、§5.4 | 各里程碑 |

---

## 九、M1 準備度評估

**結論：有條件可以開始 M1。**

規格的安全邊界（唯一的 `apiGet`、完全比對、`credentials`／`redirect` 設定、不碰領券端點、資料只存本機、券不匯出、外部資料只當純文字、URL 由程式自己組）在第三輪已經完整而一致，沒有任何一項會讓擴充功能領券、改購物車或結帳。試算演算法經暴力窮舉驗證正確，日期規則的測試全部通過。剩下的問題大多集中在通知（M4）、`priceLog`（M3）、優惠券同步（M7）與試算的同分取捨（M8），都不在 M1 的範圍內。

M1 要做的是 WXT 骨架、ESLint 規則、`apiGet` 與白名單、storage 存取層、商品 API 查價與手動加入。這幾件事會直接寫進程式基礎、之後很難改的部分，所以下面這些要先改進規格：

**M1 前最少修改**（第八節第 1～7 項）

1. **S-25**：ESLint 的導覽規則要涵蓋 `browser.*`、`tabs.update`、`location`、表單，改用品牌型別與連結元件，加 lint 自我測試與打包路徑掃描。M1 要建立 ESLint 規則，規則寫錯，之後所有程式都建立在漏洞上。
2. **F-16、K-2**：確定 `productInfo` 只由 background 呼叫，列出完整的訊息清單。M1 的「popup 手動加入」就是第一個寫入訊息（`track`），「看得到現價」要決定由誰查價。
3. **K-1**：`Settings` 與 storage key 一覽。M1 的 storage 存取層與查價週期需要它。
4. **S-27**：M1 要確認 CSP 被 Chrome 接受，應該一次確認最終版本，而不是之後再改。
5. **F-21**：`minimum_chrome_version`；商品 API 的批次行為與 `%2C` 是 M1 查價的前提。
6. **K-4**：M1 的完成標準加上 lint 自我測試與 ID、URL、`intIn`、原型污染的測試。
7. **F-20**：zod `jitless` 的寫法與 pnpm 設定名稱（文字修正，幾分鐘）。

這 7 項改完就可以開始 M1。第八節第 8 項以後的修改，在各自標示的里程碑開工前完成即可。

---

## 附錄：本次沒有驗證的事

以下內容需要實際的 Chrome、WXT 專案或 DLsite 才能確認，本次只依文件、標準與既有知識判斷：

**Chrome 與 Web 平台**
- `onMessage` 監聽器回傳 Promise 當作回應是從哪個版本開始支援（文件型別有，版本沒寫）；service worker 冷啟動時 `badgeInfo` 的實際回覆時間。
- `MessageSender.url` 在 `pushState` 之後是否跟著改變；預先轉譯（prerender）頁面裡 content script 送訊息時的 `documentLifecycle`。
- 收緊的 CSP（`default-src`、`form-action`、路徑限定的 `connect-src`、`object-src 'none'`）是否被 Chrome 接受並生效。Chrome 文件只確認 `extension_pages` 也適用於 service worker、最低要求是 `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`。
- content script 的 fetch 是否出現在頁面的 Resource Timing；是否經過 DLsite 頁面自己的 service worker。
- 擴充功能請求是否帶 `Origin: chrome-extension://<id>`；`img.dlsite.jp` 的請求是否帶 `.dlsite.com` 網域的 cookie。
- `use_dynamic_url: true` 時 `runtime.getURL()` 回傳的網址能否載入資源（文件沒說）。
- 一次 `chrome.storage.local.set()` 寫入多個 key 是否不可分割。
- DLsite 頁面的 CSP 是否會擋 content script 插入 shadow root 的 `<style>`。
- `contextMenus` 的 `targetUrlPatterns` 對 `/=/` 路徑的實際比對。

**WXT 與套件**
- WXT 0.21 的 `createShadowRootUi` 是否有 `mode: 'closed'`（本輪在 API 文件頁找不到）；它載入 CSS 時是否自動加入 `web_accessible_resources`。
- WXT 能否正確打包 Web Worker。
- zod 4 `z.record()` 對 `"__proto__"` key 的實際行為（規格已要求 key 必須符合作品編號 regex，影響不大）。
- pnpm `minimumReleaseAge`、`trustPolicy`、`allowBuilds` 各自從哪個版本開始支援。
- §12.2 在實際瀏覽器的 Web Worker 裡、n = 15 的計算時間（本輪只在 Node.js 量過）。

**DLsite 與 DLWatcher**
- 商品 API 對不存在編號的回應方式、是否接受 `%2C`、回應最外層格式、`campaign_id` 沒有活動時的值。
- 未登入時優惠券 API 的回應；同一種券是否回傳多筆相同的 `coupon_id`。
- 優惠券管理頁（`/home/mypage/coupon/list`）在未登入時的轉址目標。
- 手機版（`touch`）作品頁的網址格式。
- DLWatcher 日期欄位的格式與時區；進行中的特價，`lowestPrice.priceInfo.end` 的值。

**本次已驗證（Node.js v24 實測、官方文件或原始碼）**
- §12.2 DP（含保留分數、`R`／`L` 分組、`uᵢ ≥ n` 放進 `R`）與暴力窮舉比對 600 組隨機案例，全部一致；§12.5 的邊界案例；§12.3 範例重建後得到 3 單、省 ¥1,716；C-29 的兩個同分取捨與 C-30 的捷徑反例；n = 12～15 的計算時間與記憶體。
- §5.5 的 6 個補年份測試、`parseJst` 的拒絕案例、台灣時區下的 1 小時誤差、`limit_date` 秒／毫秒；C-28 的 6 個月邊界案例。
- 通知狀態機（C-26、C-27）與 `priceLog` 連續查不到（C-31）的模擬。
- 規格中每個 regex 對 10 萬字惡意字串的時間；§6.2 regex 字面的 `SyntaxError`；`slice` 切斷代理字元；`URLSearchParams` 把逗號編碼成 `%2C`；`new URL()` 正規化 `..`。
- Chrome 文件：`MessageSender` 的 `documentId`／`documentLifecycle`（Chrome 106）、`origin`（Chrome 80）；`use_dynamic_url` 的作用；CSP 適用範圍與最低要求。WXT 0.21.5 文件：`createShadowRootUi` 以網路載入 CSS、`cssInjectionMode` 三種值。pnpm 文件：`minimumReleaseAge` 預設 1440 分鐘、`minimumReleaseAgeExclude`、`trustPolicy`、v11 以 `allowBuilds` 取代 `onlyBuiltDependencies`。zod 原始碼：`$ZodConfig.jitless` 與延遲計算的 `allowsEval`。
