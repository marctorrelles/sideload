// worker/test/csv.test.ts
import { it, expect } from 'vitest';
import { toCsv } from '../src/csv';
it('quotes commas, quotes and newlines; BOM for Excel', () => {
  expect(toCsv([['a', 'b'], ['x,y', 'say "hi"\nnow']])).toBe('﻿' + 'a,b\r\n"x,y","say ""hi""\nnow"\r\n');
});
