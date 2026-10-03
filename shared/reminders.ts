export const MAX_REMINDERS = 8;
const DAY_MS = 86_400_000;

export interface ReminderInput {
  now: Date;
  dueDate: Date | null;
  /** Reminders already sent (the first "initial" email does not count). */
  sent: number;
}

/**
 * When to nudge next. Every 3 days by default, every 2 days in the last week,
 * daily in the last 2 days and after the due date. Stops after MAX_REMINDERS.
 */
export function nextReminderAt({ now, dueDate, sent }: ReminderInput): Date | null {
  if (sent >= MAX_REMINDERS) return null;
  let days = 3;
  if (dueDate) {
    const daysLeft = Math.ceil((dueDate.getTime() - now.getTime()) / DAY_MS);
    if (daysLeft <= 2) days = 1;
    else if (daysLeft <= 7) days = 2;
  }
  return new Date(now.getTime() + days * DAY_MS);
}
