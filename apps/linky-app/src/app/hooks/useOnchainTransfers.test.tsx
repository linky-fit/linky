import { PaymentRequestId } from "@linky-fit/linkshu/payment-request";
import {
  createId,
  makeOnchainTransfersRepository,
  NonEmptyString1000,
  type OnchainTransferRecord,
  type OnchainTransfersRepository,
  type OnchainTransferId,
} from "@linky-fit/linksync";
import { encodeNpub } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import { encodeTransferUpdateColumn } from "@linky-fit/onchain-transfer";
import { Effect, Exit } from "effect";
import { nip19 } from "nostr-tools";
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
import { buildCashuPaymentRequestMessage } from "../lib/paymentRequestMessage";
import type { OnchainTransferPaymentOptions } from "../state/wallet/walletCommands";

const { navigateTo, payOnchainTransferPaymentRequest, saveNpubContact, state } =
  vi.hoisted(() => {
    const state: {
      operator: OnchainOperator | null;
      rows: readonly OnchainTransferRecord[];
      repository: OnchainTransfersRepository | null;
    } = { operator: null, rows: [], repository: null };
    return {
      navigateTo: vi.fn<(action: unknown) => void>(),
      payOnchainTransferPaymentRequest:
        vi.fn<
          (request: unknown, options: OnchainTransferPaymentOptions) => void
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
    t: (key) =>
      key === "onchainSendConfirmSummary" ? "Send {amount} to {address}" : key,
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
vi.mock("./useOwnNprofile", () => ({ useOwnNprofile: () => null }));
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

/** The rows of an on-chain send the operator answered with `status`, offering its request for the amount plus the fee. */
const answeredOnchainTransfer = (
  id: OnchainTransferId,
  status: "accepted" | "cancelled" | "denied",
): readonly OnchainTransferRecord[] => {
  const transfers = makeOnchainTransfersRepository(makeTestLinkyStore().store);
  const planned = planOnchainTransfer({
    draft: {
      direction: "send",
      amount: 100_000,
      payoutAddress: REGTEST_ADDRESS,
      refundAddress: "",
      refundToSender: false,
    },
    config: onchainConfigFixture(),
    id,
    nowSec: 1_700_000_000,
    operator: operatorIdentity.pubkey,
    userPaymentRequest: null,
  });
  if (planned === null) throw new Error("unplannable draft");
  Effect.runSync(transfers.insert(planned.row));
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
      operatorPaymentRequest: NonEmptyString1000.orThrow(
        buildCashuPaymentRequestMessage({
          amount: 101_000,
          mintUrls: ["https://mint.example"],
          recipientNprofile: nip19.nprofileEncode({
            pubkey: operatorIdentity.pubkey,
            relays: [],
          }),
          requestId: PaymentRequestId.make(id),
        }),
      ),
    }),
  );
  return Effect.runSync(transfers.all);
};

describe("useOnchainTransferCommands", () => {
  afterEach(() => {
    payOnchainTransferPaymentRequest.mockReset();
  });

  it("reviews the payment as support's, and stops paying a transfer the operator cancelled or denied while it was reviewed, even once its page closed", async () => {
    const id = createId<"OnchainTransfer">();
    state.rows = answeredOnchainTransfer(id, "accepted");
    const hook: {
      current: {
        transfers: readonly OnchainTransferView[];
        send: (transfer: OnchainTransferView) => void;
      } | null;
    } = { current: null };
    const Sync = (): null => {
      useOnchainTransfersSync();
      return null;
    };
    const Page = (): null => {
      const transfers = useOnchainTransfers();
      const { sendOnchainTransferPayment } = useOnchainTransferCommands();
      React.useEffect(() => {
        hook.current = { transfers, send: sendOnchainTransferPayment };
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
    const [transfer] = hook.current?.transfers ?? [];
    expect(transfer?.phase).toBe("readyToSend");
    act(() => hook.current?.send(transfer));

    const [, callbacks] = payOnchainTransferPaymentRequest.mock.calls[0] ?? [];
    expect(callbacks?.isPaymentAuthorized()).toBe(true);
    expect(callbacks?.recipientName).toBe("onchainSupportName");
    expect(callbacks?.summary).toBe(
      `Send 100000 sat to ${REGTEST_ADDRESS.slice(0, 9)}...${REGTEST_ADDRESS.slice(-8)}`,
    );

    await rendered.rerender(tree(false));
    for (const status of ["cancelled", "denied"] as const) {
      state.rows = answeredOnchainTransfer(id, status);
      await rendered.rerender(tree(false));
      expect(callbacks?.isPaymentAuthorized()).toBe(false);
    }
    await rendered.unmount();
  });

  it("opens the transfer it requested without saving the operator as a contact", async () => {
    const repository = makeOnchainTransfersRepository(
      makeTestLinkyStore().store,
    );
    state.repository = repository;
    state.rows = [];
    saveNpubContact.mockClear();
    const hook: {
      current: ReturnType<typeof useOnchainTransferCommands> | null;
    } = { current: null };
    const Probe = (): null => {
      const commands = useOnchainTransferCommands();
      React.useEffect(() => {
        hook.current = commands;
      });
      return null;
    };
    const rendered = await renderIntoDocument(
      <RegistryContext.Provider value={AtomRegistry.make()}>
        <Probe />
      </RegistryContext.Provider>,
    );

    let requested = false;
    await act(async () => {
      requested =
        (await hook.current?.requestOnchainTransfer(
          {
            direction: "send",
            amount: 100_000,
            payoutAddress: REGTEST_ADDRESS,
            refundAddress: "",
            refundToSender: false,
          },
          onchainConfigFixture(),
        )) ?? false;
    });

    expect(requested).toBe(true);
    expect(saveNpubContact).not.toHaveBeenCalled();
    const [stored] = Effect.runSync(repository.all);
    expect(navigateTo).toHaveBeenCalledWith({
      route: "onchainTransfer",
      id: stored?.id,
    });
    await rendered.unmount();
    state.repository = null;
  });
});
