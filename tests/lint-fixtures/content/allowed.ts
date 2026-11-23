// @lint-as: src/entrypoints/dlsite-content.ts
// @expect: none
import '../lib/zod-setup';
import { z } from 'zod';
import { isWorkId } from '../lib/ids';
import { parseJst } from '../lib/dates';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
export default [z, isWorkId, parseJst, defineUnlistedScript];
export const el = document.createElement('div');
el.setAttribute('aria-label', 'x');
el.replaceChildren();
