// @lint-as: src/content/fixture.ts
// @expect: no-restricted-syntax
export function f(style: HTMLStyleElement, u: string) {
  style.textContent = `@import "${u}";`;
}
