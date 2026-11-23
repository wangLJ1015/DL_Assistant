// @lint-as: src/lib/fixture.ts
// @expect: no-restricted-syntax
import type { DlsiteNavUrl } from './nav';
export const u = 'https://www.dlsite.com/home/mypage/coupon' as DlsiteNavUrl | DlsiteNavUrl;
