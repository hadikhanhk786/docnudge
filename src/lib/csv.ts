import type { RequestRow } from './types';

/** Quote a CSV field; prefix formula-looking text with ' so spreadsheets do not run it. */
function field(v: string | number | null): string {
  let s = v === null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function requestsToCsv(rows: RequestRow[]): string {
  const head = ['client', 'email', 'title', 'status', 'due_date', 'required_done', 'required_total', 'reminders_sent', 'created'];
  const lines = rows.map((r) =>
    [r.client_name, r.client_email, r.title, r.status, r.due_date, r.required_done ?? 0, r.required_total ?? 0, r.reminders_sent, r.created_at.slice(0, 10)]
      .map(field)
      .join(','),
  );
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}

export function downloadCsv(name: string, csv: string): void {
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
