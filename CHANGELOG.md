# DL_Assistant 規格變更紀錄

- v0.8 變更：M1 實作與實測後更新。重點：content script 改用 WXT 的 `defineUnlistedScript`（`dlsite-content.ts`），因為 `defineContentScript` 的包裝層會對頁面派送 `CustomEvent`、`postMessage` 並監聽頁面事件（§3.2.5）；content script 的 import 白名單補上 `lib/schema.ts`、`lib/badge-style.ts`；分站列舉值確定（排除會轉址到站外的 `comic`），網址路徑 regex 允許分站名稱含連字號（§3.2.2）；開發模式 CSP 會擋住 HMR，只在開發伺服器放寬（§7.1）；固定 `pnpm@12.21.0`（§7.2）；商品 API 的回應形狀與 §10.3 的 M1 項目寫入實測結果。
- v0.7 變更：依 `SPEC_REVIEW_v0.6.md`（第四輪審查）修正。重點：`storage.local` 鎖住不讓 content script 存取（§4.2）；導覽防線改稱「降低機率」並擴大規則，lint 範例檔寫明對應規則（§3.4）；content script 的 DOM 寫法規則（§3.2.5）；訊息的參數驗證、回覆形狀與頻率上限（§3.2.4）；`onSale` 加上 `available`、查不到時保留 `episode`、暫停恢復不誤發（§6）；一批一次寫入再送合併通知（§4.2）；「折扣又加深」與匯入移到第二階段、`ending` 簡化；規格拆成 `SPEC.md`、`docs/security.md`、`docs/planner.md`、`docs/verification.md` 與本檔。
- v0.6 變更：依 `SPEC_REVIEW_v0.5.md`（第三輪審查）修正。重點：導覽改成品牌型別＋連結元件＋擴大的語法規則＋打包掃描＋規則自我測試（§3.4）；content script 最小化、不用 React（§3.2.5）；商品 API 與 DLWatcher 只由 background 呼叫，列出完整訊息清單（§3.2.4）；新增 `Settings` 與 storage key 一覽（§5.3）；CSP 加上 `default-src`、`form-action` 並把 `connect-src` 寫到路徑（§7.1）；通知改寫成有順序的處理步驟（§6.1）；`priceLog`、優惠券同步、DLWatcher 合理性檢查的邊界修正；刪掉試算捷徑與優惠券管理頁的導覽常數。
- v0.5 變更：依 `SPEC_REVIEW_v0.4.md`（第二輪審查）修正。重點：試算的「到期分數」改成只有用掉一次性券才計成本，避免拆單（§12.2）；導覽與注入 UI 的資源載入也納入帶 cookie 的 GET 管制（§3.4）；補年份改成三個候選取最接近（§5.5）；通知規則表加上條件欄、修正空字串與連續活動（§6）；`priceLog` 遇到查價空白就新增一筆（§5.3）；徽章不主動發請求（§3.5）；空的優惠券回應不清空本機資料（§5.4）。試算 v1 上限 15 件，近似解移到第二階段。
- v0.4 變更：依 `SPEC_REVIEW.md` 的審查意見修正。重點：試算演算法把可重複使用與限次的券分開計算（§12.2）；外部資料只當純文字、URL 一律由程式自己組（§3.2）；對外請求只能透過唯一的包裝函式，路徑完全比對（§3.4）；新增訊息白名單（§3.2.4）、日期解析規則（§5.5）、背景工作（§4.1）、匯入規則（§3.7）；通知改成狀態轉換才發（§6）；清掉章節之間的矛盾。
- v0.3 變更：依 DLsite 官方說明與實測的優惠券 API 確認用券規則（§5.4、§10.1、§10.2）；演算法改為支援可重複使用的券；新增「會改變帳號狀態的 GET 網址」白名單規則（§3.4）。
- v0.2 變更：新增「臨時查史低」（F12～F13）、「優惠券同步」（F14）、「購買試算」（F15～F16）與 §12 試算演算法。
