// @lint-as: src/content/fixture.ts
// @expect: no-restricted-syntax
export function f(el: Element) {
  const a = document.createAttribute('style');
  el.setAttributeNode(a);
}
