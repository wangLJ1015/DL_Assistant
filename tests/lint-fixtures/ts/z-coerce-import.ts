// @lint-as: src/lib/fixture.ts
// @expect: no-restricted-syntax
import { coerce } from 'zod';
export const n = coerce.number();
