import { getPublicKey } from "nostr-tools";
import { act, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LinkyBankPaymentOfferStatus } from "../app/lib/bankPaymentOffer";
import type { LocalNostrMessage } from "../app/types/appTypes";
import { createLinkyBankPaymentOfferEvent } from "../testUtils/bankPaymentOfferEvent";
import { createSecretKey } from "../testUtils/nostrKeys";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { BankPaymentOfferDetailPage } from "./BankPaymentOfferDetailPage";

const { appShellMock } = vi.hoisted(() => ({
  appShellMock: {
    allowedDisplayCurrencies: ["sat"],
    cycleDisplayCurrency: vi.fn(),
    t: (key: string): string => key,
  },
}));

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellActions: () => ({
    cycleDisplayCurrency: appShellMock.cycleDisplayCurrency,
  }),
  useAppShellCore: () => ({
    allowedDisplayCurrencies: appShellMock.allowedDisplayCurrencies,
    formatDisplayedAmountText: (amountSat: number) => `${amountSat} sat`,
    nostrPictureByNpub: {
      npub1alice: "https://example.com/alice.jpg",
    },
    t: (key: string) => appShellMock.t(key),
  }),
}));

vi.mock("../components/PrivateImageBubble", () => ({
  PrivateImageBubble: () => <div data-testid="payment-confirmation-image" />,
}));

const OFFERER_PUBKEY = getPublicKey(createSecretKey(1));
const RECIPIENT_PUBKEY = getPublicKey(createSecretKey(2));

const createOfferMessage = (
  status: LinkyBankPaymentOfferStatus = "offered",
): LocalNostrMessage => {
  const createdAtSec = Math.floor(Date.now() / 1_000);
  const event = createLinkyBankPaymentOfferEvent({
    amountSat: 1_000,
    amountText: "1,000 sat",
    clientId: "client-offer-1",
    createdAt: createdAtSec,
    offerId: "offer-1",
    offererPublicKey: OFFERER_PUBKEY,
    recipientPublicKey: RECIPIENT_PUBKEY,
    senderPublicKey: OFFERER_PUBKEY,
    spdPayload:
      status === "bank_details_sent"
        ? "SPD*1.0*ACC:CZ6508000000192000145399*AM:100.00*CC:CZK"
        : null,
    status,
  });

  return {
    contactId: "contact-1",
    content: event.content,
    createdAtSec,
    direction: "in",
    id: "message-1",
    pubkey: OFFERER_PUBKEY,
    rumorId: `rumor-${status}`,
    wrapId: "wrap-1",
  };
};

type PageProps = ComponentProps<typeof BankPaymentOfferDetailPage>;

interface RenderOfferOptions extends Partial<PageProps> {
  status?: LinkyBankPaymentOfferStatus;
}

/** Renders the recipient's view of a fresh offer from Alice unless overridden. */
const renderOffer = async ({
  status = "offered",
  ...overrides
}: RenderOfferOptions = {}) => {
  const { container } = await renderIntoDocument(
    <BankPaymentOfferDetailPage
      bankPaymentOfferMessages={[createOfferMessage(status)]}
      chatId="contact-1"
      chatMessages={[]}
      chatOwnPubkeyHex={RECIPIENT_PUBKEY}
      contacts={[{ id: "contact-1", name: "Alice", npub: "npub1alice" }]}
      offerId="offer-1"
      onCopyText={() => undefined}
      onRespondBankPaymentOffer={async () => true}
      onSendChatImage={async () => undefined}
      onSettleBankPaymentOffer={async () => undefined}
      {...overrides}
    />,
  );
  return container;
};

describe("BankPaymentOfferDetailPage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    window.location.hash = "";
    localStorage.clear();
    appShellMock.allowedDisplayCurrencies = ["sat"];
    appShellMock.cycleDisplayCurrency.mockClear();
    appShellMock.t = (key) => key;
  });

  it("keeps the offerer's countdown ticking while the own chat is accepted_by_other", async () => {
    vi.useFakeTimers();
    try {
      const clock = (key: string) =>
        key === "bankPaymentOfferTimeRemainingClock"
          ? "{minutes}:{seconds}"
          : key;
      appShellMock.t = clock;
      const acceptedEntry: LocalNostrMessage = {
        ...createOfferMessage("accepted"),
        contactId: "contact-2",
        id: "message-2",
        wrapId: "wrap-2",
      };
      const container = await renderOffer({
        bankPaymentOfferMessages: [
          createOfferMessage("accepted_by_other"),
          acceptedEntry,
        ],
        chatOwnPubkeyHex: OFFERER_PUBKEY,
        contacts: [
          { id: "contact-1", name: "Alice" },
          { id: "contact-2", name: "Bob" },
        ],
      });

      expect(container.textContent).toContain("5:00");

      await act(async () => {
        vi.advanceTimersByTime(2_000);
      });

      expect(container.textContent).toContain("4:58");
      expect(container.textContent).not.toContain("5:00");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a rejected-payout screen with only a back-to-chat action after paying", async () => {
    window.location.hash = "#chat/contact-1/bank-payment-offer/offer-1";
    const createdAtSec = Math.floor(Date.now() / 1_000);
    const canceled: LocalNostrMessage = {
      ...createOfferMessage("bank_paid"),
      content: createLinkyBankPaymentOfferEvent({
        amountSat: 1_000,
        amountText: "1,000 sat",
        bankPaidAtSec: createdAtSec,
        clientId: "client-offer-1",
        createdAt: createdAtSec,
        offerId: "offer-1",
        offererPublicKey: OFFERER_PUBKEY,
        recipientPublicKey: RECIPIENT_PUBKEY,
        senderPublicKey: OFFERER_PUBKEY,
        spdPayload: null,
        status: "canceled",
      }).content,
    };
    const container = await renderOffer({
      bankPaymentOfferMessages: [canceled],
    });

    expect(container.textContent).toContain("bankPaymentOfferRejectedTitle");
    expect(container.textContent).toContain(
      "bankPaymentOfferRejectedDescription",
    );
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toContain("chatImageBackToChat");

    await act(async () => {
      buttons[0]?.click();
    });
    expect(window.location.hash).toBe("#chat/contact-1");
  });

  it("shows that another candidate accepted first as a closed state", async () => {
    const container = await renderOffer({ status: "accepted_by_other" });

    expect(container.textContent).toContain(
      "bankPaymentOfferStatusAcceptedByOther",
    );
    expect(container.textContent).toContain("bankPaymentOfferAcceptedByOther");
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("stays on the payment detail after accepting an offer", async () => {
    window.location.hash = "#chat/contact-1/bank-payment-offer/offer-1";
    const onRespondBankPaymentOffer = vi.fn(async () => true);
    const container = await renderOffer({ onRespondBankPaymentOffer });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".btn-wide")?.click();
    });

    expect(onRespondBankPaymentOffer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "message-1" }),
      "accepted",
    );
    expect(window.location.hash).toBe(
      "#chat/contact-1/bank-payment-offer/offer-1",
    );
  });

  it("returns to the chat after declining an offer", async () => {
    window.location.hash = "#chat/contact-1/bank-payment-offer/offer-1";
    const onRespondBankPaymentOffer = vi.fn(async () => true);
    const container = await renderOffer({ onRespondBankPaymentOffer });
    const buttons = container.querySelectorAll<HTMLButtonElement>(".btn-wide");

    await act(async () => {
      buttons[1]?.click();
    });

    expect(onRespondBankPaymentOffer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "message-1" }),
      "declined",
    );
    expect(window.location.hash).toBe("#chat/contact-1");
  });

  it("does not mark the fiat step complete before the recipient confirms payment", async () => {
    const container = await renderOffer({ status: "bank_details_sent" });
    const steps = container.querySelectorAll(
      ".bank-payment-offer-progress-step",
    );

    expect(steps).toHaveLength(4);
    expect(steps[0]?.classList.contains("is-complete")).toBe(true);
    expect(steps[1]?.classList.contains("is-complete")).toBe(true);
    expect(steps[2]?.classList.contains("is-complete")).toBe(false);
    expect(steps[3]?.classList.contains("is-complete")).toBe(false);
    expect(Array.from(steps, (step) => step.textContent)).toEqual([
      "bankPaymentOfferProgressOffered",
      "bankPaymentOfferProgressAccept",
      "bankPaymentOfferProgressBankPayment",
      "bankPaymentOfferProgressSats",
    ]);
  });

  it("keeps the confirm action visible and hides the payment rows behind a toggle", async () => {
    const container = await renderOffer({ status: "bank_details_sent" });

    expect(container.querySelector(".bank-payment-fields")).toBeNull();
    const detailsToggle = container.querySelector<HTMLButtonElement>(
      ".bank-payment-offer-details-toggle",
    );
    const confirmButton = container.querySelector<HTMLButtonElement>(
      ".bank-payment-request",
    );
    expect(confirmButton?.textContent).toContain("bankPaymentOfferMarkPaid");
    expect(
      detailsToggle &&
        confirmButton &&
        Boolean(confirmButton.compareDocumentPosition(detailsToggle) & 4),
    ).toBe(true);

    await act(async () => {
      detailsToggle?.click();
    });
    expect(
      container.querySelector(".bank-payment-fields")?.textContent,
    ).toContain("CZ6508000000192000145399");
  });

  it("cycles the display unit when the amount is tapped", async () => {
    appShellMock.allowedDisplayCurrencies = ["sat", "czk"];
    const container = await renderOffer({ status: "bank_details_sent" });

    const amountButton = container.querySelector<HTMLButtonElement>(
      ".bank-payment-amount-button",
    );
    expect(amountButton).not.toBeNull();
    await act(async () => {
      amountButton?.click();
    });
    expect(appShellMock.cycleDisplayCurrency).toHaveBeenCalledOnce();
  });

  it("names the accepting contact in the offerer summary", async () => {
    const named = (key: string) =>
      key === "bankPaymentOfferProgressAcceptedByName"
        ? "{name} has already accepted the offer."
        : key;
    appShellMock.t = named;
    const container = await renderOffer({
      chatOwnPubkeyHex: OFFERER_PUBKEY,
      status: "accepted",
    });

    expect(container.textContent).toContain(
      "Alice has already accepted the offer.",
    );
    expect(container.textContent).not.toContain(
      "bankPaymentOfferProgressAcceptedInfo",
    );
  });

  it("lists staggered recipients still waiting in the queue", async () => {
    const nowSec = Math.floor(Date.now() / 1_000);
    localStorage.setItem(
      "linky.bank_payment_offer_stagger.v1.offer-1",
      JSON.stringify({
        amountSat: 1_000,
        amountText: "1,000 sat",
        createdAtSec: nowSec,
        expiresAtSec: nowSec + 300,
        offerId: "offer-1",
        ownerPubkey: OFFERER_PUBKEY,
        pending: [
          {
            contactId: "contact-2",
            contactPubHex: "b".repeat(64),
            dueAtSec: nowSec + 10,
          },
        ],
      }),
    );

    const container = await renderOffer({
      chatOwnPubkeyHex: OFFERER_PUBKEY,
      contacts: [
        { id: "contact-1", name: "Alice" },
        { id: "contact-2", name: "Bob" },
      ],
    });

    const recipients = container.querySelectorAll(
      ".bank-payment-offer-recipient",
    );
    expect(recipients).toHaveLength(2);
    expect(recipients[0]?.textContent).toContain("Alice");
    expect(recipients[1]?.textContent).toContain("Bob");
    expect(recipients[1]?.textContent).toContain(
      "bankPaymentOfferStatusQueued",
    );
  });

  it("requests one more minute without changing the active offer phase", async () => {
    const onRespondBankPaymentOffer = vi.fn(async () => true);
    const container = await renderOffer({
      onRespondBankPaymentOffer,
      status: "bank_details_sent",
    });
    const extendButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find(
      (button) =>
        button.getAttribute("aria-label") === "bankPaymentOfferNeedMoreTime",
    );
    expect(extendButton).not.toBeUndefined();

    await act(async () => {
      extendButton?.click();
    });

    expect(onRespondBankPaymentOffer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "message-1" }),
      "bank_details_sent",
      expect.objectContaining({
        expiresAtSec: expect.any(Number),
        extensionSec: 60,
        withPush: true,
      }),
    );
  });

  it("lets the requester extend the active phase from the compact timer control", async () => {
    const onRespondBankPaymentOffer = vi.fn(async () => true);
    const container = await renderOffer({
      chatOwnPubkeyHex: OFFERER_PUBKEY,
      onRespondBankPaymentOffer,
      status: "bank_paid",
    });
    const extendButton = container.querySelector<HTMLButtonElement>(
      ".bank-payment-offer-timer-row .bank-payment-offer-extend",
    );

    expect(extendButton?.textContent).toBe("bankPaymentOfferExtendOneMinute");
    await act(async () => {
      extendButton?.click();
    });

    expect(onRespondBankPaymentOffer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "message-1" }),
      "bank_paid",
      expect.objectContaining({ extensionSec: 60, withPush: true }),
    );
  });

  it("shows settlement confirmation and unpaid actions after the peer marks the bank payment paid", async () => {
    const onRespondBankPaymentOffer = vi.fn(async () => true);
    const container = await renderOffer({
      chatOwnPubkeyHex: OFFERER_PUBKEY,
      onRespondBankPaymentOffer,
      status: "bank_paid",
    });
    const buttons = container.querySelectorAll<HTMLButtonElement>(".btn-wide");
    const recipientAvatar = container.querySelector<HTMLImageElement>(
      ".bank-payment-offer-recipient-avatar img",
    );

    expect(recipientAvatar?.src).toBe("https://example.com/alice.jpg");
    expect(buttons[0]?.textContent).toContain("bankPaymentOfferSettle");
    expect(buttons[0]?.querySelector("svg")).not.toBeNull();
    expect(buttons[1]?.textContent).toContain("bankPaymentOfferNotPaid");

    await act(async () => {
      buttons[1]?.click();
    });

    expect(onRespondBankPaymentOffer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "message-1" }),
      "canceled",
    );
  });

  it("keeps the recipient flow open while sending an attached confirmation", async () => {
    window.location.hash = "#chat/contact-1/bank-payment-offer/offer-1";
    const onSendChatImage = vi.fn(async () => undefined);
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:confirmation-preview");
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);

    const container = await renderOffer({
      onSendChatImage,
      status: "bank_paid",
    });

    expect(container.textContent).toContain(
      "bankPaymentOfferWaitingForSatsTitle",
    );
    expect(container.textContent).toContain(
      "bankPaymentOfferAttachConfirmation",
    );

    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("confirmation input not found");
    const file = new File(["confirmation"], "confirmation.png", {
      type: "image/png",
    });
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onSendChatImage).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ rumorId: "rumor-bank_paid" }),
    );
    expect(window.location.hash).toBe(
      "#chat/contact-1/bank-payment-offer/offer-1",
    );
    expect(
      container.querySelector<HTMLImageElement>(
        'img[src="blob:confirmation-preview"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).not.toContain(
      "bankPaymentOfferAttachConfirmation",
    );
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
  });

  it.each([
    [OFFERER_PUBKEY, "requester"],
    [RECIPIENT_PUBKEY, "recipient"],
  ])("shows an attached confirmation to the %s flow", async (ownPubkey) => {
    const offerMessage = createOfferMessage("bank_paid");
    const confirmationMessage: LocalNostrMessage = {
      contactId: "contact-1",
      content: JSON.stringify({
        encryptedSha256: "encrypted",
        encryptedSize: 10,
        encryptionAlgorithm: "aes-gcm",
        fileType: "image/jpeg",
        height: 100,
        key: "key",
        nonce: "nonce",
        originalSha256: "original",
        storageEncoding: "raw",
        type: "linky.private_image.v1",
        url: "https://example.com/confirmation.jpg",
        width: 100,
      }),
      createdAtSec: offerMessage.createdAtSec + 1,
      direction: ownPubkey === RECIPIENT_PUBKEY ? "out" : "in",
      id: "confirmation-message",
      pubkey: RECIPIENT_PUBKEY,
      replyToId: "rumor-bank_paid",
      rootMessageId: "rumor-bank_paid",
      rumorId: "confirmation-rumor",
      wrapId: "confirmation-wrap",
    };
    const container = await renderOffer({
      bankPaymentOfferMessages: [offerMessage],
      chatMessages: [offerMessage, confirmationMessage],
      chatOwnPubkeyHex: ownPubkey,
    });

    expect(container.textContent).toContain("bankPaymentOfferConfirmation");
    expect(
      container.querySelector('[data-testid="payment-confirmation-image"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain(
      "bankPaymentOfferAttachConfirmation",
    );
  });

  it("closes the payment detail when the recipient receives the sats", async () => {
    window.location.hash = "#chat/contact-1/bank-payment-offer/offer-1";
    await renderOffer({ status: "settled" });

    expect(window.location.hash).toBe("#chat/contact-1");
  });
});
