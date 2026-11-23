// @lint-as: src/content/fixture.ts
// @expect: no-restricted-syntax
export function f(el: Element, name: string) {
  el.setAttributeNS(null, name, 'x');
}
