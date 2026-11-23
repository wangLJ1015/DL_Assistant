// @lint-as: src/lib/fixture.ts
// @expect: no-restricted-syntax
void globalThis.chrome.tabs.create({ url: 'https://example.com/' });
