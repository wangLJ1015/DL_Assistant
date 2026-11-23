// @lint-as: src/entrypoints/popup/Fixture.tsx
// @expect: react/forbid-elements
export const X = () => <meta httpEquiv="refresh" content="0;url=https://example.com/" />;
