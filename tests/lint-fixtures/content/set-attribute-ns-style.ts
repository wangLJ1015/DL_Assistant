// @lint-as: src/content/fixture.ts
// @expect: no-restricted-syntax
export function f(el: Element, s: string) {
  el.setAttributeNS(null, 'style', s);
}
