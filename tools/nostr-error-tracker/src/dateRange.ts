interface DateRange {
  since: number | null;
  until: number | null;
  error: string | null;
}

const invalidRange: DateRange = {
  since: null,
  until: null,
  error: "Enter valid dates with the start on or before the end.",
};

const parseDate = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  const [year, month, day] = value.split("-").map(Number);
  if (
    month === undefined ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
};

export const getDateRange = (from: string, to: string): DateRange => {
  const start = from ? parseDate(from) : null;
  const end = to ? parseDate(to) : null;
  if ((from && !start) || (to && !end) || (start && end && start > end)) {
    return { ...invalidRange };
  }
  if (end) end.setDate(end.getDate() + 1);
  return {
    since: start ? start.getTime() / 1000 : null,
    until: end ? end.getTime() / 1000 : null,
    error: null,
  };
};
