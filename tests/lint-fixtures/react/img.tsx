// @lint-as: src/entrypoints/popup/Fixture.tsx
// @expect: react/forbid-elements
export const I = ({ u }: { u: string }) => <img src={u} alt="" />;
