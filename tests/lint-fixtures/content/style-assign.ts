// @lint-as: src/content/fixture.ts
// @expect: no-restricted-syntax
export function f(el: { style: string }, s: string) {
  el.style = s;
}
