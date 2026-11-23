// @lint-as: src/entrypoints/popup/Fixture.tsx
// @expect: react/forbid-elements
import React from 'react';
export const X = () => React.createElement('a', { href: 'https://example.com/' });
