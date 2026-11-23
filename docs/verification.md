# DL_Assistant 待驗證事項

> 本文件是 [SPEC.md](../SPEC.md) 的一部分。章節編號沿用 SPEC.md，文中的「§x.y」可能在 SPEC.md 或 `docs/` 的其他檔案裡（對照見 SPEC.md 開頭）。

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

用券規則的已確認與未確認事項（§10.1、§10.2）見 [planner.md](planner.md)。

### 10.3 實作時要確認的平台行為

| 項目 | 要確認的事 | 時機 |
|---|---|---|
| ~~收緊的 CSP~~ | ✅ M1（Chrome 157）：manifest 被接受；`<form>` 送出、外部 CSS、`img.dlsite.jp` 以外的圖片、對 `/home/mypage/coupon` 的 fetch 都被擋（請求沒有送出）；service worker 對白名單外路徑的 fetch 也被擋；`img.dlsite.jp` 的作品圖片可以載入（v0.9 補上正向檢查）。`pnpm verify:chrome` 重跑 | M1 |
| ~~`minimum_chrome_version`~~ | ✅ M1：manifest 被接受 | M1 |
| `storage.local` 存取層級 | ✅ M1（Chrome 157）：設定後 content script 的 `chrome.storage.local.get` 失敗（「Access to storage is not allowed from this context.」），`storage.session` 也一樣。background 記在 `storageLock` 的結果是成功。**未確認**：Chrome 120 本身（實測用 157；MDN 寫這個方法只支援 `storage.session`，必須實測）、重開瀏覽器後存取層級是否保留。v0.8 寫「每次啟動都會重設，結果不影響安全性」不成立：當時沒有 `onStartup`，瀏覽器重開後到 service worker 第一次被喚醒之前沒有人重設。v0.9 加上 `onStartup`，並在失敗時記錄、popup 顯示警告 | M1 |
| ~~開發模式 CSP~~ | ✅ M1：**會擋**。開發模式下 `connect-src` 擋住 HMR 的 `ws://localhost:3000`，`style-src 'self'` 擋住 Vite 注入的 `<style>`（樣式完全沒套用）。改成只在開發伺服器放寬（§7.1 `DEV_MANIFEST_CSP`），放寬後沒有違規；`check-manifest` 確認發佈版沒有 `'unsafe-inline'` | M1 |
| ~~`meta refresh`~~ | ✅ M1：以程式插入擴充功能頁面的 `<meta http-equiv=refresh>` **會導覽**（CSP 擋不住），lint 規則必須保留 | M1 |
| ~~`externally_connectable`~~ | ✅ M1：manifest 被接受 | M1 |
| ~~zod 4~~ | ✅ M1：popup 與 background 跑完整的解析流程，沒有任何 CSP 違規或例外。v0.9：`verify:chrome` 改成只排除刻意觸發違規的區段（以發生先後判斷，不比對訊息內容）；改了之後抓到測試自己的 `*.css` 攔截規則擋掉了 popup 本身的樣式表，已修正 | M1 |
| ~~fetch 與 User-Agent~~ | ✅ M1：在擴充功能頁面 fetch 時指定 `User-Agent`，實際送出的仍是瀏覽器的 UA（無法覆寫） | M1 |
| ~~pnpm~~ | ✅ M1：固定 `pnpm@12.21.0`。`minimumReleaseAge`、`trustPolicy: no-downgrade`、`strictDepBuilds`、`allowBuilds` 都生效（`trustPolicy` 擋下了 puppeteer → `chromium-bidi` 的信任降級，因此不使用 puppeteer） | M1 |
| content script 模組清單 | Vite plugin 的 `generateBundle` 在 WXT 的 content script 建置中能否取得 chunk 的 `modules`（§3.2.5） | M2 |
| ~~service worker 的 `location`~~ | ✅ M1：WXT 輸出的 background 裡 `globalThis instanceof ServiceWorkerGlobalScope` 為 true、`location.protocol` 是 `chrome-extension:` | M1 |
| 作品編號 | ✅ 分站（M1，2026-11-23）：`maniax`、`home`、`books`、`pro`、`soft`、`girls`、`girls-pro`、`girls-drama`、`bl`、`bl-pro`、`bl-drama`、`appx` 的作品頁網址都留在 www.dlsite.com；`comic` 轉址到 `www.comipo.app`（排除）；`aix`、`ecchi-eng` 不是作品頁；分站名稱含連字號，§3.2.2 的路徑 regex 已放寬。`maniax` 路徑能開 `home` 的作品。**未確認**：`RJ`／`RE`／`BJ`／`VJ` 之外的前綴、手機版（`touch`）作品頁的網址格式 | M1 → M2 |
| 擴充功能來源 | ✅ M1：以分頁開啟的 popup.html 送訊息時 `sender.origin` 是 `chrome-extension://<id>`、`sender.url` 以 `getURL('')` 開頭（帶 `tab`）。**未確認**：真正的 popup 視窗（headless 無法開啟）、`lookup.html`（M6 才有） | M1 → M6 |
| ~~商品 API~~ | ✅ M1（2026-11-23）：最外層是以編號為 key 的物件；**全部編號都不存在時是 `[]`**；不存在的編號直接不出現（不是 `null`、也不會整批錯誤）；沒有打折時 `campaign_id`、`discount_rate`、`discount_end_date` 不出現；`%2C` 接受。另外：`product_id` 含 `__proto__` 時回 403 HTML（WAF），`assertAllowed` 不會送出這種請求；沒有圖的作品 `work_image` 是 `//www.dlsite.com/images/web/home/no_img_main.gif`（依 §3.2.2 換成預設圖）。`RJ99999999` 是 DLsite 的測試作品（「TestWork839」），不能當作「不存在的編號」測試 | M1 |
| content script 排除路徑 | 結帳、付款、帳號設定頁與購物車頁的實際路徑，寫進 `exclude_matches` 與 `selectors.ts`；加入購物車的實際路徑，寫進打包掃描（§3.4） | M2 |
| `onMessage` 非同步回應 | `return true`＋`sendResponse` 在 service worker 冷啟動時正常；`badgeInfo` 的實際回覆時間 | M2 |
| `sender.url` | `history.pushState` 之後是否跟著改變（影響 `cartSnapshot` 的頁面檢查；每日上限仍有效） | M2 |
| service worker | 單純等待 fetch 回應是否算活動（不算就靠 §4.1 的進度寫回） | M3 |
| DLWatcher 日期 | `start`／`end` 欄位的格式與時區（§5.2）；進行中的特價，`lowestPrice.priceInfo.end` 是未來的結束時間還是最後看到的時間（§3.6 合理性檢查） | M3 |
| `storage.local.set` 多個 key | 一次寫入多個 key 是否不可分割（§4.2） | M4 |
| DLsite 圖片 | `img.dlsite.jp` 是否檢查 Referer（會擋的話，擴充功能頁面改顯示預設圖） | M5 |
| 注入 UI 的樣式 | DLsite 頁面的 CSP 是否擋住 content script 插入 closed shadow root 的 `<style>`。被擋就改用 `new CSSStyleSheet()`＋`replaceSync()`，指派給 `shadowRoot.adoptedStyleSheets`（constructable stylesheet 不受頁面 CSP 的 `style-src` 限制）；要確認在 isolated world 建立的樣式表能否指派給頁面文件裡的 shadow root | M6 |
| 右鍵選單 | `targetUrlPatterns` 實際能否比對含 `/=/` 的作品網址 | M6 |
| 未登入時的優惠券 API | content script fetch 實際拿到 HTML、`opaqueredirect`、例外，還是 200 加 `[]`；登入但沒有券時是否回傳 `[]`；content script 的請求會不會經過 DLsite 頁面自己的 service worker | M7 |
| Resource Timing | content script 的優惠券請求是否出現在頁面的 `performance.getEntriesByType('resource')`（§3.3 隱私說明） | M7 |
| WXT worker | 能否正確打包 Web Worker（不行就用 §12.2 的備案） | M8 |
| `declarativeNetRequest` | 擴充功能發起的導覽（`location.href`、`tabs.create`）的 `initiator` 是什麼，能否只擋擴充功能自己對 `/home/mypage/coupon` 的導覽，而不影響你自己手動開啟 | 第二階段 |
