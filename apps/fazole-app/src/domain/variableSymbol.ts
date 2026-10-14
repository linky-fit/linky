import { Schema } from "effect";

export const VariableSymbol = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[1-9]\d{0,9}$/)),
  Schema.brand("VariableSymbol"),
);
export type VariableSymbol = typeof VariableSymbol.Type;

const MIN_10_DIGITS = 1_000_000_000;
const COUNT_10_DIGITS = 9_000_000_000;

// Uniformly random 10 digits, no time component: only payments made around the
// same time must differ, and digits spent on a timestamp would shrink exactly
// that space. With 9e9 values, 1000 payments a day across all devices of a
// shop collide with odds of about 1 in 18 000.
export const generateVariableSymbol = (): VariableSymbol => {
  const [high = 0, low = 0] = crypto.getRandomValues(new Uint32Array(2));
  const random53Bits = (high % 2 ** 21) * 2 ** 32 + low;
  return VariableSymbol.make(
    String(MIN_10_DIGITS + (random53Bits % COUNT_10_DIGITS)),
  );
};
