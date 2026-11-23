// @lint-as: src/lib/fixture.ts
// @expect: no-restricted-syntax
import { browser } from 'wxt/browser';
browser.runtime.onConnectExternal.addListener(() => undefined);
