# DL_Assistant

DLsite 購物車作品自動追蹤、史低查詢與優惠通知的 Chrome 擴充功能。規格見 [SPEC.md](SPEC.md)。

## 開發

需要 Node 22.18 以上。pnpm 版本固定在 `package.json` 的 `packageManager`；本機沒有 pnpm 時，下面的指令都改成 `corepack pnpm …`。

```sh
pnpm install --frozen-lockfile
pnpm check:all       # lint、型別檢查、單元測試、正式建置、manifest 檢查
pnpm verify:chrome   # 用本機 Chrome 實機驗證（先 pnpm build；臨時 profile，會呼叫一次 DLsite 商品 API 與一次 DLWatcher）
pnpm verify:m2       # M2：自動追蹤的實機驗證（先 pnpm build；DLsite 頁面全部是假的，不發出對外請求）
pnpm verify:m3       # M3：史低、查價佇列與 service worker 中途終止的實機驗證（先 pnpm build；約 4 分鐘，不發出對外請求）
pnpm dev             # 開發伺服器；到 chrome://extensions 載入 .output/chrome-mv3-dev
```

正式版在 `.output/chrome-mv3`（`pnpm build`）。開發版的 CSP 有放寬，不能拿去發佈。
