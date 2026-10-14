import { copy } from "../copy";
import { parseSats, parseWithdrawTarget, type WithdrawTarget } from "../domain";
import { formatWhole } from "../format";

/** Where the merchant chose to withdraw to. */
export type WithdrawChoice = "linky" | "lightning";

export interface WithdrawForm {
  /** The recipient the text names, if it is one the choice accepts. */
  readonly target: WithdrawTarget | null;
  readonly targetError: string | undefined;
  readonly targetHint: string | undefined;
  /** An invoice fixes the amount, so the amount field hides. */
  readonly amountEditable: boolean;
  /** The sats to send; `undefined` sends the whole balance with the fees deducted from it. */
  readonly amountSats: number | undefined;
  readonly amountError: string | undefined;
  readonly ready: boolean;
}

const acceptedKinds: Record<WithdrawChoice, readonly WithdrawTarget["kind"][]> =
  {
    linky: ["cashu_chat"],
    lightning: ["lightning_invoice", "lightning_address"],
  };

const targetErrors: Record<WithdrawChoice, string> = {
  linky: copy.withdraw.linkyRecipientInvalid,
  lightning: copy.withdraw.lightningTargetInvalid,
};

/** Whether a scanned or pasted text names a recipient of this choice. */
export const acceptsTarget = (
  choice: WithdrawChoice,
  text: string,
): boolean => {
  const target = parseWithdrawTarget(text);
  return target !== null && acceptedKinds[choice].includes(target.kind);
};

/**
 * Reads the withdraw form as typed. Errors show once `submitted`; an empty
 * amount means the whole balance.
 */
export const readWithdrawForm = (
  choice: WithdrawChoice,
  targetText: string,
  amountText: string,
  submitted: boolean,
): WithdrawForm => {
  const parsed = parseWithdrawTarget(targetText);
  const target =
    parsed !== null && acceptedKinds[choice].includes(parsed.kind)
      ? parsed
      : null;
  const amountEditable = target?.kind !== "lightning_invoice";
  const typedAmount =
    amountText.trim() === "" ? undefined : parseSats(amountText);
  const amountSats =
    target?.kind === "lightning_invoice"
      ? target.amountSats
      : (typedAmount ?? undefined);
  const amountInvalid = amountEditable && typedAmount === null;
  return {
    target,
    targetError:
      target === null &&
      (submitted || (targetText.trim() !== "" && parsed !== null))
        ? targetErrors[choice]
        : undefined,
    targetHint:
      target?.kind === "lightning_invoice"
        ? copy.withdraw.invoiceAmount(formatWhole(target.amountSats))
        : undefined,
    amountEditable,
    amountSats,
    amountError: amountInvalid ? copy.withdraw.amountInvalid : undefined,
    ready: target !== null && !amountInvalid,
  };
};
