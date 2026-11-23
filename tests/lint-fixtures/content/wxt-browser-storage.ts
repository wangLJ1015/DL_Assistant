// @lint-as: src/content/fixture.ts
// @expect: no-restricted-imports
import { browser } from 'wxt/browser';
void browser.storage.local.get(null);
