export function analyticsDateKey(date: Date, timezone = 'Asia/Bangkok'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function boundedAnalyticsRange(startDate: string, endDate: string, maxDays = 31) {
  const start = new Date(`${startDate}T00:00:00+07:00`);
  const end = new Date(`${endDate}T23:59:59.999+07:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) throw new Error('INVALID_ANALYTICS_RANGE');
  const days = Math.ceil((end.getTime() - start.getTime()) / 86400000);
  if (days > maxDays) throw new Error('ANALYTICS_RANGE_TOO_LARGE');
  return { start, end, days };
}

export interface ContributionState {
  createdCounted: boolean;
  completedCounted: boolean;
}

export function analyticsContributionDelta(
  previous: ContributionState,
  event: { created: boolean; completed: boolean },
) {
  return {
    created: event.created && !previous.createdCounted ? 1 : 0,
    completed: event.completed && !previous.completedCounted ? 1 : 0,
    next: {
      createdCounted: previous.createdCounted || event.created,
      completedCounted: previous.completedCounted || event.completed,
    },
  };
}

export function protectCsvFormula(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}
