import { describe, expect, it } from "vitest";
import { getRecurringReminderCopyForLanguage } from "./cashuNotificationCopy";

describe("getRecurringReminderCopyForLanguage", () => {
  it("names the one payment due by its note", () => {
    expect(getRecurringReminderCopyForLanguage("en-US", ["Rent"])).toEqual({
      title: "Ready to send Rent",
      body: "Open the app to send the payment.",
    });
  });

  it.each([
    ["a payment without a note", [null]],
    ["no stored notes", null],
  ])("falls back to a generic title for %s", (_label, notes) => {
    expect(getRecurringReminderCopyForLanguage("en", notes)).toEqual({
      title: "Ready to send payment",
      body: "Open the app to send the payment.",
    });
  });

  it("counts several payments due at once", () => {
    expect(
      getRecurringReminderCopyForLanguage("en", ["Rent", null, "Gym"]),
    ).toEqual({
      title: "Ready to send 3 payments",
      body: "Open the app to send the payments.",
    });
  });

  it("speaks the device's language", () => {
    expect(getRecurringReminderCopyForLanguage("cs-CZ", ["Nájem"])).toEqual({
      title: "Připraveno k odeslání: Nájem",
      body: "Otevřete aplikaci a odešlete platbu.",
    });
    expect(getRecurringReminderCopyForLanguage("cs", [null, null]).title).toBe(
      "Připraveno k odeslání: 2 platby",
    );
    expect(
      getRecurringReminderCopyForLanguage(
        "cs",
        Array.from({ length: 5 }, () => null),
      ).title,
    ).toBe("Připraveno k odeslání: 5 plateb");
    expect(getRecurringReminderCopyForLanguage("de-DE", null).title).toBe(
      "Zahlung bereit zum Senden",
    );
    expect(
      getRecurringReminderCopyForLanguage("pt-BR", ["Aluguel"]).title,
    ).toBe("Pronto para enviar: Aluguel");
  });
});
