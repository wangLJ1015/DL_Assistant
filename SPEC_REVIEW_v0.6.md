# SPEC.md v0.6 審查報告（第四輪）

> 審查對象：`SPEC.md` v0.6（2026-11-23，commit `198055b`）
> 審查日期：2026-11-23
> 審查方式：只讀規格書、前三輪報告（`SPEC_REVIEW.md`、`SPEC_REVIEW_v0.4.md`、`SPEC_REVIEW_v0.5.md`）與公開文件（Chrome Extensions 的 storage 與 CSP 文件、MDN `attachShadow`、W3C CSP3、WHATWG HTML、eslint-plugin-react 的文件與原始碼、pnpm 文件）。**沒有開啟或登入 DLsite，也沒有請求任何 DLsite 網址。** 試算 DP、通知的 9 個步驟、`priceLog`、日期規則、regex 時間、URL 正規化都用 Node.js v24.14 實際跑過（腳本放在暫存資料夾，不在專案內）。需要實際的 Chrome、WXT 專案或 DLsite 才能確認的地方標為「未驗證」，集中在附錄。
> 編號延續第三輪：安全從 S-32、正確性從 C-36、可行性從 F-22、完整性從 K-6 開始。

---

## 摘要

| 嚴重度 | 安全 | 正確性 | 可行性 | 完整性 | 合計 |
|---|---|---|---|---|---|
| 高 | 0 | 0 | 0 | 0 | **0** |
| 中 | 3 | 3 | 0 | 1 | **7** |
| 低 | 2 | 4 | 5 | 4 | **15** |
| 合計 | 5 | 7 | 5 | 5 | **22** |

第三輪 28 項：**25 項已修正、2 項部分修正、1 項修正後引入新問題**（F-18 的「每件作品寫入後立刻送通知」和 §6.1 第 8 步的「多件合併成一則」互相矛盾，見 C-38）。27 項修改清單都有對應的文字進入 v0.6。

本輪仍然沒有「高」。試算 DP（含「放進 `R` 的限次券也計成本」的新規則）和暴力窮舉比對 800 組隨機案例**全部一致**，§12.5 新增的 3 個案例結果都和規格相同；§5.5 的 7 個測試加上 5 個邊界案例全部通過；§6.1 列出的 4 個測試情境照 9 個步驟模擬全部通過；M3 的兩個 `priceLog` 完成標準也通過。`fetch` 已經沒有任何路徑打得到領券端點，擴充功能環境還多了 CSP 路徑限制這道防線。

**最重要的 5 項修正**

1. **`chrome.storage.local` 預設對 content script 開放**（S-34，中）。Chrome 文件寫明 `storage.local`「預設對 content script 開放」，只有 `storage.session` 預設不開放。所以 content script（以及打包進去的任何套件、被攻破的 DLsite 分頁程序）可以**直接讀寫** `coupons`、`items`、`settings`，完全繞過 §3.2.4 的訊息驗證與 §4.2「background 是唯一寫入者」。這和使用者最在意的「個人資料只在本機、頁面拿不到」直接相關。修正只要一行：background 啟動時呼叫 `chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })`。
2. **四層導覽防線只約束我們自己寫的程式碼，而且 JSX 與語法規則還有缺口**（S-32，中）。CSP 管不到導覽，擴充功能頁面與 background 裡的相依套件可以直接 `location.href =`／`chrome.tabs.create` 打開領券端點；規則也沒涵蓋 `<meta http-equiv="refresh">`（HTML 標準規定以程式插入時也會執行）、`navigation.navigate()`、裸的 `open()`、`jsx()` 直接呼叫、`as DlsiteNavUrl` 型別斷言。§3.4「四層防線保證」的說法要改成「降低機率」，並補進 §11 風險表。
3. **content script 改用原生 DOM 之後，沒有任何規則管 DOM 寫法**（S-33，中）。`react/forbid-*` 只管 JSX；content script 裡的 `el.src =`、`setAttribute('href', …)`、`style.cssText`、SVG `<use href>`、對 DLsite 既有連結呼叫 `.click()`，都會以登入狀態對 DLsite 發 GET，ESLint 與打包掃描都看不出來。
4. **§6.1 的三個狀態機漏洞**（C-36、C-37，中；模擬重現）：(a) 暫停後恢復，建立基準時沿用舊的 `episode.maxRate`，下一次查價誤發 `deeper`；(b) `isOnSale()` 公式沒看 `available`，查不到的作品在儀表板、試算、popup 仍顯示「打折中」；(c) 沒有活動編號也沒有截止日的作品，只要一次查不到，下一次查價就重發「特價＋史低」。
5. **「每件寫入就送通知」和「多件合併成一則」矛盾**（C-38，中）。照 §4.2 每件作品各送一則，就做不到 §6.1 第 8 步的合併；每件作品都重寫一次整個 `snapshots`／`ruleState`／`notified` 陣列，1,000 件時一輪要序列化數百 MB。改成「一批（最多 100 件）處理完一次寫入、一次送合併通知」。

**M1 準備度**：**可以開始 M1**，先做 3 項文字修正（S-32 的規則清單、S-34 的 `setAccessLevel`、F-23 的 lint 可行性），約 30 分鐘。其他問題都在 M2 以後。**不建議再做一輪完整的規格審查**（見第九節）：發現數 33 → 31 → 28 → 22，高嚴重度 4 → 1 → 0 → 0，本輪的中嚴重度大多是縱深防禦與 M4 的邊界情況，接下來用實作與 §10.3 的實測來驗證，效益比再讀一次規格高。

---

## 一、實測摘要

| 項目 | 結果 |
|---|---|
| §12.2 DP vs 暴力窮舉 | 800 組隨機案例（1～6 件、0～4 張券；折扣率、定額、`payment`、一次性、`usage` 限次（含 `uᵢ ≥ n` 放進 `R`）、完全相同的券、金額門檻、件數門檻、`maxItemPrice`、`appliesToDiscounted` 三種值、`noReduction`），**800／800 一致** |
| §12.5 既有案例 | 4 件配 1 張 30% → 省 ¥1,080、1 單；A＋一次性 X → 省 ¥200、1 單、X 留著；`payment` ¥400 滿 ¥1,200 → ¥400；可重複使用定額 ¥400 配 ¥300×2 → 分兩單省 ¥600 |
| §12.5 新增 3 案例 | A 與限次券 Z 同折扣：`[A, Z]`、`[Z, A]` 兩種順序都用 A（保留分數 0）✅；Y／X1／X2：選 X1＋X2、2 單、成本 8 ✅；同分（p1 適用 A、B，p2 只適用 B，p3 只適用 C）→ 2 單 ✅ |
| §12.3 範例 | 依第三輪的重建價格：DP 省 ¥1,716、**3 單**、實付 ¥6,434；只用 A ¥7,094（折 ¥1,056），只用 B 或 C 各折 ¥330；全部和規格一致 |
| §12.2 `k′ > 8` 截斷 | 反例：8 張 5% 一次性券（各只適用 1 件、1 天後到期）＋1 張 50% 一次性券（全部適用、20 天後到期）。不截斷省 ¥4,500；只保留最快到期的 8 張只省 ¥400（C-39） |
| §6.1 的 4 個測試 | 全部通過：加入時已打折 → 兩次查價無通知，結束再開始才通知；c1 ¥1,000 → c2 ¥800 兩次都是「特價＋史低」；`deeper` 20 → 30 → 30 只發一次；已結束的快取資料不發 `sale` |
| §6.1 額外情境 | 暫停 → 恢復：恢復後第二次查價誤發 `deeper`（C-36）；查不到時 `isOnSale(snapshot)` 回傳 true（C-37）；沒有 `campaignId`／`discountEnd` 時，一次查不到後重發「特價＋史低」（C-37）；目標價在打折中調高 → 下一次查價發 `target`；`ending` 在剩 22 小時那次發一次；三條規則都關閉時 `ending` 不發 |
| §5.3 `priceLog` | 「可買 → 查不到 ×3 → 可買（同價）」3 筆 ✅；「關瀏覽器 3 天、前後同價」2 筆 ✅；第一次查價就查不到時，價格欄位沒有「上一筆」可沿用（C-42 f） |
| §5.5 日期 | 規格 7 個測試全部通過；邊界：剛好 7 天前 → 已結束、7 天又 1 分鐘 → 不明、180 天後 → 有效、181 天後 → 不明；`02-30`、`24:00`、`23:59:60` 都拒絕；`TZ=Asia/Taipei` 下 `parseJst` 得 `14:59:59Z`，直接 `new Date()` 得 `15:59:59Z`；`limit_date` 秒／毫秒正確 |
| ReDoS | 規格裡 14 個 regex 對 10 萬字惡意字串（不經截斷），最慢 3.9 ms（通知清理對 10 萬個 U+202E）；全部安全 |
| §6.2 清理 regex | v0.6 的檔案裡已經是 `\u2028\u2029` 跳脫寫法（`SPEC.md` 沒有任何 U+2028 位元組），可以直接貼上執行；`Array.from` 截斷不留下單獨的代理字元。小問題：`\n`、`\t` 屬於 `Cc`，會先被刪掉而不是變成空白，`作品名\n第2巻` 會變成 `作品名第2巻`（C-42 a） |
| URL 正規化（`assertAllowed`） | `…/list/ajax/../../` → `/home/mypage/coupon/`（被完全比對擋下）；`%2F..` 不解碼；大寫網域會正規化；`www.dlsite.com.`（結尾有點）的 `origin` 不同而被擋；`:443` 會被去掉。完全比對的設計沒有漏洞 |

---

## 二、第三輪修正驗證

狀態說明：✅ 已修正　◐ 部分修正（還有缺口）　⚠️ 修正後引入新問題

### 2.1 第三輪 28 項發現

| 編號 | 狀態 | 說明 |
|---|---|---|
| S-25 | ◐ | 型別、元件、語法規則、打包掃描、規則自我測試五件事都已寫入 §3.4，打包掃描的 `(?!\/list\/ajax)` 比第三輪建議的更精確。缺口：只約束自己的原始碼，沒涵蓋 `<meta http-equiv=refresh>`、`navigation.navigate()`、`jsx()`、型別斷言；`react/forbid-dom-props` 看不到 `{...props}` 展開（S-32、F-23） |
| S-26 | ✅ | content script 不用 React／Tailwind／Chart.js、import 白名單、打包套件差異檢查、§11 風險都已寫入。新的缺口是原生 DOM 沒有寫法規則（S-33）與 `storage.local` 的存取層級（S-34），不屬於 S-26 原本的範圍 |
| S-27 | ✅ | CSP 一字不差採用；§10.3 改成確認整條。補充：沒有 `worker-src` 時依 CSP3 退回 `script-src 'self'`，Web Worker 不受影響；`<link rel=prefetch>` 由 `default-src` 管，也被擋 |
| S-28 | ✅ | 編號只在載入時決定、固定大小外框、`track` 標 `source: 'page'`／`autoAdded: true`、`showBadge`、`badgeInfo` 同一文件只回一次。「只回一次」的狀態存在哪裡沒寫（K-6） |
| S-29 | ✅ | DLsite 與頁面腳本能知道的事、`reportInput` 禁用、Resource Timing 進 §10.3 |
| S-30 | ✅ | `pendingManual` 是唯一的「略過 6 小時」來源，綁 `tabId`、1 分鐘過期、用過作廢；content script 無法自己要求略過。缺少冷卻時間（S-35） |
| S-31 | ✅ | 刪掉優惠券管理頁常數，改用文字說明 |
| C-26 | ✅ | 第 6 步建立基準時寫入 `episode` 與 `RuleState`；模擬「加入時已打折」兩次查價都沒有通知 |
| C-27 | ✅ | 改寫成 9 個步驟，新的一段優惠重設 `sale`／`lowest`／`ending`，`deeper` 先比後更新；模擬 c1 → c2 兩次都發「特價＋史低」。暫停恢復的情況有漏洞（C-36） |
| C-28 | ◐ | `isOnSale()` 統一定義、7 天規則、新測試都已寫入，測試通過。但公式沒看 `available`，和第 1 步「查不到時 `onSale` 為 false」不一致（C-37） |
| C-29 | ✅ | 放進 `R` 的限次券計成本；§12.1 目標 3 改寫；§12.5 加兩個案例。實測兩種陣列順序都選 A |
| C-30 | ✅ | 刪除捷徑，所有情況都跑 DP |
| C-31 | ✅ | 三個新增條件與「連續查不到只更新同一筆」已寫入，M3 兩個標準實測通過 |
| C-32 | ✅ | 新增「全部解析失敗 → 保留、`unreadable`」一列，`lastResult` 也加了 `unreadable`。小問題：`JSON.parse` 失敗那列寫「無法讀取」，沒說對應 `lastResult` 的哪個值（K-6） |
| C-33 | ✅ | `lowest.price ≤ max(regularPrice, 見過的最大 officialPrice)`、`end ≤ 現在 + 400 天`、「接近」＝ 5% 以內 |
| C-34 | ✅ | 跳脫寫法、`Array.from` 截斷、ZWJ 說明都已寫入，實測可執行。小問題見 C-42 a |
| C-35 | ✅ | a 價格 regex 已刪；b 匯入改成「只對本機沒有紀錄的作品」；c `isCanonicalIso()` 放進 `lib/dates.ts`；d 否定詞要緊接「割引中の作品（に／には／は）」後 3 字內（實測「…にも適用出来ます。※一部対象外…」判成 true）；e 改用 `E(c, {p})`；f `dlwatcherLastRequest` 存 `storage.local` |
| F-16 | ✅ | `productInfo`、`dlwatcher` 只由 background 呼叫，環境檢查改成 `ServiceWorkerGlobalScope`，擴充功能頁面改送 `lookup`／`recheck` |
| F-17 | ✅ | `return true`＋`sendResponse()`、`lastError` 與失效處理 |
| F-18 | ⚠️ | 同步鎖排隊 ✅。但「每件作品寫入後才 `notifications.create`」和 §6.1 第 8 步「多件作品合併成一則」矛盾，每件都重寫整個陣列也有效能問題（C-38） |
| F-19 | ✅ | 自己 `attachShadow({ mode: 'closed' })`、inline `<style>`、不用 `createShadowRootUi`、不宣告 `web_accessible_resources`；§10.3 M6 確認 DLsite CSP。宿主元素的限制沒寫（F-24） |
| F-20 | ✅ | `zod-setup.ts`；pnpm 11 設定名稱（文件確認：`allowBuilds` 是 map、v11 取代 `onlyBuiltDependencies`；`strictDepBuilds` 預設 true；`trustPolicy` 值為 `no-downgrade`／`off`）。補充見 F-26 |
| F-21 | ✅ | `minimum_chrome_version: "120"`、商品 API 壞編號與 `%2C` 進 §10.3、§4.1 拆半重試 |
| K-1 | ✅ | `Settings` 與 storage key 一覽表都已寫入。缺幾個狀態（K-6） |
| K-2 | ✅ | 完整訊息清單、`syncNow`、`?n=`。缺訊息的回覆形狀與 `couponSyncResult.result` 的 schema（K-6） |
| K-3 | ✅ | a～h 全部處理（暫停語意、`episodeKey`、`saleCount` 與 `affectsPayment` 用途、`available`、清理、匯入覆蓋與初始值、`lookupCache` 形狀） |
| K-4 | ✅ | 通則與各里程碑的具體標準。仍可補幾項（K-8） |
| K-5 | ✅ | 列出的 12 項都進了 §10.2／§10.3（優惠券管理頁那項因常數已刪而不需要） |

### 2.2 第三輪 27 項修改清單

| 順序 | 內容 | 狀態 |
|---|---|---|
| 1 | 導覽四層防線＋lint 自我測試 | ◐（S-32、F-23） |
| 2 | 只限 background、完整訊息清單 | ✅（回覆形狀見 K-6） |
| 3 | `Settings` 與 storage key 一覽 | ✅（缺項見 K-6） |
| 4 | CSP | ✅ |
| 5 | `minimum_chrome_version`、商品 API 批次 | ✅ |
| 6 | §9 通則與 M1 標準 | ✅ |
| 7 | zod `jitless`、pnpm 設定 | ✅ |
| 8 | content script 最小化 | ✅（另見 S-33、S-34） |
| 9 | `return true`、`lastError` | ✅ |
| 10 | `priceLog` 新增條件 | ✅ |
| 11 | DLWatcher 合理性檢查 | ✅ |
| 12 | §6.1 九個步驟 | ✅（暫停恢復見 C-36） |
| 13 | 補年份 7 天規則 | ✅（副作用見 C-37 第 3 點） |
| 14 | 寫入與送通知的先後；同步鎖排隊 | ⚠️（C-38） |
| 15 | 通知清理 regex | ✅ |
| 16 | 徽章編號、固定大小、`track` 來源、可關閉 | ✅ |
| 17 | WXT CSS 改 inline `<style>` | ✅（F-24） |
| 18 | 隱私說明、`reportInput` | ✅ |
| 19 | 全部解析失敗時保留 | ✅ |
| 20 | `pendingManual` | ✅（S-35） |
| 21 | 刪優惠券管理頁常數 | ✅ |
| 22 | 刪捷徑 | ✅ |
| 23 | 限次券計成本、§12.1 文字、兩個測試 | ✅ |
| 24 | 資料欄位 a～h | ✅ |
| 25 | 小型解析問題 a～f | ✅ |
| 26 | §10.2／§10.3 補項 | ✅ |
| 27 | 匯入與同步排程的簡化 | ✅ |

### 2.3 第一、二輪重點項目抽查

| 編號 | 狀態 | 說明 |
|---|---|---|
| S-1 | ✅ | `htmlToText()`（`DOMParser`、移除 `script` 等、只取文字、截斷 2,000 字）、禁止清單與 ESLint 都還在 |
| S-3 | ✅ | 端點表、`assertAllowed` 完全比對、行為測試清單（含 `/home/mypage/coupon/list`）都還在；本輪重測 6 種 URL 寫法，沒有繞過方式 |
| S-6 | ✅ | `isWorkId()` 與網址 regex 不變 |
| S-9 | ✅ | `externally_connectable` 鎖定，`(chrome|browser).runtime.onMessageExternal` 全面禁止 |
| S-13 | ◐ | 演進成第三輪 S-25，本輪的剩餘缺口在 S-32 |
| C-1 | ✅ | `g` 只用 `R`；DP 與暴力窮舉一致 |
| C-5 | ✅ | `Math.floor(price * pct / 100)` 的寫法與測試仍在 |
| C-6 | ✅ | 禁止單一參數的 `new Date()`；台灣時區 1 小時誤差重測仍成立 |
| C-13 | ✅ | 保留分數只算限次券；「1 張可重複使用券配 4 件 → 1 單」重測通過 |
| C-16 | ✅ | 三個候選取最接近，再加 7 天／180 天的邊界，全部測試通過 |
| C-20 | ✅ | `priceLog` 的空白與 `unavailable` 規則完整，M3 兩個標準通過 |
| C-24 | ✅ | `[]` 且本機有券時保留並標示 `empty` |

---

## 三、注入與攻擊面總覽（第四次盤點）

### 3.1 外部資料進入程式的入口

| 入口 | 攻擊者 | v0.6 的防線 | 評估 |
|---|---|---|---|
| `condition_info` HTML | 券的填寫者 | `htmlToText()` | 足夠 |
| `conditionText` → `appliesToDiscounted` | 券的填寫者 | 先否定後肯定、緊接規則 | 足夠（實測 6 種句子） |
| 作品名稱、券名 → React | API、合作網站 | 預設跳脫 | 足夠 |
| 作品名稱、券名 → 原生 DOM 徽章 | API | `textContent` | 規則有寫，但沒有 lint 強制（S-33） |
| 作品名稱、券名 → 系統通知 | API、合作網站 | 清除 `Cc`／`Cf`、截斷 60 字 | 足夠（C-42 a 是顯示問題） |
| 圖片網址 | API | 補 `https:`、比對 `origin` | 足夠 |
| 商品 API 的 key、數字、字串 | DLsite | `Object.entries`、`isWorkId`、請求編號、`intIn` | 足夠 |
| DLWatcher 整份資料 | DLWatcher、網域新持有者 | zod、合理性檢查、保留舊資料、7 天自動暫停 | 足夠 |
| 優惠券 API 回應 | DLsite | 1 MB、`text()`＋`JSON.parse`、逐筆 zod、token、background 再驗一次 | 足夠；`result` 的 schema 要寫（K-6） |
| 購物車頁 DOM、加入購物車按鈕 | 頁面腳本 | 選擇器、`isTrusted`、每日 200 | 足夠 |
| 作品頁網址 | 頁面腳本 | 載入時決定一次 | 足夠 |
| `contextMenus` 的 `linkUrl` | 任何連結 | `new URL`＋host＋路徑 regex | 足夠 |
| `lookup.html?id=` | 只有擴充功能能開 | 兩次 `isWorkId`、`getAll().length === 1` | 足夠 |
| `dashboard.html?n=` | 只有擴充功能能開 | 必須是 `recentNotifications` 裡的 ID | 足夠；比照 `lookup.html` 要求 `getAll('n').length === 1`（S-36） |
| `runtime.onMessage`（content script） | 被操控或被攻破的 content script | 來源檢查、白名單、zod、部分數量上限 | `track`、`openPage`、`badgeInfo` 沒有上限（S-35） |
| `runtime.onMessage`（擴充功能頁面） | 擴充功能頁面裡的相依套件 | `EXT_ORIGIN`、`sender.url` | `setSettings` 能改不該改的欄位；`recheck`、`syncCouponsNow` 沒有冷卻（S-35、S-36） |
| content script 的 `onMessage` | 無（網頁不能送） | `sender.id`＋沒有 `sender.tab`，只認 `syncNow` | 足夠 |
| **`chrome.storage.local`** | **content script 與它的相依套件、被攻破的分頁程序** | **沒有** | **預設對 content script 開放，可直接讀寫（S-34）** |
| 匯入 JSON | 網路上流傳的檔案 | 5 MB、strict、陣列、`isCanonicalIso`、只匯入沒有紀錄的作品 | 足夠；預覽暫存見 F-22 |
| 建置相依套件 | 被入侵的 npm 套件 | lockfile、`allowBuilds`、`minimumReleaseAge`、`trustPolicy`、打包掃描 | 只約束 content script 的套件清單，擴充功能頁面的套件仍能導覽（S-32） |

### 3.2 所有對外請求、導覽與資源載入

| 出口 | 帶 cookie？ | 誰能觸發 | 防線 | 評估 |
|---|---|---|---|---|
| `productInfo`、`dlwatcher` fetch | 否 | 只有 background | `apiGet`、環境檢查、CSP 路徑 | 足夠 |
| `couponList` fetch | **是** | 只有 content script | `apiGet`、`same-origin`、`manual`、環境檢查 | 自己的程式足夠；沒有 CSP 防線，相依套件靠最小化（已知） |
| 擴充功能頁面的 `<img>`、CSS、字型、prefetch、`<iframe>`、`<object>`、表單 | — | 擴充功能頁面 | CSP（`img-src`、`default-src`、`frame-src`、`object-src`、`form-action`） | 足夠（M1 實測） |
| 擴充功能頁面的導覽（`<a>`、`location`、`window.open`、`<meta refresh>`、`navigation.navigate()`） | **是** | 自己的程式與**相依套件** | 四層規則（只管自己的程式） | 規則有缺口；相依套件完全不受限（S-32） |
| `chrome.tabs`／`chrome.windows`（background 與擴充功能頁面） | **是** | 自己的程式與相依套件 | 語法規則、品牌型別 | 同上（不需要 `tabs` 權限就能 `tabs.create`） |
| 通知點擊 | **是** | background | `buildWorkUrl` | 足夠 |
| content script 建立的 DOM（`img`、`link`、SVG `use`、`style` 的 `url()`、`.click()` 既有連結） | **是**（同站） | content script | §3.2.5 文字規則 | 沒有 lint 強制（S-33） |
| 右鍵選單 | 不發請求 | — | 不 fetch `linkUrl` | 足夠 |

### 3.3 會改變帳號狀態的 GET（`/home/mypage/coupon`）

| 路徑 | 是否擋得住 | 說明 |
|---|---|---|
| `fetch`／XHR／beacon（擴充功能頁面、background） | ✅✅ | `apiGet` 完全比對＋CSP `connect-src` 路徑，兩道 |
| `fetch`（content script，自己的程式） | ✅ | `apiGet` 完全比對＋行為測試 |
| 被轉址 | ✅ | `couponList` 是 `manual`，其他是 `error` |
| 導覽（自己的程式） | ◐ | 四層規則；缺 `meta refresh`、`navigation.navigate()`、`open()`、`jsx()`、型別斷言（S-32） |
| 導覽（相依套件） | ✗ | CSP 管不到導覽，ESLint 不掃 `node_modules`；打包掃描只能抓到完整的字串（S-32） |
| content script 的 DOM 資源與點擊 | ◐ | 只有文字規則（S-33） |
| content script 的相依套件發 fetch | ◐ | 最小化＋套件差異檢查（已知限制） |
| 打包結果 | ◐ | 掃描 `mypage/coupon(?!/list/ajax)`；字串拼接（`'mypage/' + 'coupon'`）掃不到 |

結論：**擴充功能自己的程式**已經沒有已知路徑打到領券端點；剩下的風險都來自「相依套件被植入惡意版本」或「之後有人寫了規則沒涵蓋的寫法」。前者只能降低機率，要在規格裡承認（S-32）。

### 3.4 ReDoS 實測

每個 regex 直接對 10 萬字惡意字串跑 3 次取平均（不經截斷），Node.js v24.14：

| Regex | 位置 | 最慢 | 結果 |
|---|---|---|---|
| `^(RJ\|RE\|BJ\|VJ)(\d{6}\|\d{8})$` | §3.2.2 | 0.11 ms | 安全 |
| 作品網址路徑（含 `(-touch)?` 版） | §3.2.2 | 0.25 ms | 安全 |
| `^\d+$`（`intIn`） | §3.2.3 | 0.29 ms | 安全 |
| `^/product/(RJ\|RE\|BJ\|VJ)(\d{6}\|\d{8})\.json$` | §3.4 | 0.02 ms | 安全 |
| `/mypage\/coupon(?!\/list\/ajax)/`、`/home/buy`（打包掃描） | §3.4、§7.2 | 0.18 ms | 安全 |
| `isCanonicalIso` | §3.7 | 0.01 ms | 安全 |
| `parseJst`、`discount_end_date` | §5.5 | 0.01 ms | 安全 |
| `[\p{Cc}\p{Cf}\u2028\u2029]`（全域） | §6.2 | 3.91 ms | 安全 |
| `\s+`（全域） | §6.2 | 0.33 ms | 安全 |
| `appliesToDiscounted` 否定（推定寫法 `割引中の作品(?:には\|に\|は)?.{0,3}(?:…)`） | §5.3 | 0.30 ms | 安全 |
| `appliesToDiscounted` 肯定 | §5.3 | 0.22 ms | 安全 |

補充：zod 4 的 `.max(9)` 失敗後預設仍會繼續跑後面的 `.regex()`（沒有設 `abort` 時），但 `^\d+$` 是線性的，加上回應有大小上限，沒有影響。

---

## 四、新發現：安全

### S-32　四層導覽防線只約束自己的原始碼，而且規則清單還有缺口（中）

- **章節**：§3.4「導覽與資源載入」、§11
- **問題**：
  1. **相依套件不受任何一層約束。** 第 1～3 層是型別與 ESLint，只檢查我們寫的檔案；第 4 層打包掃描只抓得到完整出現的字串。CSP 不管導覽（`navigate-to` 已從標準移除），而 `chrome.tabs.create` 不需要 `tabs` 權限。所以擴充功能頁面或 background 打包進去的任何套件（React、Chart.js、`idb`、date-fns 與它們的相依套件），只要有一個被植入惡意版本，就能用 `location.href = 'https://www.dlsite.com/home/mypage/' + 'coupon'` 或 `chrome.tabs.create(...)` 以登入狀態打開領券端點。§3.4 寫「這條規則用四層防線保證」，說法過強；§11 的風險表只列了 content script 的相依套件。
  2. **自己的程式還有這些寫法沒擋到**：
     - `<meta httpEquiv="refresh" content="0;url=…">`：HTML 標準規定 meta 元素「被插入文件時」就執行 pragma，不限於解析時。React 19 還會把 `<meta>` 提升到 `<head>`。CSP 擋不住。
     - `navigation.navigate(url)`（Navigation API，Chrome 102 起）、裸的 `open(url)`、`document.location = …`、`top.location.href = …`、`self.clients.openWindow(url)`。
     - 從 `react/jsx-runtime` 直接呼叫 `jsx('a', { href })`：`react/forbid-elements` 的原始碼只認得 JSX 與 `React.createElement`（含從 React 解構的 `createElement`），不認得 `jsx()`。
     - `'https://…' as DlsiteNavUrl`：品牌型別擋不住型別斷言。
     - 別名：`const { tabs } = browser; tabs.create(...)`、`const t = chrome.tabs`。`no-restricted-syntax` 只看得到形狀。
- **情境**：某個圖表套件的子相依套件發佈惡意版本，在 `location.protocol === 'chrome-extension:'` 時執行 `chrome.tabs.create({ url: atob('aHR0cHM6Ly93d3cuZGxzaXRlLmNvbS9ob21lL215cGFnZS9jb3Vwb24=') })`。四層規則都沒有反應：程式不在 `src/`，打包結果裡只有 base64 字串。
- **建議修正**（取代 §3.4「這條規則用四層防線保證」那段的開頭與第 2、3 點，並補進 §11）：
  > - 這條規則用四層防線**降低機率**。四層都只檢查我們自己的原始碼與打包結果裡完整出現的字串；CSP 管不到導覽，所以**相依套件被植入惡意版本時仍能導覽到任何網址**（§11）。
  > 2. **元件**：…ESLint 用 `react/forbid-elements` 禁止 `<a>`、`<area>`、`<form>`、`<meta>`、`<link>`、`<base>`、`<iframe>`、`<object>`、`<embed>`；用 `react/forbid-dom-props` 禁止 `href`、`action`、`formAction`、`httpEquiv`、`xlinkHref`、`ping`；用 `react/jsx-props-no-spreading`（`html: 'enforce'`、`custom: 'ignore'`）禁止在 DOM 元素上展開 props；用 `no-restricted-imports` 禁止 import `react/jsx-runtime`、`react/jsx-dev-runtime`。只有 `WorkLink.tsx`、`NavLink.tsx` 例外。
  > 3. **語法規則**（`nav.ts` 例外）：除了原本的清單，再加上 `navigation.navigate`、`clients.openWindow`、`document.location`／`top.location`／`self.location`／`globalThis.location` 的指派與 `assign`／`replace`；`no-restricted-globals` 禁止裸的 `open`、`location`、`navigation`；禁止把 `chrome.tabs`、`chrome.windows`、`browser.tabs`、`browser.windows` 指派給變數或解構（`VariableDeclarator[init.property.name=/^(tabs|windows)$/]`）；禁止 `TSAsExpression`／`TSTypeAssertion` 轉成 `DlsiteNavUrl` 或 `ExtPageUrl`。
  > - `tests/lint-fixtures/` 對上面每一種寫法各放一個檔案。
  >
  > §11 風險表新增一列：
  > | 擴充功能頁面或 background 的相依套件被入侵 | 導覽不受 CSP 約束，惡意程式能以登入狀態開啟領券等帳號網址 | §7.2 供應鏈規則（lockfile、`minimumReleaseAge`、`trustPolicy`）；擴充功能頁面的相依套件維持最少（React、Chart.js、`idb`、zod），新增執行期相依套件要改規格；打包掃描。第二階段評估用 `declarativeNetRequest` 擋下擴充功能發起的 `/home/mypage/coupon` 導覽（§10.3） |

### S-33　content script 的原生 DOM 沒有任何寫法規則（中）

- **章節**：§3.2.5、§3.2.2、§3.4 第 3 層
- **問題**：v0.6 讓 content script 改用 `createElement`＋`textContent`，方向正確，但 `react/forbid-*` 只管 JSX，§3.4 第 3 層只禁止 `createElement('a'|'form'|'area')`。content script 在 DLsite 頁面的文件裡，以下寫法都會以登入狀態對 DLsite 發 GET，而 §7.1 的 CSP 不管 content script：
  - `img.src = …`、`el.setAttribute('src'|'href'|'srcset'|'poster'|'data'|'xlink:href', …)`、`createElement('img'|'link'|'script'|'iframe'|'video'|'audio'|'source'|'object'|'embed'|'meta'|'base')`。
  - 徽章的 inline SVG 圖示若用 `createElementNS` 建 `<use href>`、`<image href>`、`<feImage>`，會載入外部資源。
  - `el.style.cssText = …`、`style.setProperty('background', 'url(…)')`，或注入的 `<style>` 字串裡出現 `url(`／`@import`。
  - **對 DLsite 頁面既有的元素呼叫 `.click()`、`.submit()`、`.requestSubmit()`**：例如 `document.querySelector('a[href*="coupon"]').click()`。這不需要建立任何元素，規則完全看不出來。
  - `el.innerHTML = ''` 這種「清空」寫法會讓 `no-unsanitized` 的例外清單變寬；應統一用 `replaceChildren()`。
- **情境**：之後有人為了顯示作品縮圖，在徽章裡加 `img.src = snapshot.imageUrl`。`imageUrl` 通過了 `img.dlsite.jp` 檢查，看起來安全；但下一次有人把它改成「點了開作品頁」而寫 `a.click()`……規則都不會報錯。
- **建議修正**（新增到 §3.2.5「content script 只放最少的程式碼」底下）：
  > - content script 的 DOM 寫法另有 ESLint 規則（只套用在 `dlsite.content.ts` 與它 import 的 UI 檔案）：
  >   - `document.createElement` 只能用 `div`、`span`、`button`、`style`；`createElementNS` 只能用 SVG 的 `svg`、`path`、`circle`、`rect`、`g`。
  >   - 禁止 `setAttribute` 的第一個參數是 `src`、`href`、`srcset`、`poster`、`data`、`action`、`formaction`、`ping`、`xlink:href`、`style` 或 `on` 開頭；禁止對 `src`、`href`、`srcset`、`action`、`cssText`、`innerHTML`、`outerHTML` 屬性指派；禁止 `style.setProperty`。清空元素用 `replaceChildren()`。
  >   - 禁止呼叫 `.click()`、`.submit()`、`.requestSubmit()`、`.dispatchEvent()`、`.focus()`（不操作 DLsite 頁面既有的元素；只讀選擇器取到的元素的 `textContent` 與 `href` 字串）。
  >   - 注入的樣式字串定義在 `lib/badge-style.ts` 的單一常數，`check-manifest` 確認這段字串不含 `url(`、`@import`、`image-set(`。
  > - `tests/lint-fixtures/content/` 放上面每一種寫法的範例。

### S-34　`chrome.storage.local` 預設對 content script 開放，可以繞過訊息驗證直接讀寫（中）

- **章節**：§3.2.4、§3.2.5、§3.3、§3.5、§4.2、§5.3
- **問題**：Chrome 的 storage 文件寫明：`storage.local`「預設對 content script 開放」，可以用 `setAccessLevel()` 改變；`storage.session` 預設只開放給受信任的環境（擴充功能頁面與 service worker）。規格只對 `storage.session` 寫了「content script 讀不到」（§3.5），卻把 `coupons`、`items`、`settings`、`snapshots`、`recentNotifications` 都放在 `storage.local`。結果：
  1. **單一寫入者是假的**：content script 不用送訊息，直接 `chrome.storage.local.set({ coupons: [...] })` 就能塞假券、改 `settings.dlwatcherEnabled`、改 `reservedCouponKeys`、把 1,000 件作品寫進 `items`。§3.2.4 對 content script 的所有驗證、數量上限、token 都被繞過。
  2. **隱私**：§3.2.5 的原則是「頁面 DOM 裡只放公開資訊，優惠券、追蹤清單只在擴充功能自己的頁面顯示」。但 content script 的環境（也就是 DLsite 分頁的程序）可以讀到全部的券、追蹤清單與通知內容。
  3. 能利用這一點的是：content script 自己的 bug、打包進 content script 的相依套件（S-26 的威脅）、被攻破的 DLsite 分頁程序。
- **情境**：content script 裡的 zod（白名單內）某個子相依套件被植入惡意版本，執行 `chrome.storage.local.get(null)` 讀出所有券與追蹤清單，再用同源的 `fetch` 送到 DLsite 上任何能記錄請求的地方（content script 的請求不受擴充功能 CSP 約束）；或寫入一張「¥100,000 定額、可重複使用」的假券，讓試算給出錯誤建議。
- **建議修正**：
  > §4.2 新增一點：
  > - background 在最上層（每次 service worker 啟動）與 `runtime.onInstalled` 都呼叫 `chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })`，讓 content script 完全不能讀寫 `storage.local`。content script 需要的資料一律由 background 回覆（`badgeInfo`、`lookup`），本來就沒有直接讀 storage 的需求。
  > - content script 的 ESLint 禁止 `chrome.storage`、`browser.storage` 與 `wxt/storage`；打包掃描確認 content script 打包檔不含 `storage.local`。
  > - background 從 storage 讀回的資料一律再跑 zod（§3.2.3 已要求放進 `Map`，這裡補上「也要驗證」）。
  >
  > §10.3 新增（M1）：「`storage.local.setAccessLevel` 在 Chrome 120 可用，設定後 content script 呼叫 `chrome.storage.local.get` 會失敗；設定是否在瀏覽器重開後保留（不論結果都每次啟動重設）。」
  > 若 M1 發現 Chrome 120 的 `storage.local` 不支援 `setAccessLevel`：把 `minimum_chrome_version` 提高到支援的版本，或把 `coupons`、`items`、`settings` 改存擴充功能來源的 IndexedDB（content script 存取不到）。
  >
  > §3.3 補一句：「content script 讀不到任何擴充功能的儲存資料（§4.2）。」

### S-35　部分訊息缺少頻率或次數上限（低）

- **章節**：§3.2.4、F14、§3.6
- **問題**：
  1. content script 送的 `track {id}` 沒有任何上限（`cartClicked`／`cartSnapshot` 有每日 200）。被操控的 content script 可以一次加 1,000 件，把清單塞滿、觸發 1,000 次 DLWatcher 請求。`openPage` 沒有上限，可以連續開幾十個 `lookup.html` 視窗。`badgeInfo` 只限「同一份文件一次」，被攻破的分頁程序可以換文件逐一列舉追蹤清單。
  2. `syncCouponsNow` 沒有冷卻：連按「立即同步」每次都會略過 6 小時檢查，對優惠券 API 發一次帶 cookie 的請求。
  3. `recheck {ids}` 沒有冷卻，也沒限制 `ids` 必須是追蹤中的作品。帶未追蹤的編號，等於繞過 `lookup` 的每分鐘 10 次。
- **建議修正**（補進 §3.2.4「數量上限」）：
  > - content script 的 `track` 計入每日自動新增 200 件的上限，同一個 `documentId` 只接受一次；`openPage` 每分鐘最多 5 次；`badgeInfo` 每個分頁每分鐘最多 30 次。
  > - `syncCouponsNow`：距離上次「立即同步」不到 1 分鐘，或 `pendingManual` 還沒過期時，直接回覆「同步進行中」。
  > - `recheck`：`ids` 必須都在追蹤清單裡；同一件作品 10 分鐘內只重新查價一次；放進 §4.1 的 `productInfo` 佇列執行（照樣套用間隔與退避），不另開請求。

### S-36　`setSettings` 的範圍與幾個小型驗證（低）

- **章節**：§3.2.4、§5.3 `Settings`、F6
- **問題與建議**：

| # | 問題 | 建議 |
|---|---|---|
| a | `setSettings {partial}` 是 `Settings` 的部分欄位，包含 `dlwatcherAutoPausedAt`（應該只由 background 與 `resumeDlwatcher` 改）與 `reservedCouponKeys`（已有 `setCouponReserved`） | `setSettings` 的 schema 是 `.strict()`，只列使用者可編輯的欄位：`checkIntervalHours`（1～24 的整數）、`dlwatcherEnabled`、`usePointPaymentMethod`、`treatUnknownDiscountedAsUsable`、`hideTitlesInNotifications`、`showBadge`、`rules`（6 個布林，也是 strict）。改 `checkIntervalHours` 時重建 alarm |
| b | `dashboard.html?n=` 沒有比照 `lookup.html` 要求參數只出現一次 | 要求 `searchParams.getAll('n').length === 1`，而且長度 ≤ 64 |
| c | `setTarget {id, price?}` 的範圍沒寫 | `price` 用 `intIn(0, 1_000_000)`；`id` 必須在追蹤清單裡 |
| d | `setCouponReserved {key}` 沒限制 key 必須存在 | `key` 必須是目前 `coupons` 裡的 key，長度 ≤ 300 |

---

## 五、新發現：正確性

### C-36　暫停後恢復時沿用舊的 `episode.maxRate`，下一次查價誤發 `deeper`（中）

- **章節**：§6.1 第 3、6、7 步，§5.3 `TrackedItem.paused`
- **問題**：暫停的作品不查價，`PriceSnapshot` 保留暫停前的 `episode`。恢復時清掉 `baselineAt`，下一次查價走第 6 步：第 3 步判斷活動編號沒變，**沿用舊的 `episode`**（`maxRate` 是暫停前的值），第 6 步寫入後直接跳到第 9 步，**跳過了第 7 步最後的 `maxRate` 更新**。再下一次查價，`discountRate > episode.maxRate` 成立，發出 `deeper`，但折扣率從恢復以後根本沒變。
- **情境**（模擬）：同一檔活動 c1，暫停前 20%，暫停 5 天期間加深到 50%。恢復後第一次查價：沒有通知（基準）。第二次查價：50%、沒有任何變化，卻跳出「DL_Assistant：折扣加深」。違反「建立基準後只依狀態轉換通知」。
- **相關**：恢復時如果現價已經 ≤ 目標價，`target` 會被當成基準而永遠不通知。這是設計選擇，但規格沒寫，使用者可能以為「暫停期間降到目標價，恢復後會提醒」。
- **建議修正**（§6.1 第 6 步改寫）：
  > 6. **`baselineAt` 為空**（剛加入追蹤，或暫停後恢復）：先執行第 7 步最後的 `episode.maxRate = max(episode.maxRate, s.discountRate)`，再把 `episode` 與第 4 步的條件結果寫進 `PriceSnapshot.episode` 與 `RuleState`，設定 `baselineAt`，**不發任何通知**，跳到第 9 步。（恢復時若已經低於目標價，也不通知；畫面在追蹤清單標示「已低於目標價」。）
  >
  > §6.1 測試新增：「同一檔活動中暫停，期間折扣率 20% → 50%，恢復後連續兩次查價都沒有通知。」

### C-37　`isOnSale()` 沒看 `available`；一次查不到就可能重發通知；早於 7 天的截止日讓 `onSale` 變成 true（中）

- **章節**：§6「`isOnSale`」、§6.1 第 1～3 步、§5.3 `PriceSnapshot.available`、§5.5 第 4 步
- **問題**（模擬重現）：
  1. §6 說「打折中」統一由 `isOnSale(snapshot, now) = isDiscount && !(discountEnd && discountEnd ≤ now)` 計算，儀表板、試算也用它。但查不到時 `PriceSnapshot` 的價格欄位「沿用上一次」，`isDiscount` 仍是 true，所以 `isOnSale()` 回傳 **true**；§6.1 第 1 步卻說這時 `onSale` 為 false。儀表板與 popup 會把已下架的作品顯示成「打折中」，試算會照打折中的作品排除券。
  2. 作品只要**一次**查不到（例如 §4.1 拆半重試時某批短暫失敗，或 API 那次沒回傳），第 3 步就清掉 `episode`；下一次查得到時判成「新的一段優惠」，`sale`、`lowest` 重新上膛。去重 key 用 `episode.key`：有 `campaignId` 或 `discountEnd` 時 key 相同，會被 `notified` 擋下；**兩者都沒有時 key 是 `'start:' + 今天的 JST 日期`**，換了一天就是新 key，重發「特價＋史低」。`deeper` 的 `maxRate` 也被重設。
  3. v0.6 把「選出的日期早於 `checkedAt` 超過 7 天」改成「不明」。不明時 `discountEnd` 省略，`isOnSale()` 只剩 `isDiscount`，所以**一份 `is_discount: true`、截止日是 8 天前的舊資料，會被當成正在打折**（v0.5 時是「已結束」）。CDN 快取舊 8 天不太可能，但 API 資料錯誤時會發出錯誤的 `sale` 通知。
- **建議修正**：
  > - §6：`onSale = available && isDiscount && !(discountEnd && discountEnd ≤ now)`。`target` 的條件也加上 `available`。
  > - §6.1 第 3 步加一條：「`available` 為 false 時**保留**上次的 `episode`（不清掉），只把 `onSale` 當作 false；下一次查得到而且仍在打折時，照一般規則判斷是不是新的一段優惠（和上次的 `episode` 比較）。連續查不到超過 7 天才清掉 `episode`。」
  > - §5.5 第 4 步補一句：「選出的日期早於 `checkedAt` 超過 7 天時，`discountEnd` 省略，但在 `PriceSnapshot` 記下 `discountEndStale: true`；`isOnSale()` 遇到它回傳 false，儀表板顯示『截止時間異常』。」（或接受這個行為並在規格寫明。）
  > - §6.1 測試新增：「沒有 `campaignId` 與 `discountEnd` 的打折作品，查不到一次後恢復，不重發通知」「查不到時儀表板不顯示打折中」。

### C-38　「每件寫入後送通知」和「多件合併成一則」矛盾；每件都重寫整個陣列（中）

- **章節**：§4.2「寫入與通知的先後」、§6.1 第 8、9 步、§4.1
- **問題**：
  1. §4.2 規定「每件作品查價處理完，先寫入……然後才呼叫 `chrome.notifications.create`」。§6.1 第 8 步規定「多件作品再合併成一則（『3 個追蹤作品正在特價』）」。照 §4.2，處理第 1 件時就得送通知，不可能知道後面還有 2 件；照第 8 步，就得等整批處理完才送，這時前面幾件的 `notified` 早已寫入。兩條規則無法同時成立（第三輪 F-18 的建議造成的）。
  2. `snapshots`、`ruleState`、`notified` 都是整個陣列存在一個 key。每件作品各寫一次，1,000 件就要序列化 1,000 次整份資料（`snapshots` 1,000 筆約數百 KB），一輪查價寫入數百 MB，service worker 的 60 秒預算大部分花在這裡。
- **建議修正**（取代 §4.2「寫入與通知的先後」）：
  > - **寫入與通知的先後**：以 §4.1 的一批（商品 API 一次最多 100 件）為單位。整批每件作品依 §6.1 處理完後，用**一次** `chrome.storage.local.set({...})` 寫入 `snapshots`、`ruleState`、`notified`、`recentNotifications`，`priceLog` 用一個 IndexedDB transaction 寫入，然後才把這批的候選合併成一則（或每件一則）通知並呼叫 `chrome.notifications.create`。service worker 若在中間被終止，寧可漏發也不重複發；漏發的通知仍在「最近的通知」看得到。
  > - 跨批次不合併（一輪查價最多 10 批，可能出現多則通知）。
  >
  > §6.1 第 9 步改成「依 §4.2，整批處理完一次寫回後才送通知」。

### C-39　`k′ > 8` 時依到期日截斷，會丟掉效益最大的券（低）

- **章節**：§12.2 第 6 步
- **問題**（實測）：規則是「只用到期最早的 8 張一次性券計算」。如果 8 張小額券都快到期，期限長的大額券就被丟掉。反例：8 張 5% 一次性券（各只適用 1 件、1 天後到期）加 1 張 50% 一次性券（全部適用、20 天後到期），9 件各 ¥1,000。完整 DP 省 ¥4,500（用 50% 券一單）；截斷後只省 ¥400，而且拆成 8 單。這和 §12.1 目標 1「實付金額最低」直接衝突，畫面上的警告也只說「只考慮最快到期的 8 張」，使用者看不出差了 ¥4,100。
- **建議修正**（取代 §12.2 第 6 步最後一點）：
  > - `k′ > 8` 而且 `n ≥ 13` 時，先算每張一次性券對全部作品的最大效益 `save(lᵢ, P)`，依效益由大到小、效益相同時依到期日由近到遠排序，只用前 8 張計算；畫面標示「一次性券較多，只考慮效益最大的 8 張」，並列出沒有考慮的券。
  > - §12.5 新增上面的反例（用 n = 13 時期望選到 50% 券）。

### C-40　自動同步優惠券的 6 小時只看 `lastSuccessAt`，失敗時每開一個 DLsite 頁面就請求一次（低）

- **章節**：§5.4「同步排程」第 3 步、§5.3 `CouponSyncState`
- **問題**：第 3 步「距離 `couponSync.lastSuccessAt` 不到 6 小時 → 不同步」。未登入（`notLoggedIn`）、失敗、`empty`、`unreadable` 都不更新 `lastSuccessAt`，所以只要使用者沒登入 DLsite，**每開一個 DLsite 頁面，content script 就打一次優惠券 API**。請求本身是唯讀的，但次數完全沒有節制，頁面的 Resource Timing 也會一直記到它（§3.3）。
- **建議修正**：
  > - `CouponSyncState` 加 `lastAttemptAt?: string`（每次發出 token 時寫入）。
  > - 第 3 步改成：「距離 `lastSuccessAt` 不到 6 小時，**或**距離 `lastAttemptAt` 不到 1 小時（上次結果不是 `ok` 時）→ 回覆『不同步』。」立即同步（`pendingManual`）照樣略過。

### C-41　`couponExpiring` 的條件與點擊行為沒有寫完整（低）

- **章節**：§6 規則表、§6.2、F6
- **問題與建議**：

| # | 問題 | 建議 |
|---|---|---|
| a | 「7 天內到期」沒排除已過期的券。過期的券照存（§5.4），`expiresAt − 現在 ≤ 7 天` 對過期券也成立 | 條件寫成「`現在 < expiresAt ≤ 現在 + 7 天`、`startsAt ≤ 現在`、`plannerUsable` 為 true」 |
| b | `E(c, {p})` 是非 `payment` 型的定義；`payment` 型的「適用」要看 `B` 的成員 | 寫成「任一追蹤作品屬於 `E(c, {p})`（`payment` 型：屬於 `B` 的成員）」 |
| c | 勾了「留著不用」的券要不要提醒 | 照樣提醒（留著不用正是怕它過期），內文標示「你設定為留著不用」 |
| d | 通知點擊：F6 只定義「單一作品開作品頁、多件開儀表板」，券的通知沒有作品 | 點擊 `couponExpiring` 開 `planner.html`（`ExtPageUrl`）；`RecentNotification` 加 `couponKeys?: string[]` |
| e | `E` 會因作品開始或結束打折而變化，條件可能在 7 天內「成立 → 不成立 → 成立」 | 去重 key 已含 `expiresAt`，不會重發；寫明這是預期行為 |

### C-42　較小的正確性與語意問題（低）

| # | 位置 | 問題 | 建議 |
|---|---|---|---|
| a | §6.2 | `\n`、`\t` 屬於 `Cc`，第一個 `replace` 會直接刪掉，不會變成空白：`作品名\n第2巻` → `作品名第2巻` | 改成先把 `[\p{Cc}\u2028\u2029]` 換成空白，再刪 `\p{Cf}`，最後 `\s+` → `' '`：`s.replace(/[\p{Cc}\u2028\u2029]/gu, ' ').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim()` |
| b | §5.3 `Coupon.key` | 用 `#` 串接，`coupon_id` 本身含 `#` 時可能撞 key；同組序號依 API 回傳順序，順序改變時「留著不用」會跟到另一張相同的券 | 用 `JSON.stringify([coupon_id, limit_date ?? end_date, 序號])`；序號的不穩定只影響完全相同的券，寫明即可 |
| c | §3.7 | 匯入把已存在作品的 `paused` 從 true 改成 false 時，沒有照 §5.3「恢復時清掉 `baselineAt`」 | 寫明匯入的 `paused` 變更照一般的暫停／恢復規則處理 |
| d | §3.6、§3.7 | 「自 YYYY-MM-DD 開始追蹤以來的最低價」若用 `addedAt`，匯入會把 `addedAt` 改早，但本機 `priceLog` 並沒有那麼早的紀錄 | 日期改用「`status`、`origin` 都為空的第一筆 `priceLog.at`」 |
| e | §3.7 | 匯入沒寫「追蹤清單總數上限 1,000 件」；`addedAt` 沒要求 `isCanonicalIso` 與不晚於現在 | 補上；超過上限時摘要顯示「N 件因超過上限未匯入」 |
| f | §5.3 `priceLog` | 第一次查價就查不到（例如手動輸入了不存在的編號）時，「價格欄位沿用最後一筆」沒有最後一筆 | 寫明「沒有任何先前資料時，不寫 `PriceSnapshot` 與 `priceLog`，追蹤清單顯示『查不到這個作品』；連續 3 次查不到提示移除」 |
| g | §6 `target` | 在打折中把目標價調高到現價以上，下一次查價（最多 6 小時後）才發 `target`（模擬）。使用者剛設定就知道已經低於目標價，6 小時後的通知意義不大 | 二選一寫明：(1) `setTarget` 時用目前快照重算 `target` 的 `RuleState`，已成立就不通知；(2) 維持現狀並在設定畫面說明。建議 (1) |
| h | §3.2.4 `lookup` 每分鐘 10 次 | 試算頁「手動輸入編號，最多 15 件」若都是未追蹤作品，要 15 次 `lookup`，超過每分鐘 10 次 | 擴充功能頁面送的 `lookup` 另計上限（每分鐘 30 次），或新增 `lookupMany {ids ≤ 15}` 走一次商品 API 批次 |

---

## 六、新發現：可行性

### F-22　匯入預覽與「同一文件只接受一次」的狀態，在 service worker 重啟後會消失（低）

- **章節**：§3.7「匯入分兩步」、§3.2.4 `badgeInfo`／`cartSnapshot`、§5.3 storage key 一覽
- **問題**：
  1. `importPreview` 回覆 `previewId`，使用者看完摘要再按確認。service worker 閒置 30 秒就被終止；使用者看摘要超過 30 秒（很常見），記憶體裡的預覽就沒了，`importCommit {previewId}` 找不到資料。storage key 一覽也沒有預覽的存放位置。預覽到確認之間，排程查價也可能替「本機沒有紀錄」的作品寫進第一筆 `priceLog`，預覽的結論就不成立了。
  2. `badgeInfo`「同一個 `documentId` 只回一次」、`cartSnapshot`「同一個 `sender.documentId` 只接受一次」：這兩個集合存在記憶體的話，service worker 重啟後就清空，限制等於沒有；存在 storage 的話，沒寫在哪裡、多久清。
- **建議修正**：
  > - §3.7：「`importPreview` 驗證後把正規化過的匯入資料存進 `storage.session` 的 `importPreview: { previewId, senderUrl, data, expiresAt: 現在 + 10 分鐘 }`（同時只保留一份）。`importCommit` 必須帶相同的 `previewId`、來自同一個 `sender.url`，用過即刪；寫入時**重新套用**匯入規則（例如『本機沒有紀錄』要在寫入當下重算），結果和預覽不同時，回覆新的摘要讓使用者再確認一次。」
  > - storage key 一覽新增：`importPreview`（`storage.session`）、`seenDocuments`（`storage.session`，`{ badge: [documentId, at][], cart: [documentId, at][] }`，各保留最近 500 筆、超過 1 小時的刪除）。

### F-23　ESLint 規則的實際能力：`forbid-dom-props` 看不到展開，`jsx()` 不在範圍內（低）

- **章節**：§3.4 第 2 層、`tests/lint-fixtures/`
- **確認**（eslint-plugin-react 文件與原始碼）：
  1. `react/forbid-elements` 檢查 JSX 與 `React.createElement` 呼叫；原始碼的 `isCreateElement` 也認得從 React 解構出來的 `createElement`。**不認得** `jsx()`／`jsxs()`（`react/jsx-runtime`）。選項只有 `element` 與 `message`。
  2. `react/forbid-dom-props` 只套用在 DOM 元素（小寫開頭的 JSX），選項是 `propName`、`disallowedFor`、`disallowedValues`、`message`。文件沒有提到展開屬性與 `createElement` 的 props，依規則的寫法（只看 `JSXAttribute`）判斷看不到 `{...props}`（未驗證原始碼）。
  3. 所以 §3.4 自我測試清單裡的「`{...props}` 展開」：如果範例是 `<a {...props}>`，`forbid-elements` 會擋（因為 `<a>` 本身被禁）；如果是 `<div {...props}>` 或 `<button {...props}>`，**沒有任何一條規則會報錯**，CI 的自我測試會失敗。這正是自我測試的用途，但規格要先寫出用哪條規則擋。
- **建議修正**：採用 S-32 的規則清單（`react/jsx-props-no-spreading` 的 `html: 'enforce'`、`no-restricted-imports` 擋 `react/jsx-runtime`）。§3.4 自我測試清單寫明每個範例檔對應的規則名稱。

### F-24　`attachShadow` 只能用在特定元素；inline `<style>` 被擋時的備案要寫清楚（低）

- **章節**：§3.2.5、§10.3「注入 UI 的樣式」
- **確認**（MDN）：`attachShadow()` 只能用在有效名稱的自訂元素，以及 `article`、`aside`、`blockquote`、`body`、`div`、`footer`、`h1`～`h6`、`header`、`main`、`nav`、`p`、`section`、`span`；元素已經有（非宣告式的）shadow root 時丟 `NotSupportedError`。規格沒寫宿主元素是什麼。如果實作直接對 DLsite 的價格區塊（可能是 `<dl>`、`<td>`、`<li>`）呼叫，會丟例外；對 DLsite 自己用的元素呼叫，也會改變頁面結構。
- **建議修正**（補進 §3.2.5「注入的 UI」）：
  > - 宿主元素一律由 content script 自己 `document.createElement('div')` 建立，插在價格區塊的後面；不對 DLsite 既有的元素呼叫 `attachShadow`。宿主元素不加任何 id 或 class（減少被頁面樣式與腳本選中的機會），尺寸由 shadow root 內的樣式決定。
  > - §10.3「注入 UI 的樣式」的備案寫成：「被擋就改用 `new CSSStyleSheet()`＋`replaceSync()`，指派給 `shadowRoot.adoptedStyleSheets`（constructable stylesheet 不受頁面 CSP 的 `style-src` 限制；在 isolated world 建立的樣式表能否指派給頁面文件裡的 shadow root，M6 確認）。」

### F-25　content script 套件清單的取得方式；開發模式的 CSP（低）

- **章節**：§3.2.5「`check-manifest.ts` 從 source map 列出…」、§7.2
- **問題與確認**：
  1. Vite／Rollup 的 source map 的 `sources` 欄位是原始檔路徑（pnpm 下形如 `node_modules/.pnpm/zod@4.x/node_modules/zod/...`），從路徑取出套件名稱是可行的。但要產生 source map 就得開 `build.sourcemap`，若直接開 `true`，`.map` 檔會被打包進發佈的 zip（任何人都能看到原始碼，也會讓打包掃描掃到 `.map` 裡的字串）。
  2. 比較可靠的做法是 Vite plugin 的 `generateBundle` hook：直接讀每個 chunk 的 `modules` 清單，不需要 source map。WXT 允許在 `wxt.config.ts` 加 Vite plugin（未驗證這個 hook 在 WXT 的 content script 建置中能取得 chunk）。
  3. `style-src 'self'` 在**開發模式**可能擋住 Vite 以 JS 插入的 `<style>`（HMR 的 CSS）。WXT 開發模式會調整 CSP，但是否包含 `style-src` 未驗證。只影響開發，不影響發佈，但 M1 第一天就會遇到。
- **建議修正**：
  > - §3.2.5 改成：「`scripts/check-manifest.ts` 讀取建置時由 Vite plugin（`generateBundle`）輸出的 `content-modules.json`，列出 content script 打包檔包含的套件與大小……」若改用 source map，設 `build.sourcemap: 'hidden'`，並在 `check-manifest` 確認發佈的 zip 裡沒有 `.map` 檔。
  > - §10.3 新增（M1）：「WXT 開發模式下 §7.1 的 CSP 是否擋住 HMR 的樣式；若會，只在開發模式放寬 `style-src`，`check-manifest` 確認發佈版沒有 `'unsafe-inline'`。」

### F-26　pnpm、`ServiceWorkerGlobalScope`、`minimum_chrome_version` 的確認結果（低）

- **確認**：
  1. **pnpm**（pnpm.io 文件）：`allowBuilds` 是「套件比對式 → `true`／`false`」的 map，v11 移除 `onlyBuiltDependencies`、`neverBuiltDependencies`、`ignoredBuiltDependencies` 等並以它取代；`strictDepBuilds` 預設 true；`trustPolicy` 的值是 `no-downgrade` 與 `off`，**預設 `off`**，另有 `trustPolicyExclude`；`minimumReleaseAge` 單位是分鐘、預設 1440，**明確設定時 `minimumReleaseAgeStrict` 預設開啟**；這些設定都寫在 `pnpm-workspace.yaml`（`.npmrc` 只讀 auth、registry、TLS、proxy）。文件已經提到 v12.x 的功能，**pnpm 12 是目前的主版本**；各設定從哪個版本開始支援，文件沒寫（未驗證）。規格的寫法正確，只需要：(a) 決定固定 11 還是 12；(b) 寫明 `trustPolicy` 需要明確設定（預設是關的）；(c) 某個套件沒有 provenance 而安裝失敗時，用 `trustPolicyExclude` 列出並在 PR 說明原因。
  2. **`ServiceWorkerGlobalScope`**：WXT 的 MV3 Chrome background 輸出成 `background.service_worker`，在 service worker 裡 `globalThis instanceof ServiceWorkerGlobalScope` 成立、`location.protocol === 'chrome-extension:'`（Web 標準；未在 WXT 實際輸出驗證，已在 §10.3）。Vitest 要模擬 `instanceof` 很麻煩（得替 `globalThis` 換原型），建議 `endpoints.ts` 把環境判斷寫成可注入的 `getRuntimeEnv()`，測試時替換它。
  3. **`minimum_chrome_version: "120"` 與相依的 API**：`MessageSender.documentId`／`documentLifecycle`（106）、`tabs.sendMessage` 的 `documentId` 選項（106）、`storage.session` 10 MB（文件寫「Chrome 111 以前是 1 MB」）、`alarms` 最短 30 秒（120）、`crypto.randomUUID`（92）、Unicode 屬性跳脫（64）、`adoptedStyleSheets`（73）、`setAccessLevel`（文件標 102+，但 `storage.local` 是否從那時就支援不明確，見 S-34）。全部 ≤ 120，一致。
  4. `chrome.tabs.query({ url: 'https://www.dlsite.com/*' })`：文件寫明沒有 `tabs` 權限時，有該網址的 host permission 也可以用 `url` 篩選並讀到 `tab.url`。F14 立即同步與 popup「查詢這個作品」不需要另外要 `tabs` 權限。

---

## 七、新發現：完整性

### K-6　訊息的回覆形狀、`couponSyncResult.result` 與幾個狀態沒有定義（中）

- **章節**：§3.2.4 訊息清單、§5.3 storage key 一覽、§5.4
- **問題**：§3.2.4 說「訊息清單是完整的，zod schema 與這張表用快照測試鎖住」，但只有**請求**的欄位，沒有**回覆**的形狀；最重要的 `couponSyncResult {token, result}` 的 `result` 完全沒定義（是解析好的 `Coupon[]`？包含 `invalidCount`、`total`、`status` 嗎？`opaqueredirect` 怎麼表示？），而 background 要「再跑一次完整的 zod 驗證」，就必須有這個 schema。另外 storage key 一覽缺：`importPreview`、`seenDocuments`（F-22）、`couponSync.lastAttemptAt`（C-40）、`lookup` 與 `openPage` 的頻率計數、`recheck` 冷卻（S-35）。§5.4 判斷表「`JSON.parse` 失敗 → 標示『無法讀取』」沒對應到 `lastResult` 的哪個值（`unreadable` 已經用在「全部解析失敗」）。
- **建議修正**：
  > §3.2.4 表格下方新增：
  > ```ts
  > // content script → background
  > type CouponSyncResult =
  >   | { status: 'ok'; coupons: CouponInput[]; total: number; invalid: { index: number; path: string; code: string }[] }
  >   | { status: 'notLoggedIn' }                       // opaqueredirect
  >   | { status: 'failed'; httpStatus?: number }       // 例外、非 200、超過 1 MB、最外層不是陣列
  >   | { status: 'unparsable' };                       // JSON.parse 失敗
  > // CouponInput 是 Coupon 去掉 key、syncedAt 之外的欄位；background 重新驗證、重新產生 key 與 syncedAt
  > // background 的回覆
  > type BadgeInfoReply = { tracked: false } | { tracked: true; lowest?: { price: number; start: string; end: string; source: 'dlwatcher' | 'own' }; paused: boolean };
  > type LookupReply = { ok: true; snapshot: PriceSnapshot; history: HistoryRecord | null; fetchedAt: string } | { ok: false; reason: 'rateLimited' | 'notFound' | 'failed' };
  > type ShouldSyncReply = { sync: false } | { sync: true; token: string };
  > ```
  > `CouponSyncState.lastResult` 加 `'unparsable'`（`JSON.parse` 失敗；顯示「無法讀取（未登入或 API 改版）」），`'unreadable'` 只用於「全部解析失敗」。storage key 一覽補上 F-22、C-40、S-35 提到的 key。

### K-7　功能與資料來源對不上的地方（低）

| # | 位置 | 問題 | 建議 |
|---|---|---|---|
| a | F15「從購物車選擇作品」 | 規格沒有儲存「購物車目前有哪些作品」：`cartSnapshot` 只用來補進追蹤清單，試算頁拿不到購物車內容 | 二選一：(1) background 把最近一次 `cartSnapshot` 的編號存成 `lastCart: { ids, at }`（`storage.local`，不匯出），試算頁顯示「購物車（YYYY-MM-DD HH:mm 讀取）」；(2) F15 拿掉「從購物車」。建議 (1) |
| b | §5.3 `TrackedItem.source` 註解 | 寫「`lookup`：F12／F13 結果的『加入追蹤』」，但 F12 在作品頁裡的結果按「加入追蹤」是 content script 送的 `track`，一律記成 `page` | 註解改成「`lookup`：popup 與 `lookup.html` 的查詢結果；作品頁裡的查詢結果記成 `page`」 |
| c | §3.6「按加入追蹤時，把當下查到的價格寫成第一筆」 | 只有 `from: 'lookup'` 時 background 才知道要找 `lookupCache`；快取過期或不存在時怎麼辦沒寫 | 「`track` 時若 `lookupCache` 有這件作品而且未滿 24 小時，就用它寫第一筆 `priceLog` 與快照；否則照一般流程排進查價佇列」，不看 `from` |
| d | §9 | F10 匯入／匯出、F11 台幣參考價、F9 popup 的大部分功能沒有排進任何里程碑 | 新增「M9 匯入匯出與台幣參考價」，或在現有里程碑的「內容」欄補上 |

### K-8　里程碑完成標準要補的項目（低）

| 里程碑 | 補上 | 來源 |
|---|---|---|
| M1 | content script 呼叫 `chrome.storage.local.get` 失敗（`setAccessLevel` 生效）；S-32、F-23 的每個 lint 範例都報錯 | S-34、S-32 |
| M2 | content script 的 DOM lint 範例都報錯；content script 打包檔不含 `storage.local`、`react`；`track` 計入每日上限 | S-33、S-34、S-35 |
| M3 | DLWatcher 合理性檢查的 4 個不通過案例（`lowest` 過高、過低、`start > end`、走勢點超出 0～1）保留舊資料 | §3.6 |
| M4 | 暫停恢復不誤發 `deeper`；查不到一次不重發；一批多件合併成一則 | C-36、C-37、C-38 |
| M7 | 連按「立即同步」只發一次請求；未登入時 1 小時內不重試；`pendingManual` 過期後不能略過 6 小時 | S-35、C-40 |
| M8 | `k′ > 8` 的反例選到效益最大的券 | C-39 |

### K-9　§10.3 待確認清單要補的項目（低）

| 項目 | 要確認的事 | 時機 | 來源 |
|---|---|---|---|
| `storage.local` 存取層級 | `setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` 在 Chrome 120 對 `storage.local` 有效；重開瀏覽器後是否保留 | M1 | S-34 |
| 開發模式 CSP | WXT dev 下 `style-src 'self'` 是否擋 HMR 樣式 | M1 | F-25 |
| content script 模組清單 | Vite plugin 的 `generateBundle` 在 WXT content script 建置中能否取得 `modules` | M2 | F-25 |
| `adoptedStyleSheets` | isolated world 建立的 `CSSStyleSheet` 能否指派給頁面文件中的 closed shadow root | M6 | F-24 |
| `meta refresh` | 以程式插入擴充功能頁面的 `<meta http-equiv=refresh>` 會不會導覽（決定 lint 規則的必要性；不論結果都保留規則） | M1 | S-32 |
| `declarativeNetRequest` | 擴充功能發起的導覽（`location.href`、`tabs.create`）的 `initiator` 是什麼，能否只擋擴充功能自己對 `/home/mypage/coupon` 的導覽而不影響使用者手動開啟 | 第二階段 | S-32 |
| pnpm 主版本 | 固定 11 或 12；`trustPolicy` 預設 `off`，要明確設定 | M1 | F-26 |

### K-10　規格已超過 1,000 行：拆分與簡化建議（低）

- **現況**：`SPEC.md` 1,061 行、約 116 KB。前 10 行是版本變更紀錄；§3.2～§3.4、§7.1、§7.2 的安全規則約佔 35%；ESLint 選擇器、lint 範例檔清單、regex 細節、CSP 每個 directive 的理由，已經是實作筆記的粒度。讀者要找「這個功能做什麼」時，得跳過大量實作細節；改一條規則時，常常要同時改三處（例如 `isOnSale` 出現在 §6、§6.1、§5.5）。
- **建議拆分**（不改內容，只搬位置）：

| 新檔案 | 內容 | 約略行數 |
|---|---|---|
| `SPEC.md` | §1 目標、§2 功能、§3.1 請求節制、§3.3 隱私、§3.5～§3.7 的規則摘要、§4 架構、§5 資料模型、§6 通知規則、§9 里程碑、§11 風險 | 約 500 |
| `docs/security.md` | §3.2、§3.4、§7.1、§7.2 的完整規則與 ESLint 設定、lint 範例檔清單、打包掃描 | 約 300 |
| `docs/planner.md` | §10.1、§10.2、§12 | 約 200 |
| `docs/verification.md` | §10 表格、§10.3，以及每個里程碑確認後的結果 | 約 80 |
| `CHANGELOG.md` | 開頭的版本變更紀錄 | — |

- **可以移到實作筆記（程式註解或 `docs/`）的內容**：`intIn` 的完整程式碼、ESLint 選擇器的寫法、`tests/lint-fixtures/` 的範例清單、CSP 每個 directive 的理由、`appliesToDiscounted` 的句型清單、§12.2 的運算量表格。規格只留「規則」與「測試案例」，程式碼留在程式裡，測試就是規格。
- **建議刪減或延後的功能**（明顯減少規則數）：
  1. **`deeper` 規則移到第二階段**（預設本來就是關的）：可以刪掉 `episode.maxRate`、C-36 的暫停恢復問題、§6.1 第 7 步一半的文字與一個測試。
  2. **F10 匯入延到 v1 之後，v1 只做匯出**（P2 功能）：可以刪掉 `importPreview`／`importCommit` 兩個訊息、F-22 的預覽暫存、`origin: 'import'`、`priceLog` 新增條件第 3 條、§3.7 大半的規則與 C-42 c、d、e。匯出本身沒有安全風險。
  3. **`ending` 的條件簡化成「`onSale` 而且 `discountEnd − 現在 ≤ 24 小時`」**：「你開啟的 `sale`／`target`／`lowest` 至少一條成立」在 `sale` 預設開啟時永遠成立，只在使用者關掉三條時才有差別。
  4. **`uᵢ ≥ n` 放進 `R` 的最佳化保留**（不能刪：否則 n = 15 時每張限次券要展開成 15 層）。

---

## 八、建議修改 SPEC.md 的項目（依優先順序）

| 順序 | 修改 | 對應發現 | 章節 | 最晚時機 |
|---|---|---|---|---|
| 1 | background 啟動時 `storage.local.setAccessLevel('TRUSTED_CONTEXTS')`；content script 禁用 `chrome.storage`；§10.3 M1 確認 | S-34 | §4.2、§3.3、§10.3 | **M1** |
| 2 | §3.4「保證」改成「降低機率」；補 `meta`、`link`、`base` 等元素、`httpEquiv`、`jsx-props-no-spreading`、`react/jsx-runtime`、`navigation.navigate`、`open`、別名、型別斷言；§11 新增相依套件導覽風險 | S-32 | §3.4、§11 | **M1** |
| 3 | lint 自我測試清單寫明每個範例對應的規則；`forbid-dom-props` 看不到展開 | F-23 | §3.4 | **M1** |
| 4 | §10.3 補 M1 項目：開發模式 CSP、pnpm 主版本與 `trustPolicy` | F-25、F-26、K-9 | §10.3、§7.2 | M1（可在 M1 中途補） |
| 5 | content script 的 DOM 寫法 lint、樣式常數檢查 | S-33 | §3.2.5 | M2 |
| 6 | content script 訊息的頻率與次數上限；`recheck`、`syncCouponsNow` 冷卻 | S-35 | §3.2.4 | M2 |
| 7 | `setSettings` 的 strict schema、`?n=`、`setTarget`、`setCouponReserved` 的驗證 | S-36 | §3.2.4 | M2 |
| 8 | 訊息回覆形狀、`CouponSyncResult` schema、`unparsable`、storage key 補項 | K-6 | §3.2.4、§5.3、§5.4 | M2（`CouponSyncResult` 在 M7 前） |
| 9 | 套件清單改用 `generateBundle`，或 hidden source map 且不發佈 `.map` | F-25 | §3.2.5、§7.2 | M2 |
| 10 | 「同一文件只接受一次」的狀態存 `storage.session` | F-22 | §3.2.4、§5.3 | M2 |
| 11 | `onSale` 加 `available`；查不到時保留 `episode`；早於 7 天的截止日 | C-37 | §6、§6.1、§5.5 | M4 |
| 12 | 建立基準時也更新 `maxRate`；暫停恢復的測試 | C-36 | §6.1 | M4 |
| 13 | 以一批為單位寫入與送通知 | C-38 | §4.2、§6.1 | M4 |
| 14 | `setTarget` 時重算 `target` 的 `RuleState` | C-42 g | §6 | M4 |
| 15 | 通知清理改成先換空白 | C-42 a | §6.2 | M4 |
| 16 | 宿主元素用自己建的 `div`；`adoptedStyleSheets` 備案 | F-24 | §3.2.5、§10.3 | M6 |
| 17 | 自動同步加 `lastAttemptAt` 與 1 小時重試間隔 | C-40 | §5.4、§5.3 | M7 |
| 18 | `couponExpiring` 條件、點擊開試算頁 | C-41 | §6、§6.2 | M7 |
| 19 | `k′ > 8` 改依效益排序 | C-39 | §12.2、§12.5 | M8 |
| 20 | 試算的購物車來源、`lookup` 上限 | K-7 a、C-42 h | F15、§3.2.4 | M8 |
| 21 | `source` 註解、`lookupCache` 轉存、里程碑補 F10／F11 | K-7 b～d | §5.3、§3.6、§9 | 各里程碑 |
| 22 | 匯入預覽存 `storage.session`、寫入時重算；匯入的小問題 | F-22、C-42 c～f | §3.7 | 匯入開工前 |
| 23 | 里程碑完成標準補項 | K-8 | §9 | 各里程碑 |
| 24 | `Coupon.key` 改用 `JSON.stringify` | C-42 b | §5.3 | M7 |
| 25 | 拆分規格；延後 `deeper` 與匯入；簡化 `ending` | K-10 | 全文 | M1 之後任何時候 |

---

## 九、M1 準備度評估與後續審查建議

### 9.1 M1 準備度

**結論：可以開始 M1。開始前先做第八節第 1～3 項（約 30 分鐘的文字修改）。**

M1 的範圍是 WXT 骨架、`zod-setup.ts`、ESLint 規則與 lint 範例檔、`apiGet` 與白名單、`nav.ts` 與連結元件、`Settings` 與 storage 存取層、background 查價、手動加入。這幾件事都會寫進程式基礎，其中只有三件事受本輪發現影響：

1. **S-34**：M1 要做 storage 存取層，`setAccessLevel` 是一行程式，但要從第一天就有，否則之後的程式可能不小心依賴「content script 讀得到 `storage.local`」。
2. **S-32**：M1 要建立 ESLint 規則與範例檔，規則清單應該一次寫完整。
3. **F-23**：M1 要讓 lint 自我測試通過，規格得先說清楚每個範例由哪條規則擋，否則「`{...props}` 展開」那個範例會讓 CI 一直失敗。

第八節第 4 項（§10.3 的 M1 確認項）可以在 M1 進行中補。其餘的中嚴重度問題（S-33、C-36、C-37、C-38、K-6）分別在 M2、M4、M7 才會碰到，在那之前修正即可。

本輪沒有任何發現會讓擴充功能領券、改購物車或結帳：`fetch` 對領券端點有兩道防線（擴充功能環境）或一道防線加行為測試（content script），剩下的風險都是「相依套件被植入惡意版本」這類只能降低機率的情況，S-32、S-34 已經把能做的部分列出來。

### 9.2 還要不要再做一輪審查

**不建議再做一輪完整的規格審查。** 理由：

| 輪次 | 發現數 | 高 | 中 | 主要性質 |
|---|---|---|---|---|
| 第一輪（v0.3） | 33 | 4 | 17 | 架構與核心演算法錯誤 |
| 第二輪（v0.4） | 31 | 1 | 9 | 演算法的目標函數、通知與日期規則 |
| 第三輪（v0.5） | 28 | 0 | 10 | 狀態機順序、防線設計 |
| 第四輪（v0.6） | 22 | 0 | 7 | 縱深防禦的缺口、邊界情況、規格內部的一致性 |

- 演算法（DP）連續兩輪和暴力窮舉完全一致，日期規則連續兩輪全部通過，核心邏輯已經穩定。
- 本輪的中嚴重度裡，S-34 是平台行為（只有讀文件才看得到），S-32、S-33 是「規則清單還能更完整」，C-36～C-38 是只有寫成程式、跑過測試才容易發現的狀態機邊界。這類問題**用實作與單元測試發現的成本比讀規格低**。
- 規格每改一輪就多 100～200 行，K-10 提到的重複與交叉引用越來越多，再一輪審查很可能主要在找「修改造成的不一致」（本輪 C-38 就是）。

**建議的替代做法**：

1. 套用第八節第 1～3 項後把規格定為 v0.7，開始 M1。
2. **M1 結束時**做一次小型確認（不是完整審查）：§10.3 標為 M1 的項目實測結果（CSP、`setAccessLevel`、lint 範例檔、商品 API 的批次行為），把結果寫回規格。
3. **M4 開工前**針對 §6 做一次聚焦審查：把 §6.1 的 9 個步驟寫成 `lib/rules.ts` 與測試後，再對照 C-36～C-38 與本報告第一節的模擬情境檢查一次。這比讀規格更容易發現新問題。
4. **M7、M8 開工前**各花一點時間重讀 §5.4 與 §12，確認 §10.2 已經有答案的項目寫回規格。
5. 規格拆分（K-10）可以在 M1 之後任何時候做，越早做，之後的修改越不容易漏改。

---

## 附錄：本次沒有驗證的事

以下內容需要實際的 Chrome、WXT 專案或 DLsite 才能確認，本次只依文件、標準與既有知識判斷：

**Chrome 與 Web 平台**
- `chrome.storage.local.setAccessLevel()` 在 Chrome 120 是否支援 `storage.local`（文件現在列出 local 也支援，版本標示為「Chrome 102+」，但沒寫 local 從哪一版開始），以及設定在瀏覽器重開後是否保留。
- §7.1 整條 CSP 是否被 Chrome 接受；路徑限定的 `connect-src` 在擴充功能環境是否照 CSP3 比對（W3C CSP3 確認：結尾有 `/` 是前綴比對、沒有是完全比對，轉址後不比對路徑；查詢字串依路徑序列化的寫法判斷不參與比對）。
- WXT 開發模式下 `style-src 'self'` 是否擋住 HMR 的樣式。Chart.js v4 是否完全不插入 `<style>`（依既有知識 v3 起已移除 CSS 注入）。
- 擴充功能頁面以程式插入 `<meta http-equiv=refresh>` 時 Chrome 是否導覽（HTML 標準規定會；本次沒在瀏覽器測）。
- DLsite 頁面的 CSP 是否擋 content script 插入 shadow root 的 `<style>`；isolated world 建立的 `CSSStyleSheet` 能否指派給頁面文件裡的 shadow root。
- `declarativeNetRequest` 對擴充功能發起的導覽的 `initiator`。
- `MessageSender.url` 在 `pushState` 之後是否改變；service worker 冷啟動時 `badgeInfo` 的回覆時間；一次 `storage.local.set()` 寫多個 key 是否不可分割（文件沒寫）。
- content script 的 fetch 是否出現在頁面的 Resource Timing、是否經過 DLsite 頁面自己的 service worker。

**WXT 與套件**
- WXT 輸出的 background 裡 `globalThis instanceof ServiceWorkerGlobalScope` 成立（Web 標準上成立）。
- Vite plugin 的 `generateBundle` 在 WXT 的 content script 建置中能否取得 chunk 的 `modules`。
- `react/forbid-dom-props` 對 `{...props}` 展開與 `React.createElement` props 的實際行為（文件沒寫，本次沒讀這條規則的原始碼）。
- pnpm `trustPolicy`、`minimumReleaseAge`、`allowBuilds` 各自的最低支援版本（文件沒寫）；pnpm 11 與 12 的差異。
- WXT 能否打包 Web Worker；n = 15 在瀏覽器 Web Worker 裡的計算時間。

**DLsite 與 DLWatcher**（和前幾輪相同，等各里程碑確認）
- 商品 API 對不存在編號的回應、`%2C`、`campaign_id` 沒有活動時的值。
- 未登入時優惠券 API 的回應；同一種券是否回傳多筆相同的 `coupon_id`。
- 手機版作品頁的網址格式；DLWatcher 日期欄位的格式與進行中特價的 `end`。

**本次已驗證（Node.js v24.14 實測、官方文件或原始碼）**
- §12.2 DP（含 `uᵢ ≥ n` 的限次券計成本、完全相同的一次性券去重）與暴力窮舉比對 800 組隨機案例，全部一致；§12.5 的全部案例（含新增 3 個）；§12.3 範例 3 單、省 ¥1,716；`k′` 截斷的反例（¥4,500 vs ¥400）。
- §6.1 的 9 個步驟逐字模擬：規格的 4 個測試通過；暫停恢復誤發 `deeper`、`isOnSale` 不看 `available`、沒有活動編號時一次查不到就重發、`target` 調整、`ending` 的時機與規則全關時的行為。
- §5.3 `priceLog`：M3 的兩個完成標準；第一次就查不到時沒有可沿用的價格。
- §5.5 的 7 個測試與 5 個邊界案例；`parseJst` 的拒絕案例；台灣時區 1 小時誤差；`limit_date` 秒／毫秒；`isCanonicalIso`。
- 規格中 14 個 regex 對 10 萬字惡意字串的時間；`SPEC.md` 的 §6.2 regex 已是跳脫寫法、可執行；`Array.from` 截斷不留下單獨代理字元；`Cc` 刪除會黏住換行兩側的文字。
- `new URL()` 對 `..`、`%2F`、大寫網域、結尾的點、`:443` 的正規化，`assertAllowed` 的完全比對都擋得住。
- 文件：Chrome storage（`storage.local` 預設對 content script 開放、`setAccessLevel`、`storage.session` 10 MB 與預設存取層級、多 key 寫入沒有原子性保證）；Chrome CSP（`extension_pages` 適用於 service worker、最低要求）；W3C CSP3（路徑比對、轉址、prefetch 由 `default-src` 管、`worker-src` 的退回順序）；WHATWG HTML（`meta refresh` 在插入時執行）；MDN `attachShadow`（可用元素、例外）；eslint-plugin-react（`forbid-elements` 認得 JSX、`React.createElement` 與解構的 `createElement`，不認得 `jsx()`；`forbid-dom-props` 只管 DOM 元素）；pnpm（`allowBuilds`、`strictDepBuilds`、`trustPolicy` 預設 `off`、`minimumReleaseAge` 預設 1440 與 strict 模式、設定寫在 `pnpm-workspace.yaml`、文件已提到 v12）。
