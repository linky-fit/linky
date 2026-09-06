import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import type { LinkyBankPaymentOfferInfo } from "../app/lib/bankPaymentOffer";
import { serializePrivateImageMessage } from "../app/lib/privateImageMessage";
import type { LocalNostrMessage } from "../app/types/appTypes";
import {
  ChatMessage,
  type MessageContactsGroupAssignment,
  type NpubMessageContactInfo,
} from "./ChatMessage";

vi.mock("../app/lib/privateImageMessage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../app/lib/privateImageMessage")>();
  return {
    ...actual,
    decryptPrivateImageMessage: vi.fn(
      async () => new Blob(["img"], { type: "image/jpeg" }),
    ),
  };
});

vi.mock("../devtools/inspector", () => ({
  reportInspectorRows: vi.fn(),
}));

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({
    formatDisplayedAmountParts: (amountSat: number) => ({
      amountText: String(amountSat),
      approxPrefix: "",
      unitLabel: "sat",
    }),
    formatDisplayedAmountText: (amountSat: number) => `${amountSat} sat`,
    t: (key: string) => key,
  }),
}));

const makeMessage = (
  content: string,
  direction: "in" | "out" = "in",
): LocalNostrMessage => ({
  contactId: "contact-1",
  content,
  createdAtSec: 1_700_000_000,
  direction,
  id: "message-1",
  pubkey: "sender-pubkey",
  rumorId: "rumor-1",
  wrapId: "wrap-1",
});

const contactInfo = (
  npub: string,
  isSaved = false,
): NpubMessageContactInfo => ({
  displayName: npub,
  isSaved,
  npub,
  pictureUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yw=",
});

interface RenderChatMessageOptions {
  bankPaymentOfferInfo?: LinkyBankPaymentOfferInfo | null;
  canReplyOrReact?: boolean;
  canSettleBankPaymentOffer?: boolean;
  direction?: "in" | "out";
  getNpubMessageContactInfo?: (npub: string) => NpubMessageContactInfo | null;
  onAddNpubContacts?: (npubs: readonly string[], messageId: string) => void;
  contactsGroupAssignment?: MessageContactsGroupAssignment | null;
  onSettleBankPaymentOffer?: () => Promise<void>;
}

const renderChatMessage = async (
  content: string,
  options: RenderChatMessageOptions = {},
) => {
  const { container } = await renderIntoDocument(
    <ChatMessage
      contactsGroupAssignment={options.contactsGroupAssignment ?? null}
      actionLabels={{
        copy: "copy",
        edit: "edit",
        edited: "edited",
        react: "react",
        reply: "reply",
        save: "save",
        share: "share",
      }}
      bankPaymentOfferInfo={options.bankPaymentOfferInfo ?? null}
      bankPaymentOfferPeerNotice={null}
      canOpenBankPaymentOfferDetails={true}
      canSettleBankPaymentOffer={options.canSettleBankPaymentOffer ?? false}
      canActOnPaymentRequest={false}
      canEdit={false}
      canReplyOrReact={options.canReplyOrReact ?? false}
      chatPendingLabel="pending"
      chatSeenLabel="seen"
      declineInfo={null}
      formatChatDayLabel={() => "day"}
      getCashuTokenMessageInfo={() => null}
      getMintIconUrl={() => ({
        failed: false,
        host: null,
        origin: null,
        url: null,
      })}
      getNpubMessageContactInfo={
        options.getNpubMessageContactInfo ?? ((npub) => contactInfo(npub))
      }
      isSeen={false}
      locale="en"
      message={makeMessage(content, options.direction)}
      nextMessage={null}
      onAddNpubContacts={options.onAddNpubContacts ?? (() => undefined)}
      onCopy={() => undefined}
      onDeclinePaymentRequest={() => undefined}
      onEdit={() => undefined}
      onMintIconError={() => undefined}
      onMintIconLoad={() => undefined}
      onOpenBankPaymentOfferDetails={() => undefined}
      onOpenNpubContact={() => undefined}
      onPayPaymentRequest={() => undefined}
      onReact={() => undefined}
      onReply={() => undefined}
      onSettleBankPaymentOffer={
        options.onSettleBankPaymentOffer ?? (async () => undefined)
      }
      payPaymentRequestBusy={false}
      payPaymentRequestDisabled={false}
      paymentRequestInfo={null}
      paymentRequestStatus={null}
      previousMessage={null}
      reactions={[]}
      replyQuoteText={null}
      settleBankPaymentOfferBusy={false}
    />,
  );

  return container;
};

describe("ChatMessage contact actions", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("adds all unique unsaved contacts from an incoming message", async () => {
    const onAddNpubContacts = vi.fn();
    const container = await renderChatMessage("npub1aaaa npub1cccc npub1aaaa", {
      onAddNpubContacts,
    });
    const button = container.querySelector<HTMLButtonElement>(
      ".chat-add-all-contacts",
    );

    expect(button?.textContent).toContain("addAllContacts");

    await act(async () => {
      button?.click();
    });

    expect(onAddNpubContacts).toHaveBeenCalledOnce();
    expect(onAddNpubContacts).toHaveBeenCalledWith(
      ["npub1aaaa", "npub1cccc"],
      "message-1",
    );
  });

  it("offers a group picker in place of Add all once the contacts are saved", async () => {
    const onAssign = vi.fn();
    const container = await renderChatMessage("npub1aaaa npub1cccc", {
      contactsGroupAssignment: {
        contactCount: 2,
        groupNames: ["Friends"],
        messageId: "message-1",
        onAssign,
        onDismiss: () => undefined,
      },
      getNpubMessageContactInfo: (npub) => contactInfo(npub, true),
    });

    expect(container.querySelector(".chat-add-all-contacts")).toBeNull();
    expect(container.querySelector(".contact-group-pill")).toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".chat-add-to-group-toggle")
        ?.click();
    });

    const pill = container.querySelector<HTMLButtonElement>(
      ".chat-add-to-group .contact-group-pill",
    );
    expect(pill?.textContent).toBe("Friends");

    await act(async () => {
      pill?.click();
    });

    expect(onAssign).toHaveBeenCalledWith("Friends");
  });

  it("does not show Add all unless two unsaved contacts are incoming", async () => {
    const oneUnsaved = await renderChatMessage("npub1aaaa npub1cccc", {
      getNpubMessageContactInfo: (npub) =>
        contactInfo(npub, npub === "npub1cccc"),
    });
    const outgoing = await renderChatMessage("npub1aaaa npub1cccc", {
      direction: "out",
    });

    expect(oneUnsaved.querySelector(".chat-add-all-contacts")).toBeNull();
    expect(outgoing.querySelector(".chat-add-all-contacts")).toBeNull();
  });
});

describe("ChatMessage image message actions", () => {
  const imageMessageContent = serializePrivateImageMessage({
    encryptedSha256: "a".repeat(64),
    encryptedSize: 4,
    encryptionAlgorithm: "aes-gcm",
    fileType: "image/jpeg",
    height: 10,
    key: "b".repeat(64),
    nonce: "c".repeat(24),
    originalSha256: "d".repeat(64),
    storageEncoding: "base64",
    type: "linky.private_image.v1",
    url: "https://example.com/blob",
    width: 10,
  });
  const share = vi.fn<(data?: ShareData) => Promise<void>>(
    async () => undefined,
  );

  beforeEach(() => {
    share.mockClear();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:test"),
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
      writable: true,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  const openMenu = async (container: HTMLElement) => {
    const menuButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Message actions"]',
    );
    await act(async () => {
      menuButton?.click();
    });
  };

  const menuItemLabels = (): string[] =>
    Array.from(document.body.querySelectorAll(".message-actions-item")).map(
      (item) => item.textContent ?? "",
    );

  it("offers share and save instead of copy once the image is decrypted", async () => {
    const container = await renderChatMessage(imageMessageContent);
    await openMenu(container);

    expect(menuItemLabels()).toEqual(["share", "save"]);
  });

  it("shares the decrypted image as a file through the system share", async () => {
    const container = await renderChatMessage(imageMessageContent);
    await openMenu(container);

    const shareItem = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        ".message-actions-item",
      ),
    ).find((item) => item.textContent === "share");
    await act(async () => {
      shareItem?.click();
    });

    expect(share).toHaveBeenCalledTimes(1);
    const shared = share.mock.calls[0]?.[0];
    const sharedFile = shared?.files?.[0];
    expect(sharedFile?.name).toBe("linky-image.jpg");
    expect(sharedFile?.type).toBe("image/jpeg");
    expect(shared && "url" in shared).toBe(false);
    expect(shared && "text" in shared).toBe(false);
  });

  it("keeps copy for plain text messages", async () => {
    const container = await renderChatMessage("hello there");
    await openMenu(container);

    expect(menuItemLabels()).toEqual(["copy"]);
  });

  it("opens the viewer on a plain tap", async () => {
    const container = await renderChatMessage(imageMessageContent, {
      canReplyOrReact: true,
    });
    const imageButton = container.querySelector<HTMLButtonElement>(
      ".chat-private-image-button",
    );

    await act(async () => {
      imageButton?.click();
    });

    expect(container.querySelector(".chat-image-viewer")).not.toBeNull();
  });

  it("swallows the click synthesized after a long-press", async () => {
    vi.useFakeTimers();
    try {
      const container = await renderChatMessage(imageMessageContent, {
        canReplyOrReact: true,
      });
      const imageButton = container.querySelector<HTMLButtonElement>(
        ".chat-private-image-button",
      );
      expect(imageButton).not.toBeNull();

      const touchEvent = (type: string): MouseEvent => {
        const event = new MouseEvent(type, { bubbles: true });
        Object.defineProperty(event, "pointerType", { value: "touch" });
        return event;
      };

      await act(async () => {
        imageButton?.dispatchEvent(touchEvent("pointerdown"));
      });
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      expect(
        document.body.querySelector(".message-actions-sheet"),
      ).not.toBeNull();

      await act(async () => {
        imageButton?.dispatchEvent(touchEvent("pointerup"));
        imageButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(container.querySelector(".chat-image-viewer")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ChatMessage bank payment offer actions", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("settles a paid offer from the chat card", async () => {
    const onSettleBankPaymentOffer = vi.fn(async () => undefined);
    const bankPaymentOfferInfo: LinkyBankPaymentOfferInfo = {
      amountSat: 10,
      amountText: "10 sat",
      bankPaidAtSec: 1_700_000_000,
      expiresAtSec: 1_700_000_300,
      extensionSec: null,
      initiatedAtSec: 1_699_999_900,
      offerId: "offer-1",
      offererPublicKey: "offerer-pubkey",
      spdPayload: null,
      status: "bank_paid",
      statusUpdatedAtSec: 1_700_000_000,
      text: "Bank payment marked paid",
    };
    const container = await renderChatMessage("offer", {
      bankPaymentOfferInfo,
      canSettleBankPaymentOffer: true,
      direction: "out",
      onSettleBankPaymentOffer,
    });
    const detailsButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".chat-payment-request-actions button",
      ),
    ).find((button) => button.textContent?.includes("details"));
    const settleButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".chat-payment-request-actions button",
      ),
    ).find((button) =>
      button.textContent?.includes("bankPaymentOfferMarkDone"),
    );

    expect(detailsButton).toBeDefined();
    expect(settleButton).toBeDefined();

    await act(async () => {
      settleButton?.click();
    });

    expect(onSettleBankPaymentOffer).toHaveBeenCalledOnce();
  });
});
