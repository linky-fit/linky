import { encodeNpub, parsePubkey } from "@linky-fit/linkstr";
import { describe, expect, it } from "vitest";
import { copy } from "../copy";
import { acceptsTarget, readWithdrawForm } from "./withdrawForm";

const pubkey = parsePubkey(
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
);
if (pubkey === null) throw new Error("test pubkey");
const npub = encodeNpub(pubkey);

describe("the withdraw form", () => {
  it("sends the whole balance to a Linky profile unless an amount is typed", () => {
    const whole = readWithdrawForm("linky", npub, "", false);
    expect(whole.target?.kind).toBe("cashu_chat");
    expect(whole.amountSats).toBeUndefined();
    expect(whole.ready).toBe(true);
    const typed = readWithdrawForm("linky", npub, "1 500", false);
    expect(typed.amountSats).toBe(1500);
  });

  it("takes a Lightning address with an editable amount", () => {
    const form = readWithdrawForm("lightning", "jmeno@domena.cz", "", false);
    expect(form.target?.kind).toBe("lightning_address");
    expect(form.amountEditable).toBe(true);
    expect(form.ready).toBe(true);
  });

  it("rejects an amount that is not a whole number of sats", () => {
    const form = readWithdrawForm("lightning", "jmeno@domena.cz", "1,5", false);
    expect(form.amountError).toBe(copy.withdraw.amountInvalid);
    expect(form.ready).toBe(false);
  });

  it("refuses a recipient of the other choice", () => {
    const form = readWithdrawForm("lightning", npub, "", false);
    expect(form.target).toBeNull();
    expect(form.targetError).toBe(copy.withdraw.lightningTargetInvalid);
    expect(acceptsTarget("linky", npub)).toBe(true);
    expect(acceptsTarget("linky", "jmeno@domena.cz")).toBe(false);
  });

  it("explains an unreadable recipient only once submitted", () => {
    expect(readWithdrawForm("linky", "nonsense", "", false).targetError).toBe(
      undefined,
    );
    expect(readWithdrawForm("linky", "nonsense", "", true).targetError).toBe(
      copy.withdraw.linkyRecipientInvalid,
    );
  });
});
