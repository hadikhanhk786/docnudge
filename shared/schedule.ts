import type { Region } from './packs';

// UTC hours during which reminder emails may go out (roughly 9am-6pm for the firm's region).
// Rough on purpose: store a client time zone later if you need better than this.
export const SEND_WINDOWS: Record<Region, [startHour: number, endHour: number]> = {
  ae: [5, 14], // 09:00-18:00 Gulf time (UTC+4)
  au: [23, 8], // ~09:00-18:00 Australian Eastern time (UTC+10), wraps past midnight
  us: [15, 23], // ~10:00-18:00 US Eastern / 07:00-15:00 US Pacific
};

export function inSendWindow(region: Region, now: Date = new Date()): boolean {
  const [start, end] = SEND_WINDOWS[region];
  const h = now.getUTCHours();
  return start <= end ? h >= start && h < end : h >= start || h < end;
}
