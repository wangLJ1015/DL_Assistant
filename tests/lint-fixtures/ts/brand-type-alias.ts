// @lint-as: src/lib/fixture.ts
// @expect: no-restricted-syntax
import type { DlsiteNavUrl } from './nav';
type U = DlsiteNavUrl;
export const u = 'https://www.dlsite.com/home/mypage/coupon' as U;
