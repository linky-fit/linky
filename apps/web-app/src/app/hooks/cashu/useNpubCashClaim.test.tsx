import { Either } from "effect";
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Amount,
  CounterLockTimeout,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  OperationId,
  ReceiveDeferred,
  ReceiveReceipt,
  TokenText,
} from "@linky-fit/linkshu";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import {
  LOCAL_NPUB_CASH_CLAIM_INBOX_STORAGE_KEY_PREFIX,
  LOCAL_NPUB_CASH_CLAIM_LAST_ATTEMPT_STORAGE_KEY_PREFIX,
  LOCAL_NPUB_CASH_CLAIM_LOCK_STORAGE_KEY_PREFIX,
} from "../../../utils/constants";
import type { PushToastOptions } from "../../../hooks/useToasts";
import {
  addToClaimInbox,
  readClaimInbox,
} from "../../../utils/npubCashClaimInbox";
import type { ReceiveCashuToken } from "../composition/useLinkshuComposition";
import { useNpubCashClaim } from "./useNpubCashClaim";

const makeLocalStorageKey = (prefix: string): string => `${prefix}.owner`;
const inboxKey = makeLocalStorageKey(
  LOCAL_NPUB_CASH_CLAIM_INBOX_STORAGE_KEY_PREFIX,
);
const mint = MintUrl.make("https://mint.example");
const claimed = "cashuBclaimedonce";
const operationId = OperationId.make("AQEBAQEBAQEBAQEBAQEBAQ");

const received = Either.right(
  new ReceiveReceipt({
    operationId,
    tokenText: TokenText.make("cashuBresigned"),
    mint,
    unit: CurrencyUnit.make("sat"),
    amount: Amount.make(21),
  }),
);

const waitedOutTheLock = Either.left(
  new CounterLockTimeout({
    mint,
    unit: CurrencyUnit.make("sat"),
    keysetId: KeysetId.make("00ad268c4d1f5826"),
  }),
);

/** The claim server hands `tokens` out on the first request only. */
const stubClaimServer = (tokens: readonly string[]): void => {
  let handedOut = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const body = handedOut ? {} : { data: { tokens } };
      handedOut = true;
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
};

/** A claim server that never answers; aborting the request's signal fails it. */
const stubStalledClaimServer = (): { abort: () => void } => {
  const timeout = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const fail = (): void => reject(init.signal?.reason);
          if (init.signal?.aborted) fail();
          init.signal?.addEventListener("abort", fail);
        }),
    ),
  );
  return { abort: () => timeout.abort() };
};

const renderClaim = async (
  receiveCashuToken: ReceiveCashuToken,
  pushToast: (message: string, options?: PushToastOptions) => void = () =>
    undefined,
  copyText: (value: string) => Promise<void> = async () => undefined,
) => {
  const ref: { current: (() => Promise<void>) | null } = { current: null };
  const Probe = (): null => {
    const npubCashClaimInFlightRef = React.useRef(false);
    const { claimNpubCashOnce } = useNpubCashClaim({
      adoptPaidCashuQuote: null,
      allowTestMints: true,
      cashuIsBusy: false,
      copyText,
      currentNpub: "npub-test",
      currentNsec: "nsec-test",
      enqueueCashuOp: (op) => op(),
      formatDisplayedAmountParts: () => ({
        amountText: "21",
        approxPrefix: "",
        unitLabel: "sat",
      }),
      isMintDeleted: () => false,
      logPaymentEvent: () => undefined,
      makeLocalStorageKey,
      makeNip98AuthHeader: async () => "Nostr test",
      maybeShowPwaNotification: async () => undefined,
      mintInfoByUrl: new Map(),
      npubCashClaimInFlightRef,
      pushToast,
      receiveCashuToken,
      refreshMintInfo: () => undefined,
      rememberCashuTokenKnown: () => undefined,
      routeKind: "wallet",
      setCashuIsBusy: () => undefined,
      setStatus: () => undefined,
      showPaidOverlay: () => undefined,
      t: (key) => key,
      touchMintInfo: () => undefined,
    });
    React.useEffect(() => {
      ref.current = claimNpubCashOnce;
    }, [claimNpubCashOnce]);
    return null;
  };
  const rendered = await renderIntoDocument(<Probe />);
  const claim = async (): Promise<void> => {
    localStorage.removeItem(
      makeLocalStorageKey(
        LOCAL_NPUB_CASH_CLAIM_LAST_ATTEMPT_STORAGE_KEY_PREFIX,
      ),
    );
    await ref.current?.();
  };
  const poll = (): Promise<void> => act(claim);
  return { claim, poll, unmount: rendered.unmount };
};

const inbox = (): readonly string[] => readClaimInbox(inboxKey);

/** Web Locks shared by every tab rendered in this document. */
const stubWebLocks = (): void => {
  const held = new Set<string>();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      query: async () => ({ held: [], pending: [] }),
      request: async (
        name: string,
        _options: { ifAvailable: true },
        callback: (lock: { name: string } | null) => Promise<void> | undefined,
      ) => {
        if (held.has(name)) return callback(null);
        held.add(name);
        try {
          return await callback({ name });
        } finally {
          held.delete(name);
        }
      },
    },
  });
};

/** Storage that keeps small records, like the claim lock, but not the inbox. */
const refuseInboxWrites = (): void => {
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (key.startsWith(inboxKey)) {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    }
    setItem.call(this, key, value);
  });
};

describe("useNpubCashClaim", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
  });

  it("polls in one tab at a time, holding a Web Lock", async () => {
    stubWebLocks();
    stubClaimServer([claimed]);
    let finishReceive = (): void => undefined;
    const receive = vi.fn<ReceiveCashuToken>(
      () =>
        new Promise((resolve) => {
          finishReceive = () => resolve(received);
        }),
    );
    const tabA = await renderClaim(receive);
    const tabB = await renderClaim(receive);

    const pollA = tabA.claim();
    await tabB.claim();
    expect(fetch).toHaveBeenCalledOnce();
    expect(
      localStorage.getItem(
        makeLocalStorageKey(LOCAL_NPUB_CASH_CLAIM_LOCK_STORAGE_KEY_PREFIX),
      ),
    ).toBeNull();

    await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce());
    finishReceive();
    await pollA;
    expect(inbox()).toEqual([]);
    await tabA.unmount();
    await tabB.unmount();
  });

  it("keeps a token npub.cash hands out once while its receive cannot get its turn, and receives it on a later poll", async () => {
    stubClaimServer([claimed]);
    const receive = vi
      .fn<ReceiveCashuToken>()
      .mockResolvedValueOnce(waitedOutTheLock)
      .mockResolvedValueOnce(received);
    const { poll, unmount } = await renderClaim(receive);

    await poll();
    expect(inbox()).toEqual([claimed]);

    await poll();
    expect(receive.mock.calls.map(([text]) => text)).toEqual([
      claimed,
      claimed,
    ]);
    expect(inbox()).toEqual([]);
    await unmount();
  });

  it("receives a token a closed tab claimed but never received", async () => {
    stubClaimServer([]);
    addToClaimInbox(inboxKey, [claimed]);
    const receive = vi.fn<ReceiveCashuToken>().mockResolvedValue(received);
    const { poll, unmount } = await renderClaim(receive);

    await poll();

    expect(receive).toHaveBeenCalledWith(claimed);
    expect(inbox()).toEqual([]);
    await unmount();
  });

  it("receives saved tokens before asking the claim server, and gives up on a claim request that stalls", async () => {
    stubWebLocks();
    const server = stubStalledClaimServer();
    addToClaimInbox(inboxKey, [claimed]);
    const receive = vi.fn<ReceiveCashuToken>().mockResolvedValue(received);
    const tabA = await renderClaim(receive);
    const tabB = await renderClaim(receive);

    const pollA = tabA.claim();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(receive.mock.calls.map(([text]) => text)).toEqual([claimed]);
    expect(inbox()).toEqual([]);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(15_000);

    server.abort();
    await pollA;
    await tabB.claim();
    expect(fetch).toHaveBeenCalledTimes(2);
    await tabA.unmount();
    await tabB.unmount();
  });

  it("lets go of a token linkshu keeps as a deferral", async () => {
    stubClaimServer([claimed]);
    const receive = vi
      .fn<ReceiveCashuToken>()
      .mockResolvedValue(
        Either.left(
          new ReceiveDeferred({ mint, operationId, amount: Amount.make(21) }),
        ),
      );
    const { poll, unmount } = await renderClaim(receive);

    await poll();

    expect(inbox()).toEqual([]);
    await unmount();
  });

  it("receives a claimed token at once when storage refuses the inbox", async () => {
    refuseInboxWrites();
    stubClaimServer([claimed]);
    const receive = vi.fn<ReceiveCashuToken>().mockResolvedValue(received);
    const pushToast = vi.fn();
    const { poll, unmount } = await renderClaim(receive, pushToast);

    await poll();

    expect(receive.mock.calls.map(([text]) => text)).toEqual([claimed]);
    expect(inbox()).toEqual([]);
    expect(pushToast).not.toHaveBeenCalled();
    await unmount();
  });

  it("offers to copy a token storage refused only once while its receive keeps waiting", async () => {
    refuseInboxWrites();
    stubClaimServer([claimed]);
    const receive = vi
      .fn<ReceiveCashuToken>()
      .mockResolvedValue(waitedOutTheLock);
    const pushToast = vi.fn();
    const { poll, unmount } = await renderClaim(receive, pushToast);

    await poll();
    await poll();
    await poll();

    expect(receive).toHaveBeenCalledTimes(3);
    expect(pushToast).toHaveBeenCalledOnce();
    await unmount();
  });

  it("offers to copy a claimed token storage refused while its receive cannot get its turn, and receives it on a later poll", async () => {
    refuseInboxWrites();
    stubClaimServer([claimed]);
    const receive = vi
      .fn<ReceiveCashuToken>()
      .mockResolvedValueOnce(waitedOutTheLock)
      .mockResolvedValueOnce(received);
    const pushToast =
      vi.fn<(message: string, options?: PushToastOptions) => void>();
    const copyText = vi.fn(async () => undefined);
    const { poll, unmount } = await renderClaim(receive, pushToast, copyText);

    await poll();
    expect(pushToast).toHaveBeenCalledTimes(1);
    const [message, options] = pushToast.mock.calls[0] ?? [];
    expect(message).toBe("npubCashClaimUnsaved");
    options?.action?.onClick();
    expect(copyText).toHaveBeenCalledWith(claimed);

    await poll();
    expect(receive.mock.calls.map(([text]) => text)).toEqual([
      claimed,
      claimed,
    ]);
    expect(pushToast).toHaveBeenCalledTimes(1);
    await unmount();
  });
});
