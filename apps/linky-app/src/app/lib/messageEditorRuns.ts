import { MESSAGE_ENTITY_PATTERN } from "./messageEditorEntities";

/**
 * A run of the draft as a plain text input shows it: an entity run shows a
 * label in place of its raw text and is edited as one character.
 */
export interface MessageEditorRun {
  readonly raw: string;
  readonly display: string;
  readonly entity: boolean;
}

/** Splits the draft into text runs and the entities `labelOf` names; null leaves an entity as text. */
export const messageEditorRuns = (
  value: string,
  labelOf: (raw: string) => string | null,
): MessageEditorRun[] => {
  const runs: MessageEditorRun[] = [];
  const pushText = (text: string) => {
    if (text) runs.push({ raw: text, display: text, entity: false });
  };
  let cursor = 0;
  for (const match of value.matchAll(MESSAGE_ENTITY_PATTERN)) {
    const raw = match[0];
    const label = labelOf(raw);
    if (label === null) continue;
    pushText(value.slice(cursor, match.index));
    runs.push({ raw, display: label, entity: true });
    cursor = match.index + raw.length;
  }
  pushText(value.slice(cursor));
  return runs;
};

export const displayTextOf = (runs: readonly MessageEditorRun[]): string =>
  runs.map((run) => run.display).join("");

/** The raw offset of a display offset; one inside an entity lands after it. */
export const rawOffsetOf = (
  runs: readonly MessageEditorRun[],
  displayOffset: number,
): number => {
  let display = 0;
  let raw = 0;
  for (const run of runs) {
    const end = display + run.display.length;
    if (displayOffset <= end) {
      if (displayOffset === display) return raw;
      return run.entity
        ? raw + run.raw.length
        : raw + (displayOffset - display);
    }
    display = end;
    raw += run.raw.length;
  }
  return raw;
};

/** The display offset of a raw offset; one inside an entity lands after it. */
export const displayOffsetOf = (
  runs: readonly MessageEditorRun[],
  rawOffset: number,
): number => {
  let display = 0;
  let raw = 0;
  for (const run of runs) {
    const end = raw + run.raw.length;
    if (rawOffset <= end) {
      if (rawOffset === raw) return display;
      return run.entity
        ? display + run.display.length
        : display + (rawOffset - raw);
    }
    raw = end;
    display += run.display.length;
  }
  return display;
};

/** The span `[start, end)` of `next` that differs from `previous`, as replaced in `previous`. */
const changedSpan = (previous: string, next: string) => {
  const limit = Math.min(previous.length, next.length);
  let prefix = 0;
  while (prefix < limit && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  )
    suffix += 1;
  return {
    start: prefix,
    end: previous.length - suffix,
    inserted: next.slice(prefix, next.length - suffix),
  };
};

/**
 * The draft after the input's text changed from the runs' display to
 * `nextDisplay`. An edit touching an entity removes it whole; typing inside
 * one goes after it.
 */
export const applyDisplayEdit = (
  runs: readonly MessageEditorRun[],
  nextDisplay: string,
): { value: string; caret: number } => {
  const span = changedSpan(displayTextOf(runs), nextDisplay);
  let { start, end } = span;
  const insertsOnly = start === end;
  let display = 0;
  for (const run of runs) {
    const runEnd = display + run.display.length;
    const touches = insertsOnly
      ? display < start && start < runEnd
      : display < end && start < runEnd;
    if (run.entity && touches) {
      start = insertsOnly ? runEnd : Math.min(start, display);
      end = Math.max(end, runEnd);
    }
    display = runEnd;
  }
  const raw = runs.map((run) => run.raw).join("");
  const rawStart = rawOffsetOf(runs, start);
  return {
    value: `${raw.slice(0, rawStart)}${span.inserted}${raw.slice(rawOffsetOf(runs, end))}`,
    caret: rawStart + span.inserted.length,
  };
};

/** Where the caret belongs after the draft changed from outside the input: after the change. */
export const caretAfterChange = (previous: string, next: string): number => {
  const span = changedSpan(previous, next);
  return span.start + span.inserted.length;
};
