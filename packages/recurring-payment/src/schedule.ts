// Schedule math for recurring payments: when the next run is
// due, how many due times were missed, and how the order advances after a
// run. Pure and storage-agnostic; the engine and the UI build on it.
//
// Due times are anchor + n intervals evaluated in the order's own time zone,
// never "last run + interval": a month-end anchor then clamps to each month's
// last day instead of drifting earlier, and a day/week step keeps its wall
// clock across DST changes.

export const RECURRING_INTERVAL_UNITS = [
  "hour",
  "day",
  "week",
  "month",
] as const;
export type RecurringIntervalUnit = (typeof RECURRING_INTERVAL_UNITS)[number];

export interface RecurringInterval {
  unit: RecurringIntervalUnit;
  count: number;
}

/** Shortest allowed interval; also the finest unit, so "1 hour" is the floor. */
export const MIN_RECURRING_INTERVAL_SEC = 60 * 60;
export const MAX_RECURRING_INTERVAL_COUNT = 999;

export const isRecurringIntervalUnit = (
  value: unknown,
): value is RecurringIntervalUnit =>
  typeof value === "string" &&
  RECURRING_INTERVAL_UNITS.some((unit) => unit === value);

export const isValidRecurringInterval = (
  interval: RecurringInterval,
): boolean =>
  isRecurringIntervalUnit(interval.unit) &&
  Number.isInteger(interval.count) &&
  interval.count >= 1 &&
  interval.count <= MAX_RECURRING_INTERVAL_COUNT &&
  approximateIntervalSeconds(interval) >= MIN_RECURRING_INTERVAL_SEC;

const APPROXIMATE_UNIT_SECONDS: Record<RecurringIntervalUnit, number> = {
  hour: 60 * 60,
  day: 24 * 60 * 60,
  week: 7 * 24 * 60 * 60,
  month: 30 * 24 * 60 * 60,
};

/** Rough length used only to estimate an occurrence index; never for due times. */
export const approximateIntervalSeconds = (
  interval: RecurringInterval,
): number => APPROXIMATE_UNIT_SECONDS[interval.unit] * interval.count;

export const currentTimeZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The stored zone when this device knows it, otherwise the device's own. */
export const resolveTimeZone = (timeZone: string | null): string => {
  if (timeZone !== null) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
      return timeZone;
    } catch {
      // unknown or malformed zone name
    }
  }
  return currentTimeZone();
};

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const wallClockFormatters = new Map<string, Intl.DateTimeFormat>();

const wallClockFormatter = (timeZone: string): Intl.DateTimeFormat => {
  const cached = wallClockFormatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  wallClockFormatters.set(timeZone, formatter);
  return formatter;
};

const wallClockAt = (epochSec: number, timeZone: string): WallClock => {
  const parts: Record<string, number> = {};
  for (const part of wallClockFormatter(timeZone).formatToParts(
    new Date(epochSec * 1000),
  )) {
    if (part.type === "literal") continue;
    parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 1970,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
};

const wallClockAsUtcSeconds = (clock: WallClock): number =>
  Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
  ) / 1000;

// Converts a wall clock back to an instant. The zone offset is read at a first
// guess and re-checked once; a wall clock inside a DST gap resolves to the
// instant after the gap, an ambiguous one to the offset in force after the
// transition (the later instant).
const epochFromWallClock = (clock: WallClock, timeZone: string): number => {
  const asUtc = wallClockAsUtcSeconds(clock);
  const offsetAt = (epochSec: number): number =>
    wallClockAsUtcSeconds(wallClockAt(epochSec, timeZone)) - epochSec;
  const first = asUtc - offsetAt(asUtc);
  const second = asUtc - offsetAt(first);
  if (first === second) return first;
  const candidates = [first, second].filter(
    (epochSec) =>
      wallClockAsUtcSeconds(wallClockAt(epochSec, timeZone)) === asUtc,
  );
  if (candidates.length > 0) return Math.min(...candidates);
  return Math.max(first, second);
};

const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const shiftWallClock = (
  clock: WallClock,
  interval: RecurringInterval,
  occurrence: number,
): WallClock => {
  const steps = interval.count * occurrence;
  switch (interval.unit) {
    case "hour":
      throw new Error(
        "hour steps are added to the instant, not the wall clock",
      );
    case "day":
    case "week": {
      const days = interval.unit === "week" ? steps * 7 : steps;
      const shifted = new Date(
        Date.UTC(clock.year, clock.month - 1, clock.day + days),
      );
      return {
        ...clock,
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
      };
    }
    case "month": {
      const monthIndex = clock.year * 12 + (clock.month - 1) + steps;
      const year = Math.floor(monthIndex / 12);
      const month = monthIndex - year * 12 + 1;
      return {
        ...clock,
        year,
        month,
        day: Math.min(clock.day, daysInMonth(year, month)),
      };
    }
  }
};

/** Due time of the n-th occurrence (n = 0 is the anchor itself). */
export const recurringDueAt = (
  anchorAtSec: number,
  interval: RecurringInterval,
  occurrence: number,
  timeZone: string,
): number => {
  if (interval.unit === "hour") {
    return anchorAtSec + occurrence * interval.count * 60 * 60;
  }
  return epochFromWallClock(
    shiftWallClock(wallClockAt(anchorAtSec, timeZone), interval, occurrence),
    timeZone,
  );
};

export interface RecurringOccurrence {
  occurrence: number;
  dueAtSec: number;
}

/** First occurrence whose due time is strictly after `afterSec`. */
export const nextRecurringOccurrenceAfter = (
  anchorAtSec: number,
  interval: RecurringInterval,
  afterSec: number,
  timeZone: string,
): RecurringOccurrence => {
  const estimate = Math.floor(
    (afterSec - anchorAtSec) / approximateIntervalSeconds(interval),
  );
  let occurrence = Math.max(0, estimate - 2);
  while (
    occurrence > 0 &&
    recurringDueAt(anchorAtSec, interval, occurrence - 1, timeZone) > afterSec
  ) {
    occurrence -= 1;
  }
  while (
    recurringDueAt(anchorAtSec, interval, occurrence, timeZone) <= afterSec
  ) {
    occurrence += 1;
  }
  return {
    occurrence,
    dueAtSec: recurringDueAt(anchorAtSec, interval, occurrence, timeZone),
  };
};

export interface RecurringScheduleState {
  anchorAtSec: number;
  interval: RecurringInterval;
  timeZone: string | null;
  nextDueAtSec: number;
  runCount: number;
  pausedAtSec: number | null;
}

/** First due time strictly after `afterSec` on the schedule's own grid. */
export const nextDueAfter = (
  schedule: Pick<
    RecurringScheduleState,
    "anchorAtSec" | "interval" | "timeZone"
  >,
  afterSec: number,
): number =>
  nextRecurringOccurrenceAfter(
    schedule.anchorAtSec,
    schedule.interval,
    afterSec,
    resolveTimeZone(schedule.timeZone),
  ).dueAtSec;

export type RecurringScheduleDecision =
  | { kind: "paused" }
  | { kind: "wait"; untilSec: number }
  | { kind: "due"; dueAtSec: number; missedCount: number };

/**
 * What the engine should do with an order at `nowSec`. A due order is paid
 * once however many due times passed while Linky was closed; `missedCount`
 * tells how many were skipped so the run can say so.
 */
export const decideRecurringRun = (
  state: RecurringScheduleState,
  nowSec: number,
): RecurringScheduleDecision => {
  if (state.pausedAtSec !== null) return { kind: "paused" };
  if (nowSec < state.nextDueAtSec) {
    return { kind: "wait", untilSec: state.nextDueAtSec };
  }
  const timeZone = resolveTimeZone(state.timeZone);
  const dueIndex = nextRecurringOccurrenceAfter(
    state.anchorAtSec,
    state.interval,
    state.nextDueAtSec - 1,
    timeZone,
  ).occurrence;
  const nextIndex = nextRecurringOccurrenceAfter(
    state.anchorAtSec,
    state.interval,
    nowSec,
    timeZone,
  ).occurrence;
  return {
    kind: "due",
    dueAtSec: state.nextDueAtSec,
    missedCount: Math.max(0, nextIndex - dueIndex - 1),
  };
};

export interface RecurringScheduleAdvance {
  nextDueAtSec: number;
  runCount: number;
}

/**
 * State after a run settled at `nowSec` (paid, failed for good, or skipped):
 * the next due time is the first one after now, so missed periods are never
 * paid retroactively.
 */
export const advanceRecurringSchedule = (
  state: RecurringScheduleState,
  nowSec: number,
): RecurringScheduleAdvance => ({
  nextDueAtSec: nextDueAfter(state, nowSec),
  runCount: state.runCount + 1,
});
