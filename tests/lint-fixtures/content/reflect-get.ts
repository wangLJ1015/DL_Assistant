// @lint-as: src/content/fixture.ts
// @expect: no-restricted-globals
export const s = Reflect.get(chrome, 'stor' + 'age');
