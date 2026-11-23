// @lint-as: src/lib/fixture.ts
// @expect: no-restricted-syntax
void chrome['tabs'].create({ url: 'https://example.com/' });
