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
| DLWatcher 覆蓋率 | 冷門或新作品是否查得到（查不到時只用自己的紀錄）。M3 抽查 3 件 2026 年的新作品，2 件 404 |
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
| ~~content script 模組清單~~ | ✅ M2：WXT 的 unlisted script 建置中，Vite plugin 的 `generateBundle` 取得到 chunk 的 `modules`（含每個模組的 `renderedLength`），輸出 `.output/content-modules.json` | M2 |
| ~~service worker 的 `location`~~ | ✅ M1：WXT 輸出的 background 裡 `globalThis instanceof ServiceWorkerGlobalScope` 為 true、`location.protocol` 是 `chrome-extension:` | M1 |
| 作品編號 | ✅ 分站（M1，2026-11-23）：`maniax`、`home`、`books`、`pro`、`soft`、`girls`、`girls-pro`、`girls-drama`、`bl`、`bl-pro`、`bl-drama`、`appx` 的作品頁網址都留在 www.dlsite.com；`comic` 轉址到 `www.comipo.app`（排除）；`aix`、`ecchi-eng` 不是作品頁；分站名稱含連字號，§3.2.2 的路徑 regex 已放寬。`maniax` 路徑能開 `home` 的作品。**未確認**：`RJ`／`RE`／`BJ`／`VJ` 之外的前綴、手機版（`touch`）作品頁的網址格式（M2 只確認到列表頁有 `VJ` 作品；這兩項影響作品頁徽章，移到 M6） | M1 → M6 |
| 擴充功能來源 | ✅ M1：以分頁開啟的 popup.html 送訊息時 `sender.origin` 是 `chrome-extension://<id>`、`sender.url` 以 `getURL('')` 開頭（帶 `tab`）。**未確認**：真正的 popup 視窗（headless 無法開啟）、`lookup.html`（M6 才有） | M1 → M6 |
| ~~商品 API~~ | ✅ M1（2026-11-23）：最外層是以編號為 key 的物件；**全部編號都不存在時是 `[]`**；不存在的編號直接不出現（不是 `null`、也不會整批錯誤）；沒有打折時 `campaign_id`、`discount_rate`、`discount_end_date` 不出現；`%2C` 接受。另外：`product_id` 含 `__proto__` 時回 403 HTML（WAF），`assertAllowed` 不會送出這種請求；沒有圖的作品 `work_image` 是 `//www.dlsite.com/images/web/home/no_img_main.gif`（依 §3.2.2 換成預設圖）。`RJ99999999` 是 DLsite 的測試作品（「TestWork839」），不能當作「不存在的編號」測試 | M1 |
| ~~content script 排除路徑~~ | ✅ M2（2026-11-23，未登入）：立即購買 `/<分站>/pay/member/=/relayout/cart/buynow/…`、マイページ `/<分站>/mypage/…`、登入 `/<分站>/login/…`、註冊 `/<分站>/regist/user`，寫進 `exclude_matches`（v0.11 起結尾不要求斜線，見 §3.2.5）；購物車頁 `/<分站>/cart/`（各分站共用），作品是 `ul.cart_list > li.cart_list_item[data-product-id]`（推薦區也有 `data-product_id`，不能用）；加入購物車：列表頁 `a.btn_cart[href="/<分站>/cart/=/product_id/<ID>.html"]`（GET）、作品頁 `button.btn_cart[data-ga4-ref="cart_add"]`（沒有 href，送 `POST /api/cart/<分站>/add`），寫進 `selectors.ts` 與打包掃描。`verify:m2` 確認 9 個排除網址（`/home/mypage`、`/home/mypage/`、`/home/mypage/setting`、`/home/pay`、立即購買、`/home/login`、`/home/login/=/…`、`/home/regist`、`/home/regist/user`）都沒有注入 content script（v0.10 只測了 2 個，`/home/mypage` 這種沒有結尾斜線的其實沒擋到）。**未確認**：登入後才出現的帳號頁路徑、從購物車頁按「購入手続きへ」（表單 POST 到 `/<分站>/cart`）之後的付款頁網址 | M2 |
| `onMessage` 非同步回應 | ✅ M2：用 `ServiceWorker.stopAllWorkers` 停掉 service worker 後，content script 的 `cartSnapshot` 會喚醒它並正常處理（`return true`＋`sendResponse`）。**未確認**：`badgeInfo` 的實際回覆時間（M6 才有徽章） | M2 → M6 |
| ~~`sender.url`~~ | ✅ M2（Chrome 157）：頁面 `history.pushState` 到 `/home/cart/` 之後，content script 送的訊息 `sender.url` 仍是文件載入時的網址（不會改變），頁面無法讓 `cartSnapshot` 的頁面檢查誤判。v0.11 起 `verify:m2` 把它當成檢查項目（v0.10 只印出來） | M2 |
| service worker | ✅ M3（Chrome 157，2026-11-23）：用 CDP 在瀏覽器層級攔住 DLWatcher 請求、不附加到 service worker、清掉 `drain` alarm，請求 75 秒沒有回應時 service worker **沒有**被終止。Chrome 文件寫「fetch 回應超過 30 秒」可能被終止，所以設計不依賴這個行為：`apiGet` 30 秒逾時、處理中一直有 `drain` alarm、進度每一步寫回（§3.1、§4.1）。`verify:m3` 確認：處理到第 3/10 件時 `stopAllWorkers`，`drain` alarm 叫醒後從中斷處做完、每件只請求一次；一直不回應的請求 30 秒後放棄、約 90 秒後重試並存好（v0.14 起瀏覽器層級攔截不到時這一項算失敗，不會什麼都沒測就顯示成功） | M3 |
| ~~DLWatcher 日期~~ | ✅ M3（2026-11-23）：`toISOString()` 格式的 UTC 字串；欄位在 `lowestPrice.start／end`（不在 `priceInfo` 裡）；進行中的特價，`end` 是**最後一次看到這個價格的時間**（不是未來的結束時間）。走勢點 `x`、`y` 是字串；不存在的作品回 404 HTML（§5.2） | M3 |
| `storage.local.set` 多個 key | 一次寫入多個 key 是否不可分割（§4.2） | M4 |
| DLsite 圖片 | ✅（popup，Chrome 157）：擴充功能頁面以 `referrerPolicy="no-referrer"` 載入 `img.dlsite.jp` 的作品圖片成功（`verify:chrome`）。**未確認**：儀表板大量載入時是否被限流 | M5 |
| 注入 UI 的樣式 | DLsite 頁面的 CSP 是否擋住 content script 插入 closed shadow root 的 `<style>`。被擋就改用 `new CSSStyleSheet()`＋`replaceSync()`，指派給 `shadowRoot.adoptedStyleSheets`（constructable stylesheet 不受頁面 CSP 的 `style-src` 限制）；要確認在 isolated world 建立的樣式表能否指派給頁面文件裡的 shadow root | M6 |
| 右鍵選單 | `targetUrlPatterns` 實際能否比對含 `/=/` 的作品網址 | M6 |
| 未登入時的優惠券 API | content script fetch 實際拿到 HTML、`opaqueredirect`、例外，還是 200 加 `[]`；登入但沒有券時是否回傳 `[]`；content script 的請求會不會經過 DLsite 頁面自己的 service worker | M7 |
| Resource Timing | content script 的優惠券請求是否出現在頁面的 `performance.getEntriesByType('resource')`（§3.3 隱私說明） | M7 |
| WXT worker | 能否正確打包 Web Worker（不行就用 §12.2 的備案） | M8 |
| `declarativeNetRequest` | 擴充功能發起的導覽（`location.href`、`tabs.create`）的 `initiator` 是什麼，能否只擋擴充功能自己對 `/home/mypage/coupon` 的導覽，而不影響你自己手動開啟 | 第二階段 |
| ~~CDP 附加 service worker（實機驗證工具）~~ | ✅（Chrome 158.0.8127.37 headless，2026-11-24，探測腳本 5 次）：`Extensions.loadUnpacked` 回傳時，擴充功能的 service worker target 可能還沒出現（約 30～50 毫秒後才有 `Target.targetCreated`）；附加後第一次 `Runtime.evaluate` 每次都是 `ReferenceError: chrome is not defined`，約 50～100 毫秒後才有 `chrome.storage`。附加中的 service worker 被 `ServiceWorker.stopAllWorkers` 停止時，target 從 `Target.getTargets` 消失，但**沒有** `Target.targetDestroyed`，也沒有 `Target.detachedFromTarget`；送到那個 session 的指令（已送出的和之後送的）一直沒有回應，也沒有錯誤。`verify:*` 偶爾沒有輸出、一直不結束，最可能就是這個原因（附加的 service worker 在指令進行中被停止或替換）。因此 `tests/e2e/cdp.ts` 改成：每個指令都有逾時（預設 60 秒，可用 `CDP_TIMEOUT_MS` 調整）；送到 session 的指令等超過 3 秒，就用 `Target.getTargets` 確認 target 還在；`attachServiceWorker()` 重試到 `chrome.storage.local` 可以用才回傳；每支腳本有整體時間上限（`VERIFY_TIMEOUT_MS`）。**未確認**：原本那兩次卡住都沒有重現（m2 舊版連跑 10 次、新版 11 次，m1、m3、m4 新版各 3～6 次，全部通過），所以 m1 卡在哪一個指令、m2 為什麼完全沒有輸出，都還不確定 | 實機驗證工具 |
