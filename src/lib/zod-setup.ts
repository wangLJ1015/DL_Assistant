// §7.2：只做這件事。每個進入點的第一個 import 必須是這個檔案，
// 讓 zod 在第一次 parse 之前就關掉 JIT（JIT 會用 new Function，被擴充功能的 CSP 擋下）。
import { z } from 'zod';

z.config({ jitless: true });
