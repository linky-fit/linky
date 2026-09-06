// Registry comes through the package index to cover the atom-react re-export.
import { Registry } from "./index";
import { BankOfferDraft, BankOfferId, ClientId } from "@linky/linkstr";
import { recipientOf, stubWrapTransport } from "@linky/linkstr/testing";
import type { SignedWrapEvent } from "@linky/linkstr/testing";
import { Exit } from "effect";
import { sendBankOfferAtom } from "./bankOffers";
import { linkstrConfigAtom } from "./config";
import { configWith, makeIdentity, settle } from "./testing";

const alice = makeIdentity();
const bob = makeIdentity();

describe("sendBankOfferAtom", () => {
  it("delivers through the configured transport and returns a receipt", async () => {
    const registry = Registry.make();
    const published: Array<SignedWrapEvent> = [];
    registry.set(
      linkstrConfigAtom,
      configWith(alice, stubWrapTransport(published)),
    );

    registry.set(
      sendBankOfferAtom,
      new BankOfferDraft({
        to: bob.pubkey,
        offerId: BankOfferId.make("offer-react"),
        offerer: alice.pubkey,
        status: "offered",
        amountText: "1 000 Kč",
        text: "Zaplatíš za mě bankovní platbu?",
        clientId: ClientId.make("client-react"),
      }),
    );
    const exit = await settle(registry, sendBankOfferAtom);

    assert(Exit.isSuccess(exit));
    expect(exit.value).toEqual(
      expect.objectContaining({
        offerId: "offer-react",
        status: "offered",
        clientId: "client-react",
      }),
    );
    expect(exit.value.rumorId).toMatch(/^[0-9a-f]{64}$/);
    expect(published.map(recipientOf)).toEqual([bob.pubkey, alice.pubkey]);
  });
});
