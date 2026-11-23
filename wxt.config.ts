import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import {
  CONTENT_SCRIPT_EXCLUDE_MATCHES,
  CONTENT_SCRIPT_FILE,
  CONTENT_SCRIPT_MATCHES,
  CONTENT_SCRIPT_RUN_AT,
  DEV_MANIFEST_CSP,
  MANIFEST_CSP,
  MANIFEST_HOST_PERMISSIONS,
  MANIFEST_PERMISSIONS,
} from './scripts/manifest-policy.ts';
import { contentModulesPlugin } from './scripts/content-modules-plugin.ts';

// §7.1 Manifest。CSP、權限的唯一來源是 scripts/manifest-policy.ts，check-manifest 用同一份比對輸出。
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  // 關閉自動 import：每個檔案的 import 都要寫出來，content script 的 import 白名單（§3.2.5）才檢查得到。
  imports: false,
  manifest: ({ command }) => ({
    name: 'DL_Assistant',
    description: 'DLsite 購物車作品自動追蹤、史低查詢與優惠通知',
    minimum_chrome_version: '120',
    permissions: [...MANIFEST_PERMISSIONS],
    host_permissions: [...MANIFEST_HOST_PERMISSIONS],
    content_security_policy: {
      // 開發伺服器（command === 'serve'）才放寬，理由見 manifest-policy.ts 的 DEV_MANIFEST_CSP。
      extension_pages: command === 'serve' ? DEV_MANIFEST_CSP : MANIFEST_CSP,
    },
    externally_connectable: { ids: [], matches: [] },
    // content script 用 unlisted script 打包（理由見 src/entrypoints/dlsite-content.ts），在這裡註冊。
    content_scripts: [
      {
        matches: [...CONTENT_SCRIPT_MATCHES],
        exclude_matches: [...CONTENT_SCRIPT_EXCLUDE_MATCHES],
        js: [CONTENT_SCRIPT_FILE],
        all_frames: false,
        // document_start：頁面還沒有任何元素時先取出 chrome.runtime（之後頁面能用 <form id="chrome"> 蓋掉 chrome，
        // M2 審查後實測），DOM 相關的工作等 DOMContentLoaded 才開始（src/entrypoints/dlsite-content.ts）。
        run_at: CONTENT_SCRIPT_RUN_AT,
      },
    ],
  }),
  // Chrome 137 起正式版不支援 --load-extension，WXT 的自動開啟瀏覽器無法載入擴充功能。
  // 開發時到 chrome://extensions 手動「載入未封裝項目」選 .output/chrome-mv3-dev。
  webExt: { disabled: true },
  vite: () => ({
    plugins: [tailwindcss(), contentModulesPlugin()],
  }),
});
