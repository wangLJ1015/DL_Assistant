// @lint-as: src/components/WorkImage.tsx
// @expect: react/forbid-elements
export const I = ({ u }: { u: string }) => <a href={u}>x</a>;
