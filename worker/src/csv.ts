// worker/src/csv.ts
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n'; // BOM so Excel opens UTF-8 correctly
}
