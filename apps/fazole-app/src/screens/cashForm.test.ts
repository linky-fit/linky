import { makeIdentity } from "@linky-fit/linkstr/testing";
import { describe, expect, it } from "vitest";
import { copy } from "../copy";
import { readCashForm } from "./cashForm";

const contact = { pubkey: makeIdentity().pubkey, address: "hynek@linky.fit" };

describe("the cash form", () => {
  it("is ready with a found contact and a CZK amount with up to two decimals", () => {
    const form = readCashForm({ kind: "resolved", contact }, "1 250,50", false);
    expect(form.contact).toBe(contact);
    expect(form.amountCzk).toBe(125_050);
    expect(form.ready).toBe(true);
  });

  it("explains a missing contact or amount only once submitted", () => {
    const untouched = readCashForm({ kind: "idle" }, "", false);
    expect(untouched.contactError).toBeUndefined();
    expect(untouched.amountError).toBeUndefined();
    expect(untouched.ready).toBe(false);
    const submitted = readCashForm({ kind: "idle" }, "", true);
    expect(submitted.contactError).toBe(copy.contact.invalid);
    expect(submitted.amountError).toBe(copy.cash.amountInvalid);
  });

  it("shows a lookup failure at once, naming the address that was not found", () => {
    const notFound = readCashForm(
      { kind: "failed", failure: "not-found", address: "nobody@linky.fit" },
      "100",
      false,
    );
    expect(notFound.contactError).toBe(
      copy.contact.notFound("nobody@linky.fit"),
    );
    expect(notFound.ready).toBe(false);
    expect(
      readCashForm(
        { kind: "failed", failure: "unreachable", address: null },
        "100",
        false,
      ).contactError,
    ).toBe(copy.contact.unreachable);
  });

  it("rejects an amount that is not money", () => {
    for (const text of ["0", "abc", "1,234", "-5"]) {
      const form = readCashForm({ kind: "resolved", contact }, text, false);
      expect(form.amountError).toBe(copy.cash.amountInvalid);
      expect(form.ready).toBe(false);
    }
  });
});
