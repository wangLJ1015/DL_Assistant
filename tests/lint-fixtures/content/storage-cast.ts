// @lint-as: src/content/fixture.ts
// @expect: no-restricted-syntax
type S = { storage: { sync: { get(k: null): Promise<unknown> } } };
void (chrome as unknown as S).storage.sync.get(null);
