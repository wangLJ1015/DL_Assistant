// @lint-as: src/entrypoints/dlsite-content.ts
// @expect: none
import { browser } from 'wxt/browser';
void browser.runtime.sendMessage({ type: 'cartClicked', id: 'RJ01014447' });
