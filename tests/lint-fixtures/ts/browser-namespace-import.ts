// @lint-as: src/lib/fixture.ts
// @expect: no-restricted-syntax
import * as w from 'wxt/browser';
void w.browser.tabs.create({ url: 'https://example.com/' });
