import { encodeNpub, parsePubkey } from "@linky-fit/linkstr";
import { describe, expect, it } from "vitest";
import { copy } from "../copy";
import type { ContactState } from "./contactState";
import {
  acceptsTarget,
  needsContactLookup,
  readWithdrawForm,
} from "./withdrawForm";

const pubkey = parsePubkey(
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
);
if (pubkey === null) throw new Error("test pubkey");
const npub = encodeNpub(pubkey);
const idle: ContactState = { kind: "idle" };
const resolved: ContactState = {
  kind: "resolved",
  contact: { pubkey, address: "hynek@linky.fit" },
};

describe("the withdraw form", () => {
  it("sends the whole balance to an npub unless an amount is typed", () => {
    const whole = readWithdrawForm(npub, idle, "", false);
    expect(whole.target).toEqual({ kind: "cashu_chat", pubkey, npub });
    expect(whole.amountSats).toBeUndefined();
    expect(whole.ready).toBe(true);
    const typed = readWithdrawForm(npub, idle, "1 500", false);
    expect(typed.amountSats).toBe(1500);
  });

  it("looks a Linky name up and sends to the key it names", () => {
    expect(needsContactLookup("hynek")).toBe(true);
    expect(needsContactLookup("hynek@linky.fit")).toBe(true);
    expect(needsContactLookup("jmeno@domena.cz")).toBe(false);
    expect(needsContactLookup(npub)).toBe(false);
    const waiting = readWithdrawForm("hynek", { kind: "resolving" }, "", true);
    expect(waiting.resolving).toBe(true);
    expect(waiting.ready).toBe(false);
    expect(waiting.targetError).toBeUndefined();
    const found = readWithdrawForm("hynek", resolved, "", false);
    expect(found.target).toEqual({
      kind: "cashu_chat",
      pubkey,
      npub,
      address: "hynek@linky.fit",
    });
    expect(found.ready).toBe(true);
    const missing = readWithdrawForm(
      "nobody",
      { kind: "failed", failure: "not-found", address: "nobody@linky.fit" },
      "",
      false,
    );
    expect(missing.targetError).toBe(copy.contact.notFound("nobody@linky.fit"));
    expect(missing.ready).toBe(false);
  });

  it("takes a Lightning address elsewhere with an editable amount", () => {
    const form = readWithdrawForm("jmeno@domena.cz", idle, "", false);
    expect(form.target?.kind).toBe("lightning_address");
    expect(form.amountEditable).toBe(true);
    expect(form.ready).toBe(true);
  });

  it("rejects an amount that is not a whole number of sats", () => {
    const form = readWithdrawForm("jmeno@domena.cz", idle, "1,5", false);
    expect(form.amountError).toBe(copy.withdraw.amountInvalid);
    expect(form.ready).toBe(false);
  });

  it("explains an unreadable recipient only once submitted", () => {
    expect(readWithdrawForm("??", idle, "", false).targetError).toBe(undefined);
    expect(readWithdrawForm("??", idle, "", true).targetError).toBe(
      copy.withdraw.targetInvalid,
    );
    expect(acceptsTarget(npub)).toBe(true);
    expect(acceptsTarget("hynek")).toBe(true);
    expect(acceptsTarget("jmeno@domena.cz")).toBe(true);
    expect(acceptsTarget("??")).toBe(false);
  });
});
