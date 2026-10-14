import { CzkAmount } from "./money";

/** What the customer chose on the tip step. */
export type TipChoice =
  | { readonly kind: "percent"; readonly percent: number }
  /** A fixed tip, also one the customer typed. */
  | { readonly kind: "fixed"; readonly tipCzk: CzkAmount }
  | { readonly kind: "none" };

/** The tiles of the tip step, in order; the custom tip and "no tip" follow them. */
export const TIP_PRESETS: readonly TipChoice[] = [
  { kind: "percent", percent: 5 },
  { kind: "percent", percent: 10 },
  { kind: "percent", percent: 15 },
  { kind: "percent", percent: 20 },
  { kind: "fixed", tipCzk: CzkAmount.make(2_000) },
  { kind: "fixed", tipCzk: CzkAmount.make(5_000) },
];

/** The tip on `base`; a percentage rounds to whole haléře. */
export const tipAmount = (base: CzkAmount, choice: TipChoice): CzkAmount => {
  switch (choice.kind) {
    case "percent":
      return CzkAmount.make(Math.round((base * choice.percent) / 100));
    case "fixed":
      return choice.tipCzk;
    case "none":
      return CzkAmount.make(0);
  }
};

/** What the payment charges: the base amount and the tip, `null` when there is none. */
export const withTip = (
  base: CzkAmount,
  choice: TipChoice,
): { readonly amountCzk: CzkAmount; readonly tipCzk: CzkAmount | null } => {
  const tip = tipAmount(base, choice);
  return {
    amountCzk: CzkAmount.make(base + tip),
    tipCzk: tip > 0 ? tip : null,
  };
};
