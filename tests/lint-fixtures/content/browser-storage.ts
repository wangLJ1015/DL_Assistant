// @lint-as: src/entrypoints/dlsite-content.ts
// @expect: no-restricted-syntax
import { browser } from 'wxt/browser';
void browser.storage.local.get(null);
