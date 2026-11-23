// @lint-as: src/content/fixture.ts
// @expect: none
export function f(el: HTMLElement, items: string[], key: number) {
  el.textContent = 'hello';
  el.addEventListener('click', () => undefined);
  return [items[0], items[key]];
}
