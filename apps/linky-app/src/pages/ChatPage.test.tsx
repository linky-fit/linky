import {
  encodePaymentRequestPayload,
  PaymentRequestId,
} from "@linky-fit/linkshu/payment-request";
import { encode } from "cbor-x";
import {
  derivePubkey,
  encodeNprofile,
  encodeNpub,
  NostrSecretKey,
  type Pubkey,
} from "@linky-fit/linkstr";
import { act, createRef, memo, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LocalNostrMessage,
  LocalNostrReaction,
} from "../app/types/appTypes";
import { buildCashuPaymentRequestMessage } from "../app/lib/paymentRequestMessage";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { encodeBase64Url } from "../utils/base64";
import { ChatComposer, ChatNearbyBanner, ChatPage } from "./ChatPage";

const nearby = vi.hoisted(() => ({
  states: new Map<string, "nearby" | "buy" | "sell">(),
}));

vi.mock("../app/hooks/useBeacon", () => ({
  useNearbyContact: (pubkey: Pubkey | null) =>
    (pubkey && nearby.states.get(pubkey)) ?? null,
}));

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock(),
);

const rows = vi.hoisted(() => {
  const canDelete = new Map<string, boolean>();
  const payDisabled = new Map<string, boolean>();
  const rendered: string[] = [];
  const requestStatus = new Map<string, string | null>();
  return { canDelete, payDisabled, rendered, requestStatus };
});

vi.mock("../components/ChatMessage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../components/ChatMessage")>()),
  ChatMessage: memo(function ChatMessageProbe({
    canDelete,
    message,
    payPaymentRequestDisabled,
    paymentRequestStatus,
  }: {
    canDelete: boolean;
    message: LocalNostrMessage;
    payPaymentRequestDisabled: boolean;
    paymentRequestStatus: string | null;
  }) {
    rows.canDelete.set(message.id, canDelete);
    rows.payDisabled.set(message.id, payPaymentRequestDisabled);
    rows.requestStatus.set(message.id, paymentRequestStatus);
    rows.rendered.push(message.id);
    return null;
  }),
}));

type Props = ComponentProps<typeof ChatComposer>;

const setup = async (overrides: Partial<Props> = {}) => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  let props: Props = {
    canPayThisContact: false,
    canRequestThisContact: false,
    canStartPay: false,
    addChatAttachments: vi.fn(),
    cashuIsBusy: false,
    chatAttachments: [],
    chatDraft: "First message",
    chatSendIsBusy: false,
    composeInputRef: createRef<HTMLDivElement>(),
    editContext: null,
    getCashuTokenMessageInfo: () => null,
    getMintIconUrl: () => ({
      failed: false,
      host: null,
      origin: null,
      url: null,
    }),
    getNpubMessageContactInfo: () => null,
    hasUnknownPubkeyHex: true,
    isFeedbackContact: false,
    mentionContacts: [],
    npub: null,
    onCancelEdit: vi.fn(),
    onCancelReply: vi.fn(),
    openContactPay: vi.fn(),
    replyContext: null,
    replyPreviewText: "",
    selectedContact: { id: "contact" },
    sendChatImage: vi.fn(async () => true),
    sendChatMessage: vi.fn(async () => {}),
    removeChatAttachment: vi.fn(),
    setChatDraft: vi.fn(),
    t: (key) => key,
    ...overrides,
  };
  const rendered = await renderIntoDocument(<ChatComposer {...props} />);
  const editor =
    rendered.container.querySelector<HTMLDivElement>("[role=textbox]");
  if (!editor) throw new Error("Missing editor");
  return {
    ...rendered,
    editor,
    props,
    update: async (next: Partial<Props>) => {
      props = { ...props, ...next };
      await rendered.rerender(<ChatComposer {...props} />);
    },
    type: async (text: string) => {
      await act(async () => {
        editor.textContent = text;
        editor.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText" }),
        );
      });
    },
    sendButton: () =>
      rendered.container.querySelector<HTMLButtonElement>(
        '[data-guide="chat-send"]',
      ),
  };
};

describe("ChatComposer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([true, false])(
    "preserves the next draft when the first send clears its draft, busy=%s",
    async (stillBusy) => {
      const composer = await setup();
      await act(async () => composer.sendButton()?.click());
      expect(composer.props.sendChatMessage).toHaveBeenCalledOnce();
      await composer.update({ chatSendIsBusy: true });
      await composer.type("Second message");
      expect(composer.props.setChatDraft).not.toHaveBeenCalled();
      expect(composer.sendButton()?.disabled).toBe(true);

      await composer.update({ chatDraft: "", chatSendIsBusy: stillBusy });
      expect(composer.editor.textContent).toBe("Second message");
      await composer.update({ chatSendIsBusy: false });
      expect(composer.editor.textContent).toBe("Second message");
      expect(composer.sendButton()?.disabled).toBe(false);
      await act(async () => composer.sendButton()?.click());
      expect(composer.props.setChatDraft).toHaveBeenCalledWith(
        "Second message",
      );
      await composer.update({ chatDraft: "Second message" });
      expect(composer.props.sendChatMessage).toHaveBeenCalledTimes(2);
      await composer.unmount();
    },
  );

  it("clears the sent draft if it has not changed", async () => {
    const composer = await setup({ chatSendIsBusy: true });
    await composer.update({ chatDraft: "" });
    expect(composer.editor.textContent).toBe("");
    expect(composer.sendButton()).toBeNull();
    await composer.unmount();
  });

  it("applies an external draft and clears a cancelled edit", async () => {
    const composer = await setup();
    await composer.type("Unsent text");
    await composer.update({
      chatDraft: "Original message",
      editContext: {
        messageId: "message",
        originalContent: "Original message",
        rumorId: "rumor",
      },
    });
    expect(composer.editor.textContent).toBe("Original message");
    await composer.type("Edited text");
    await composer.update({ chatDraft: "", editContext: null });
    expect(composer.editor.textContent).toBe("");
    await composer.unmount();
  });
});

describe("ChatNearbyBanner", () => {
  const peer = derivePubkey(NostrSecretKey.make(new Uint8Array(32).fill(3)));
  const npub = encodeNpub(peer);

  afterEach(() => nearby.states.clear());

  it.each([
    ["nearby", "nearby"],
    ["buy", "nearbyBuys"],
    ["sell", "nearbySells"],
  ] as const)("shows a %s peer as %s", async (state, label) => {
    nearby.states.set(peer, state);
    const { container, unmount } = await renderIntoDocument(
      <ChatNearbyBanner npub={npub} t={(key) => key} />,
    );
    expect(container.querySelector('[role="status"]')?.textContent).toBe(label);
    await unmount();
  });

  it("shows nothing while the peer is not nearby", async () => {
    const { container, unmount } = await renderIntoDocument(
      <ChatNearbyBanner npub={npub} t={(key) => key} />,
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
    await unmount();
  });
});

describe("ChatPage message rows", () => {
  type PageProps = ComponentProps<typeof ChatPage>;

  const message = (id: string, createdAtSec: number): LocalNostrMessage => ({
    contactId: "contact",
    content: `text ${id}`,
    createdAtSec,
    direction: "in",
    id,
    pubkey: "peer",
    rumorId: `rumor-${id}`,
    wrapId: `wrap-${id}`,
  });

  const chatMessageElByIdRef = { current: new Map<string, HTMLDivElement>() };
  const chatMessagesRef = createRef<HTMLDivElement>();

  const pageProps = (
    chatMessages: LocalNostrMessage[],
    reactionsByMessageId: ReadonlyMap<string, LocalNostrReaction[]>,
    cashuIsBusy: boolean,
  ): PageProps => ({
    addChatAttachments: vi.fn(),
    bankPaymentOfferMessages: [],
    cashuBalance: 100,
    cashuBalanceAfterMelt: 100,
    cashuIsBusy,
    chatAttachments: [],
    chatDraft: "",
    chatMessageElByIdRef,
    chatMessages,
    chatMessagesRef,
    chatOwnPubkeyHex: null,
    chatSendIsBusy: false,
    contactsGroupAssignment: null,
    editContext: null,
    feedbackContactNpub: "",
    getCashuTokenMessageInfo: () => null,
    getMintIconUrl: () => ({
      failed: false,
      host: null,
      origin: null,
      url: null,
    }),
    getNpubMessageContactInfo: () => null,
    lang: "en",
    markMintIconFailed: vi.fn(),
    mentionContacts: [],
    onAddNpubContacts: vi.fn(),
    onAddUnknownContact: vi.fn(async () => {}),
    onBlockUnknownContact: vi.fn(async () => {}),
    onCancelEdit: vi.fn(),
    onCancelReply: vi.fn(),
    onCopy: vi.fn(),
    onDeclinePaymentRequest: vi.fn(async () => {}),
    onDelete: vi.fn(),
    onEdit: vi.fn(),
    onOpenNpubContact: vi.fn(),
    onPayPaymentRequest: vi.fn(async () => {}),
    onReact: vi.fn(),
    onReply: vi.fn(),
    onSettleBankPaymentOffer: vi.fn(async () => {}),
    openContactPay: vi.fn(),
    payWithCashuEnabled: false,
    reactionsByMessageId,
    receivedSatByRequestId: new Map(),
    removeChatAttachment: vi.fn(),
    replyContext: null,
    selectedContact: { id: "contact", unknownPubkeyHex: "a".repeat(64) },
    sendChatImage: vi.fn(async () => true),
    sendChatMessage: vi.fn(async () => {}),
    setChatDraft: vi.fn(),
  });

  afterEach(() => {
    rows.canDelete.clear();
    rows.payDisabled.clear();
    rows.requestStatus.clear();
    rows.rendered = [];
    vi.unstubAllGlobals();
  });

  it("re-renders only the rows whose content or neighbours changed", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const first = message("first", 100);
    const second = message("second", 200);
    const reactions = new Map([
      [
        "rumor-first",
        [
          {
            createdAtSec: 150,
            emoji: "👍",
            id: "reaction",
            messageId: "rumor-first",
            reactorPubkey: "peer",
            status: "sent" as const,
            wrapId: "reaction-wrap",
          },
        ],
      ],
    ]);
    const { rerender, unmount } = await renderIntoDocument(
      <ChatPage {...pageProps([first, second], reactions, false)} />,
    );
    expect(rows.rendered).toEqual(["first", "second"]);
    rows.rendered = [];

    // Fresh callbacks, getters, reaction map and wallet state, as every parent render brings.
    await rerender(
      <ChatPage {...pageProps([first, second], new Map(reactions), true)} />,
    );
    expect(rows.rendered).toEqual([]);

    await rerender(
      <ChatPage
        {...pageProps([first, second, message("third", 300)], reactions, true)}
      />,
    );
    expect(rows.rendered).toEqual(["second", "third"]);
    await unmount();
  });

  it("offers Delete only on messages that carry no payment", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const request = {
      ...message("request", 200),
      content: buildCashuPaymentRequestMessage({
        amount: 21,
        mintUrls: [],
        recipientNprofile: encodeNprofile(
          derivePubkey(NostrSecretKey.make(new Uint8Array(32).fill(1))),
          [],
        ),
        requestId: PaymentRequestId.make("request-1"),
      }),
    };
    const { unmount } = await renderIntoDocument(
      <ChatPage
        {...pageProps([message("plain", 100), request], new Map(), false)}
      />,
    );

    expect(Object.fromEntries(rows.canDelete)).toEqual({
      plain: true,
      request: false,
    });
    await unmount();
  });

  it.each([
    [21, "paid"],
    [20, "requested"],
  ])(
    "with %i sats received for a payload naming its request id marks a 21 sat request %s",
    async (receivedSat, status) => {
      vi.stubGlobal("matchMedia", () => ({ matches: false }));
      const requestId = PaymentRequestId.make("request-1");
      const request = {
        ...message("request", 100),
        direction: "out" as const,
        content: buildCashuPaymentRequestMessage({
          amount: 21,
          mintUrls: [],
          recipientNprofile: encodeNprofile(
            derivePubkey(NostrSecretKey.make(new Uint8Array(32).fill(1))),
            [],
          ),
          requestId,
        }),
      };
      const payment = {
        ...message("payment", 200),
        content: encodePaymentRequestPayload({
          id: requestId,
          mint: "https://mint.example",
          unit: "sat",
          proofs: [
            { id: "009a1f293253e41e", amount: 21, secret: "s", C: "02" },
          ],
        }),
      };
      const { unmount } = await renderIntoDocument(
        <ChatPage
          {...pageProps([request, payment], new Map(), false)}
          receivedSatByRequestId={new Map([[requestId, receivedSat]])}
        />,
      );

      expect(rows.requestStatus.get("request")).toBe(status);
      await unmount();
    },
  );

  it.each([
    [100, false],
    [0, true],
  ])(
    "with %i sats left disables paying an amountless request: %s",
    async (cashuBalanceAfterMelt, disabled) => {
      vi.stubGlobal("matchMedia", () => ({ matches: false }));
      const request = {
        ...message("request", 100),
        content: `creqA${encodeBase64Url(encode({ u: "sat", m: [] }))}`,
      };
      const { unmount } = await renderIntoDocument(
        <ChatPage
          {...pageProps([request], new Map(), false)}
          cashuBalanceAfterMelt={cashuBalanceAfterMelt}
        />,
      );

      expect(rows.payDisabled.get("request")).toBe(disabled);
      await unmount();
    },
  );

  it("re-renders a row showing a token or an npub when its getter changes", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const plain = message("plain", 100);
    const token = { ...message("token", 200), content: "cashuBtoken" };
    const npub = { ...message("npub", 300), content: "hi nostr:npub1abc" };
    const props = pageProps([plain, token, npub], new Map(), false);
    const { rerender, unmount } = await renderIntoDocument(
      <ChatPage {...props} />,
    );
    rows.rendered = [];

    const getCashuTokenMessageInfo = () => null;
    await rerender(
      <ChatPage
        {...props}
        getCashuTokenMessageInfo={getCashuTokenMessageInfo}
      />,
    );
    expect(rows.rendered).toEqual(["token"]);
    rows.rendered = [];

    await rerender(
      <ChatPage
        {...props}
        getCashuTokenMessageInfo={getCashuTokenMessageInfo}
        getNpubMessageContactInfo={() => null}
      />,
    );
    expect(rows.rendered).toEqual(["npub"]);
    await unmount();
  });
});
