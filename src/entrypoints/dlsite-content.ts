import '../lib/zod-setup';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

// content script（manifest 的 content_scripts 在 wxt.config.ts 註冊）。
//
// 刻意不用 WXT 的 defineContentScript：它的 ContentScriptContext 會對頁面 document 派送 CustomEvent、
// 呼叫 window.postMessage(..., '*')（事件名稱含擴充功能 ID），並監聽頁面上的同名事件——
// 頁面腳本因此能得知擴充功能 ID，也能派送假事件讓 content script 自我停用（違反 §3.2.4）。
// unlisted script 的包裝層只呼叫 main()。
//
// M1：只有骨架，用來確認 storage.local 對 content script 已鎖住（§4.2、§10.3）。
// 加入購物車偵測、購物車同步在 M2；徽章在 M6；優惠券同步在 M7。
export default defineUnlistedScript(() => {});
