import { describe, expect, it } from "vitest";
import {
  Listing,
  ListingAmount,
  ListingCurrency,
  Pubkey,
  SharedListing,
  sharedListingMessageText,
} from "@linky-fit/linkstr";
import { translations } from "../../i18n";
import {
  getChatTextNotificationCopyForLanguage,
  getRecurringReminderCopyForLanguage,
} from "./cashuNotificationCopy";

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

describe("getChatTextNotificationCopyForLanguage", () => {
  const shared = new SharedListing({
    author: Pubkey.make("a".repeat(64)),
    listing: new Listing({
      id: "eggs",
      side: "offer",
      title: "Garden eggs",
      amount: ListingAmount.make("90"),
      currency: ListingCurrency.make("CZK"),
      unit: "per 10",
    }),
  });

  it.each(Object.entries(translations))(
    "names a listing sent without a note like the %s conversation preview",
    (lang, dictionary) => {
      expect(
        getChatTextNotificationCopyForLanguage(
          lang,
          sharedListingMessageText(shared, ""),
        ),
      ).toBe(dictionary.chatListingMessage.replace("{title}", "Garden eggs"));
    },
  );

  it("shows a listing's note, and a plain text as it is", () => {
    expect(
      getChatTextNotificationCopyForLanguage(
        "en",
        sharedListingMessageText(shared, "Still there?"),
      ),
    ).toBe("Still there?");
    expect(getChatTextNotificationCopyForLanguage("en", "Hello")).toBe("Hello");
  });
});
