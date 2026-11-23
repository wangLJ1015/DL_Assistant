// @lint-as: src/lib/fixture.ts
// @expect: no-restricted-syntax
chrome.runtime['onMessageExternal'].addListener(() => undefined);
