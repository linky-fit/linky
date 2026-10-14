/** Longer notes are cut, so a sender cannot fill the merchant's history. */
export const NOTE_MAX_CHARS = 280;

// Bidirectional overrides would let a note reorder the text around it.
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/gu;
const CONTROLS_AND_SPACE = /[\p{Cc}\s]+/gu;

/**
 * The note a sender attached to a payment as one line of plain text:
 * control characters and runs of whitespace become one space, bidi
 * overrides go, and at most `NOTE_MAX_CHARS` characters stay. `null` when
 * nothing is left.
 */
export const paymentNote = (memo: string | null): string | null => {
  const text = (memo ?? "")
    .replace(BIDI_CONTROLS, "")
    .replace(CONTROLS_AND_SPACE, " ")
    .trim();
  if (text === "") return null;
  const chars = Array.from(text);
  return chars.length <= NOTE_MAX_CHARS
    ? text
    : `${chars
        .slice(0, NOTE_MAX_CHARS - 1)
        .join("")
        .trimEnd()}…`;
};
