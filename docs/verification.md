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
| 收緊的 CSP | §7.1 的整條 `extension_pages` CSP（`default-src`、`form-action`、路徑限定的 `connect-src`、`object-src 'none'`）是否被 Chrome 接受並生效：測試頁的 `<form>` 送出、外部 CSS、對 `/home/mypage/coupon` 的 fetch 都要被擋。（是否也約束 service worker：文件已確認會） | M1 |
| `minimum_chrome_version` | manifest 被接受 | M1 |
| `storage.local` 存取層級 | `setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` 在 Chrome 120 對 `storage.local` 有效，設定後 content script 呼叫 `chrome.storage.local.get` 會失敗；重開瀏覽器後是否保留（不論結果都每次啟動重設）（§4.2） | M1 |
| 開發模式 CSP | WXT 開發模式下 §7.1 的 `style-src 'self'` 是否擋住 HMR 的樣式；若會，只在開發模式放寬，`check-manifest` 確認發佈版沒有 `'unsafe-inline'` | M1 |
| `meta refresh` | 以程式插入擴充功能頁面的 `<meta http-equiv=refresh>` 會不會導覽（不論結果都保留 lint 規則） | M1 |
| `externally_connectable` | 文件已確認留空代表沒有任何連線；M1 只確認 manifest 被接受 | M1 |
| zod 4 | ✅ 原始碼已確認有 `jitless`，第一次 parse 之前呼叫即可（§7.2）；M1 只確認沒有 CSP 違規 | M1 |
| fetch 與 User-Agent | 確認 fetch 無法覆寫 User-Agent（只是確認，規格已不自訂） | M1 |
| pnpm | 固定 11 或 12（12 是目前的主版本）；各設定的最低支援版本；`trustPolicy` 預設是 `off`，要明確設定 | M1 |
| content script 模組清單 | Vite plugin 的 `generateBundle` 在 WXT 的 content script 建置中能否取得 chunk 的 `modules`（§3.2.5） | M2 |
| service worker 的 `location` | `ServiceWorkerGlobalScope` 與 `location.protocol` 的檢查在 WXT 輸出的 background 裡成立（§3.4） | M1 |
| 作品編號 | 前綴清單（`RJ`、`RE`、`BJ`、`VJ` 之外還有哪些）、分站列舉值的完整清單；用 `maniax` 路徑組作品頁網址是否都能開；手機版（`touch`）作品頁的網址格式（若含連字號，§3.2.2 的路徑 regex 與分站列舉值一起調整） | M1 |
| 擴充功能來源 | 在 Chrome 裡 popup、分頁中的儀表板、`lookup.html` 送訊息時 `sender.origin` 是否都是 `chrome-extension://<id>` | M1 |
| 商品 API | 回應最外層是以編號為 key 的物件還是陣列；沒有活動時 `campaign_id` 是 `null`、空字串還是不出現；不存在或已刪除的編號是不出現、`null` 還是整批錯誤（整批錯誤時用 §4.1 的拆半重試）；`product_id` 的逗號編碼成 `%2C` 是否接受 | M1 |
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
