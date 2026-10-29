import { decodePaymentRequest } from "@linky-fit/linkshu/payment-request";
import {
  createId,
  makeOnchainTransfersRepository,
  NonEmptyString1000,
  sqliteTrue,
  type OnchainTransferRecord,
  type OnchainTransfersRepository,
  type OnchainTransferId,
} from "@linky-fit/linksync";
import { encodeNpub, encodeNprofile } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import { encodeTransferUpdateColumn } from "@linky-fit/onchain-transfer";
import { Effect, Exit } from "effect";
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTestLinkyStore } from "../../testUtils/linkyStore";
import {
  onchainConfigFixture,
  onchainTransferUpdateFixture,
  REGTEST_ADDRESS,
} from "../../testUtils/onchainTransfers";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import type { OnchainOperator } from "../lib/onchainOperator";
import {
  planOnchainTransfer,
  type OnchainTransferView,
} from "../lib/onchainTransfers";
import type { CashuPaymentRequestMessageInfo } from "../lib/paymentRequestMessage";
import type { OnchainTransferPaymentOptions } from "../state/wallet/walletCommands";

const { navigateTo, payOnchainTransferPaymentRequest, saveNpubContact, state } =
  vi.hoisted(() => {
    const state: {
      operator: OnchainOperator | null;
      ownNprofile: string | null;
      rows: readonly OnchainTransferRecord[];
      repository: OnchainTransfersRepository | null;
    } = { operator: null, ownNprofile: null, rows: [], repository: null };
    return {
      navigateTo: vi.fn<(action: unknown) => void>(),
      payOnchainTransferPaymentRequest:
        vi.fn<
          (
            request: CashuPaymentRequestMessageInfo,
            options: OnchainTransferPaymentOptions,
          ) => void
        >(),
      saveNpubContact: vi.fn(() => ({ contact: { id: "operator-contact" } })),
      state,
    };
  });

vi.mock("../lib/onchainOperator", () => ({
  get onchainOperator() {
    return state.operator;
  },
}));
vi.mock("./shell", async () =>
  (await import("../../testUtils/shellHooks")).shellHooksMock({
    t: (key) => (key === "onchainSendConfirmSummary" ? "Send {amount}" : key),
  }),
);
vi.mock("./useLinksync", () => ({
  useOnchainTransferRecords: () => state.rows,
  useOnchainTransfersRepository: () => state.repository ?? {},
  useTransactionRecords: () => [],
}));
vi.mock("./wallet/useWalletCommands", () => ({
  useWalletCommands: () => ({ payOnchainTransferPaymentRequest }),
}));
vi.mock("./contacts/useSaveNpubContact", () => ({
  useSaveNpubContact: () => saveNpubContact,
}));
vi.mock("./useOwnNprofile", () => ({
  useOwnNprofile: () => state.ownNprofile,
}));
vi.mock("@linky-fit/linkstr-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linky-fit/linkstr-react")>()),
  useLinkstrCommands: () => ({
    enqueueOutbox: async () => Exit.succeed({ rumorId: "ab".repeat(32) }),
  }),
}));
vi.mock("../../hooks/useRouting", () => ({ navigateTo }));

import {
  useOnchainTransferCommands,
  useOnchainTransfers,
  useOnchainTransfersSync,
} from "./useOnchainTransfers";

const operatorIdentity = makeIdentity();
state.operator = {
  npub: encodeNpub(operatorIdentity.pubkey),
  pubkey: operatorIdentity.pubkey,
};

const sendDraft = {
  direction: "send",
  amount: 100_000,
  payoutAddress: REGTEST_ADDRESS,
} as const;

/** The rows of an on-chain send the operator answered with `status`; none for a send still waiting. */
const storedOnchainSend = (
  id: OnchainTransferId,
  status: "accepted" | "cancelled" | "denied" | null,
): readonly OnchainTransferRecord[] => {
  const transfers = makeOnchainTransfersRepository(makeTestLinkyStore().store);
  const planned = planOnchainTransfer({
    draft: sendDraft,
    config: onchainConfigFixture(),
    id,
    nowSec: 1_700_000_000,
    operator: operatorIdentity.pubkey,
    userPaymentRequest: null,
  });
  if (planned === null) throw new Error("unplannable draft");
  Effect.runSync(transfers.insert(planned.row));
  if (status !== null)
    Effect.runSync(
      transfers.update(id, {
        updateJson: NonEmptyString1000.orThrow(
          encodeTransferUpdateColumn(
            onchainTransferUpdateFixture(id, {
              status,
              revision: status === "accepted" ? 1 : 2,
            }),
          ),
        ),
      }),
    );
  return Effect.runSync(transfers.all);
};

interface Hook {
  transfers: readonly OnchainTransferView[];
  commands: ReturnType<typeof useOnchainTransferCommands>;
}

/** Renders the sync and, while `page` is true, a probe exposing the transfers and the commands. */
const renderHook = async () => {
  const hook: { current: Hook | null } = { current: null };
  const Sync = (): null => {
    useOnchainTransfersSync();
    return null;
  };
  const Page = (): null => {
    const transfers = useOnchainTransfers();
    const commands = useOnchainTransferCommands();
    React.useEffect(() => {
      hook.current = { transfers, commands };
    });
    return null;
  };
  const registry = AtomRegistry.make();
  const tree = (page: boolean) => (
    <RegistryContext.Provider value={registry}>
      <Sync />
      {page ? <Page /> : null}
    </RegistryContext.Provider>
  );
  const rendered = await renderIntoDocument(tree(true));
  return { hook, rendered, tree };
};

describe("useOnchainTransferCommands", () => {
  afterEach(() => {
    payOnchainTransferPaymentRequest.mockReset();
    navigateTo.mockReset();
    state.rows = [];
    state.repository = null;
    state.ownNprofile = null;
  });

  it("pays the operator the amount plus the fee right after requesting a send, under the transfer id, and opens the transfer", async () => {
    const repository = makeOnchainTransfersRepository(
      makeTestLinkyStore().store,
    );
    state.repository = repository;
    saveNpubContact.mockClear();
    const { hook, rendered } = await renderHook();

    let requested = false;
    await act(async () => {
      requested =
        (await hook.current?.commands.requestOnchainTransfer(
          sendDraft,
          onchainConfigFixture(),
        )) ?? false;
    });
    expect(requested).toBe(true);
    expect(saveNpubContact).not.toHaveBeenCalled();
    const [stored] = Effect.runSync(repository.all);
    if (stored === undefined) throw new Error("transfer not stored");
    expect(navigateTo).toHaveBeenCalledWith({
      route: "onchainTransfer",
      id: stored.id,
    });

    const [request, callbacks] =
      payOnchainTransferPaymentRequest.mock.calls[0] ?? [];
    expect(decodePaymentRequest(request?.encodedRequest ?? "")).toMatchObject({
      amount: 101_000,
      id: stored.id,
      mints: ["https://mint.example"],
    });
    expect(request?.transportPubkeyHex).toBe(operatorIdentity.pubkey);
    expect(callbacks?.recipientName).toBe(
      `${REGTEST_ADDRESS.slice(0, 9)}...${REGTEST_ADDRESS.slice(-8)}`,
    );
    expect(callbacks?.summary).toBe("Send 100000 sat");
    // The payment starts before the sync holds the row, and goes on while the operator has not answered.
    expect(callbacks?.isPaymentAuthorized()).toBe(true);
    state.rows = storedOnchainSend(stored.id, null);
    await rendered.rerender(<></>);
    await rendered.unmount();
  });

  it("stops the payment once the operator denied or the user cancelled the transfer, even once its page closed", async () => {
    const id = createId<"OnchainTransfer">();
    state.rows = storedOnchainSend(id, "accepted");
    const { hook, rendered, tree } = await renderHook();
    const [transfer] = hook.current?.transfers ?? [];
    expect(transfer?.phase).toBe("readyToSend");
    act(() =>
      hook.current?.commands.sendOnchainTransferPayment(
        transfer,
        onchainConfigFixture(),
      ),
    );
    const [, callbacks] = payOnchainTransferPaymentRequest.mock.calls[0] ?? [];
    expect(callbacks?.isPaymentAuthorized()).toBe(true);

    await rendered.rerender(tree(false));
    for (const status of ["cancelled", "denied"] as const) {
      state.rows = storedOnchainSend(id, status);
      await rendered.rerender(tree(false));
      expect(callbacks?.isPaymentAuthorized()).toBe(false);
    }
    await rendered.unmount();
  });

  it("requests a receive of any amount with an amountless payment request, refunded to the sender", async () => {
    const repository = makeOnchainTransfersRepository(
      makeTestLinkyStore().store,
    );
    state.repository = repository;
    state.ownNprofile = encodeNprofile(makeIdentity().pubkey, []);
    const { hook, rendered } = await renderHook();

    let requested = false;
    await act(async () => {
      requested =
        (await hook.current?.commands.requestOnchainTransfer(
          { direction: "receive", amount: null, payoutAddress: "" },
          onchainConfigFixture(),
        )) ?? false;
    });
    expect(requested).toBe(true);
    expect(payOnchainTransferPaymentRequest).not.toHaveBeenCalled();
    const [stored] = Effect.runSync(repository.all);
    expect(stored).toMatchObject({
      direction: "receive",
      amount: 100_000,
      refundToSender: sqliteTrue,
    });
    expect(
      decodePaymentRequest(stored?.userPaymentRequest ?? ""),
    ).toMatchObject({ amount: null, id: stored?.id });
    await rendered.unmount();
  });
});
