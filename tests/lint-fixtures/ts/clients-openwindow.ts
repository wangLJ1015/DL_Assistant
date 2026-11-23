// @lint-as: src/lib/fixture.ts
// @expect: no-restricted-syntax
declare const clients: { openWindow(u: string): void };
clients.openWindow('https://example.com/');
