// @lint-as: src/lib/fixture.ts
// @expect: no-restricted-syntax
import { z } from 'zod';
export const s = z.coerce.number();
