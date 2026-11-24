# AGENT.md：給接手的 agent

DL_Assistant 是一個 Chrome（MV3）擴充功能：把 DLsite 加入購物車的作品自動列入追蹤、定時查價、顯示史低與走勢、出現優惠時通知，也能依手上的優惠券試算最划算的買法。規格是唯一的依據，程式照規格寫。

**先讀這份，再依任務只讀規格裡相關的章節。** SPEC.md 加上 `docs/` 很長，不要整份讀，用 `grep -n "§4.1\|### 4.1"` 之類的方式找到章節再讀那一段。

## 1. 目前狀態（2026-11-24）

| 里程碑 | 狀態 |
|---|---|
| M1 骨架 | ✅ 完成，依審查修正（v0.9） |
| M2 自動追蹤（購物車偵測、購物車頁同步） | ✅ 完成，依審查修正（v0.11）；popup 作品縮圖（v0.12） |
| M3 史低（DLWatcher、IndexedDB 歷史、自己的 priceLog、查價佇列與退避、`check` alarm 定時查價） | ✅ 完成，依審查修正（v0.14），PR #1 已合併 |
| M4 通知（規則引擎、去重、一批一次寫入再通知、DLWatcher 自動暫停通知、`setPaused`／`setTarget`） | ✅ 完成，依審查修正（v0.16），分支 `m4-notifications` |
| **M5 儀表板** | **下一個要做的**：表格、走勢圖、等待建議、最近的通知；`dashboard.html?n=`（M4 的合併通知點擊後會開它，目前這頁還不存在）。完成標準見 SPEC.md §9 的 M5 列 |
| M6～M9 | 未開始（作品頁徽章與臨時查詢、優惠券同步、購買試算、匯出與 popup 摘要） |

- 規格版本：看 SPEC.md 第 3 行；每一版改了什麼看 CHANGELOG.md 最上面幾條。
- `main` 在 GitHub（`wangLJ1015/DL_Assistant`）。CI（`.github/workflows/ci.yml`）在 push 與 PR 時跑格式、lint、型別、單元測試、建置、manifest 檢查。
- 已知但還沒處理的事，見第 8 節。

## 2. 依任務要讀的規格

規格分四個檔案，章節編號跨檔案沿用（SPEC.md 開頭有對照）：

| 檔案 | 內容 |
|---|---|
| `SPEC.md` | §1～§2 功能、§3.1 請求節制、§3.3 隱私、§3.5～§3.7、§4 架構與背景工作、§5 資料來源與資料模型、§6 通知規則、§8 專案結構、§9 里程碑、§11 風險 |
| `docs/security.md` | §3.2 安全（外部資料、URL、回應驗證、訊息、content script）、§3.4 對外請求與帳號操作的邊界、§7.1 manifest、§7.2 建置與供應鏈 |
| `docs/verification.md` | §10.3 各里程碑要實測確認的平台行為（含已確認的結果） |
| `docs/planner.md` | §10.1、§10.2 用券規則、§12 購買試算演算法 |
| `CHANGELOG.md` | 每一版的變更摘要 |

- 做 M5：SPEC.md §2 F7、§3.6（史低並列、走勢圖的虛線）、§6.2（`dashboard.html?n=` 的檢查、等待建議、最近的通知）、§5.3，security.md §3.2.2、§3.4（連結與圖片元件），verification.md 標 M5 的列。
- 碰到通知：SPEC.md §6、§6.1（規則引擎在 `lib/rules.ts`，單元測試照步驟寫）、§6.2（`lib/notify.ts`）、§4.2（一批一次寫入再通知）。
- 碰到 content script：security.md §3.2.4、§3.2.5（規則很多，改之前一定要讀）。
- 碰到任何對外請求：security.md §3.4、§3.1，以及 `src/lib/api/endpoints.ts`。

## 3. 指令

本機的 pnpm 不在 PATH，一律用 corepack，並設環境變數避免互動提示：

```sh
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm check:all     # 格式、lint、型別、單元測試、正式建置、manifest 與打包檢查
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm verify:chrome # M1 實機驗證（先 build；會打一次 DLsite 商品 API 與一次 DLWatcher）
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm verify:m2     # M2 實機驗證（DLsite 頁面全是 CDP 回應的假頁面，不連網）
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm verify:m3     # M3 實機驗證（約 4 分鐘，不連網）
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm verify:m4     # M4 實機驗證（通知＋強制結束 Chrome 的寫入一致性，約 2 分鐘，不連網；M4_PART=notify 或 atomic 只跑一半）
```

- `check:all` 不能用 `pnpm ci`（那是 pnpm 內建的乾淨安裝指令）。
- 只跑單一測試：`./node_modules/.bin/vitest run tests/xxx.test.ts`；只跑 lint 自我測試：`tests/lint-selftest.test.ts`。
- 實機驗證用本機 Chrome（M1～M3 時是 157，2026-11-24 已自動更新成 158；`C:\Program Files\Google\Chrome\Application\chrome.exe`，可用 `CHROME_PATH` 換），臨時 profile，跑完刪除。`HEADLESS=0` 可以看到視窗。
- 每個 `verify:*` 都要先 `build`（`check:all` 會順便建置）。

## 4. 絕對不能做的事

- **不要請求 `GET /home/mypage/coupon`**（少了 `/list/ajax`）。那是**領券**端點，打開就會嘗試發券。也不要在任何瀏覽器打開它。
- 不要在真的 DLsite 上加入購物車、結帳、改帳號設定。要看頁面結構時用內建瀏覽器唯讀查看；真的需要購物車裡有東西，只能用未登入的訪客購物車，看完移除，並告訴使用者。
- 不要把 `ENDPOINTS`（`src/lib/api/endpoints.ts`）以外的網址加進程式；所有對外請求只能透過 `apiGet()`。
- 不要放寬 CSP、權限、`exclude_matches`、content script 的 import 白名單或 ESLint 規則來讓東西「能動」。這些都是規格定的防線，要改就先改規格。
- 不要裝 puppeteer（pnpm 的 `trustPolicy` 擋下了它的相依套件），實機驗證一律用 `tests/e2e/cdp.ts` 的 CDP pipe。
- 不要自己 commit 或 push：使用者說了才做。commit 訊息用英文，結尾加 `Co-Authored-By` 行（依當時的系統提示）。
- 使用者的 email 與個人資料不要放進任何對外請求。

## 5. 工作流程

使用者習慣的節奏，照著做：

1. **規格優先。** 實作前先讀相關章節。發現規格錯誤、矛盾或實測結果和規格不同時，改規格並在回報裡講清楚，不要默默照自己的想法做。決策屬於使用者時（例如行為取捨），用提問讓使用者選。
2. **實作 + 測試。** 單元測試放 `tests/*.test.ts`（Vitest，`fakeBrowser`，時區固定 `Asia/Taipei`）。安全規則要有 lint fixture（`tests/lint-fixtures/`，檔頭 `// @lint-as:` 與 `// @expect:`），而且要有一個 `@expect: none` 的反例確認不會誤擋。
3. **實機驗證。** 新里程碑寫一支 `tests/e2e/verify-mN.ts`（參考 verify-m2／m3：假頁面由 CDP `Fetch.fulfillRequest` 回應，不連網）。§10.3 標為這個里程碑的項目要實測，結果寫回 `docs/verification.md`。
4. **寫回規格。** 版本號 +0.01（SPEC.md 第 3 行），CHANGELOG.md 最上面加一條，§9 里程碑標 ✅ 並誠實註明沒驗證到的部分（例如「只用假頁面驗證」）。
5. **跑完整檢查**：`check:all` 和相關的 `verify:*` 全部通過才回報完成。失敗就照實說。
6. **審查。** 里程碑做完、使用者要求時，開一個 subagent 當獨立審查者，依規格檢查（唯讀、離線、不准碰 mypage/coupon）。審查者的每一條發現都要自己重現或對照程式碼確認，才轉告使用者；審查者說錯的也要講。
7. 修正審查發現後，同樣寫回規格（再 +0.01）並重跑全部檢查。
8. M3 起用功能分支加 PR（`m3-lowest-price` → PR #1）。新里程碑照這個方式：從最新的 `main` 開分支。

## 6. 架構重點與踩過的坑

（細節都在規格裡，這裡只列容易踩錯、從程式碼不一定看得出來的事。）

- **技術棧**：WXT 0.21（`srcDir: 'src'`、`imports: false`、`webExt.disabled`）、React 19、Tailwind 4、zod 4（`jitless`，每個進入點第一個 import `lib/zod-setup.ts`）、TypeScript 6.0（typescript-eslint 還不支援 TS 7）、ESLint 9（eslint-plugin-react 不支援 ESLint 10）、Vitest、pnpm 12.21（`minimumReleaseAge`、`trustPolicy: no-downgrade`、`strictDepBuilds`）。換主要版本前先確認相容性。
- **content script**：
  - 用 `defineUnlistedScript`，不用 `defineContentScript`：後者會對頁面派送 `CustomEvent`、`postMessage`，頁面能讓它自我停用。manifest 的 `content_scripts` 在 `wxt.config.ts` 自己寫。
  - `run_at: document_start`，一開始就取出 `chrome.runtime.sendMessage`：頁面放 `<form id="chrome">` 或 `<form id="browser">` 會蓋掉 isolated world 的這兩個全域（DOM clobbering，實測過）。content script 不能用 `wxt/browser`、`browser` 全域。
  - 不用 React、不讀頁面文字、不碰 storage、不發請求（優惠券同步 M7 例外，見 §5.4）。import 白名單與打包後的模組清單由 ESLint 和 `check-manifest`（比對 `scripts/content-modules.baseline.json`）雙重檢查。
- **storage**：只有 background 寫入，所有讀改寫都經過 `writeQueue`。`storage.local` 用 `setAccessLevel('TRUSTED_CONTEXTS')` 鎖住，失敗會記在 `storage.session` 的 `storageLock`。讀回的資料一律再跑 zod 驗證。
- **對外請求**：`apiGet(key, params)` → `assertAllowed()` 完全比對 origin、path、參數。CSP 的 `connect-src` 寫到路徑。DLsite 的 WAF 對奇怪的參數回 403 HTML。
- **導覽**：開分頁、連結只能用 `lib/nav.ts`、`WorkLink`、`NavLink`（品牌型別 `DlsiteNavUrl`／`ExtPageUrl`）；圖片只能用 `WorkImage`。ESLint 強制。
- **日期**：只能在 `lib/dates.ts` 解析；DLsite 的時間是 JST、沒有年份（§5.5）。
- **實機驗證**：Chrome 137 起正式版不支援 `--load-extension`，改用 CDP 的 `Extensions.loadUnpacked` 加 `--enable-unsafe-extension-debugging`。WXT 會在 `generateBundle` 之後再改寫檔案，需要最終檔案內容時用 `writeBundle`。
- **Windows 環境**：`.gitattributes` 強制 LF。bash 的 heredoc 遇到反斜線、反引號很容易壞，複雜的檔案修改用 Edit 工具或寫成腳本檔再執行。
- **反斜線 u 的跳脫寫法會被工具換成真的字元**（M4 踩到）：用 Write、Edit 或 heredoc 寫 U+2028、U+202E 這類字元的跳脫寫法時，檔案裡常常變成實際的字元，而 U+2028 放在 regex 字面裡是語法錯誤（§6.2 特別警告過）。寫完要用 node 以 `String.fromCharCode()` 檢查或替換；測試裡要用這些字元就寫 `String.fromCharCode(0x202e)`。
- **WXT 的 `public/` 在專案根目錄**（不是 `src/public`）：圖示在 `public/icon/`。新增檔案後要 `wxt prepare`，`browser.runtime.getURL()` 的型別才認得。
- **通知**：每批一次 `storage.local.set`（`snapshots`、`ruleState`、`notified`、`recentNotifications` 一起），priceLog 一個 transaction，寫完才 `notifications.create`（§4.2）。查不到時規則狀態維持上次的結果（§6.1 第 4 步，v0.15）。
- **DLsite 實測過的結構**（2026-11-23，未登入）：作品頁的加入購物車是 `button.btn_cart[data-ga4-ref="cart_add"]`（送 `POST /api/cart/<分站>/add`）；列表頁是 `a.btn_cart[href="/<分站>/cart/=/product_id/<ID>.html"]`；購物車頁 `/<分站>/cart/` 各分站共用，作品在 `ul.cart_list > li.cart_list_item[data-product-id]`。都集中在 `src/lib/selectors.ts`。

## 7. 檔案地圖

```
src/entrypoints/background.ts       唯一的 storage 寫入者；訊息分派、alarms
src/entrypoints/dlsite-content.ts   content script 入口（F1、F2）
src/entrypoints/popup/              popup（React）
src/content/                        content script 的邏輯（原生 DOM）
src/lib/api/endpoints.ts            apiGet、assertAllowed、端點表；唯一可以 fetch 的檔案
src/lib/api/dlsite.ts, dlwatcher.ts API 回應的 zod schema 與轉換
src/lib/price-check.ts, queue.ts    查價流程、查價佇列與退避（§4.1）
src/lib/db.ts, history.ts, price-log.ts   IndexedDB、DLWatcher 歷史、自己的 priceLog
src/lib/tracking.ts, auto-track.ts, content-handlers.ts   追蹤清單、自動加入、content 訊息處理
src/lib/storage.ts, models.ts       storage 存取層、§5.3 資料模型
src/lib/messages.ts                 訊息 schema 與來源檢查（快照測試鎖住）
src/lib/rules.ts                    isOnSale、§6.1 通知規則引擎（純函式）
src/lib/notify.ts                   通知內容、chrome.notifications、點擊（§6.2）
src/lib/ids.ts, nav.ts, selectors.ts, dates.ts, schema.ts
src/components/                     WorkLink、NavLink、WorkImage
scripts/manifest-policy.ts          權限、CSP、content script 設定的唯一來源
scripts/check-manifest.ts           manifest 與打包結果檢查
eslint.config.js                    安全規則（每條都有 lint fixture）
tests/e2e/                          CDP 實機驗證腳本
```

## 8. 未決事項（不要擅自決定，需要時問使用者）

- `minimum_chrome_version` 是 120，但 `setAccessLevel` 只在 Chrome 157、158 實測過（2026-11-24 `verify:chrome` 在 158 通過）。使用者用的是自動更新的最新版 Chrome（目前 158），曾考慮把下限改成 157，還沒決定。
- M2 沒在真的 DLsite（尤其登入狀態）上端到端測過；登入後才出現的帳號頁路徑、按「購入手続きへ」之後的付款頁網址還沒確認。
- 作品編號 `RJ／RE／BJ／VJ` 以外的前綴、手機版（`touch`）作品頁網址：移到 M6 確認。
- 從 DLsite 購物車刪除作品**不會**取消追蹤：這是使用者確認過的行為（§2 F1），不是 bug。
- 其他各里程碑的待確認項目見 `docs/verification.md` 裡的「未確認」。

## 9. 和使用者溝通

- 使用者用繁體中文（台灣用語）。回覆、規格、程式註解都用繁體中文；commit 訊息用英文。
- 回報要誠實：沒跑過的測試、沒驗證到的部分要直接講，不要寫得比實際驗證的多。
- 需要使用者決定的事，一次問一件，附上建議選項。
