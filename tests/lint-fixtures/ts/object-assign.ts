// @lint-as: src/lib/fixture.ts
// @expect: no-restricted-properties
export const merge = (a: object, b: unknown) => Object.assign(a, b);
