// @lint-as: src/lib/fixture.ts
// @expect: no-restricted-syntax
import { browser } from 'wxt/browser';
void browser.tabs.create({ url: 'https://example.com/' });
