// @lint-as: src/lib/fixture.ts
// @expect: no-restricted-syntax
import { z as zz } from 'zod';
export const n = zz.coerce.number();
