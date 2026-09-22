import type {
  RecurringInterval,
  RecurringIntervalUnit,
  RecurringPaymentOrder,
} from "@linky/recurring-payment";
import type { I18nKey, Translate } from "../../i18n";

const SINGLE_KEYS: Record<RecurringIntervalUnit, I18nKey> = {
  hour: "recurringEveryHour",
  day: "recurringEveryDay",
  week: "recurringEveryWeek",
  month: "recurringEveryMonth",
};

const PLURAL_KEYS: Record<RecurringIntervalUnit, I18nKey> = {
  hour: "recurringEveryNHours",
  day: "recurringEveryNDays",
  week: "recurringEveryNWeeks",
  month: "recurringEveryNMonths",
};

export const describeRecurringInterval = (
  interval: RecurringInterval,
  t: Translate,
): string =>
  interval.count === 1
    ? t(SINGLE_KEYS[interval.unit])
    : t(PLURAL_KEYS[interval.unit]).replace("{count}", String(interval.count));

export const recurringLastRunLabel = (
  order: RecurringPaymentOrder,
  t: Translate,
): string | null => {
  switch (order.lastRunStatus) {
    case "paid":
      return t("recurringRunPaid");
    case "failed":
      return t("recurringRunFailed");
    case "skipped":
      return t("recurringRunSkipped");
    case "running":
      return t("recurringRunRunning");
    case "interrupted":
      return t("recurringRunInterrupted");
    case null:
      return null;
  }
};

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** Epoch seconds → the local-time value a `datetime-local` input expects. */
export const epochToDateTimeLocal = (epochSec: number): string => {
  const date = new Date(epochSec * 1000);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

/** `datetime-local` value (device local time) → epoch seconds, null if unparsable. */
export const dateTimeLocalToEpoch = (value: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? "0"),
  );
  const epochSec = Math.floor(date.getTime() / 1000);
  return Number.isFinite(epochSec) ? epochSec : null;
};

/** Start of the next full hour, the default first run of a new order. */
export const nextFullHourSec = (nowSec: number): number =>
  (Math.floor(nowSec / 3600) + 1) * 3600;
