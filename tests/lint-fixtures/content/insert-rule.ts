// @lint-as: src/content/fixture.ts
// @expect: no-restricted-syntax
export function f(s: CSSStyleSheet, r: string) {
  s.insertRule(r);
}
