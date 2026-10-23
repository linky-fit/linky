import { createId } from "@linky-fit/linksync";
import { describe, expect, it } from "vitest";
import {
  onchainTransferUpdateFixture,
  REGTEST_ADDRESS,
} from "../../testUtils/onchainTransfers";
import { getOnchainTransferUpdateCopyForLanguage } from "./onchainTransferPushCopy";

const update = (
  overrides: Parameters<typeof onchainTransferUpdateFixture>[1],
) => onchainTransferUpdateFixture(createId<"OnchainTransfer">(), overrides);

describe("getOnchainTransferUpdateCopyForLanguage", () => {
  it("tells the direction of accepted details by the deposit address, and what to pay apart from what arrives", () => {
    expect(
      getOnchainTransferUpdateCopyForLanguage(
        "en-US",
        update({ status: "accepted", paymentRequest: "creqAoperator" }),
      ),
    ).toBe(
      "Ready: pay 101,000 sat to send 100,000 sat to your bitcoin wallet.",
    );
    expect(
      getOnchainTransferUpdateCopyForLanguage(
        "cs-CZ",
        update({ status: "accepted", depositAddress: REGTEST_ADDRESS }),
      ),
    ).toBe("Připraveno: pošlete 101\u00a0000 sat ze své bitcoinové peněženky.");
  });

  it("names the outcome and falls back to a plain update in between", () => {
    expect(
      getOnchainTransferUpdateCopyForLanguage(
        "de",
        update({ status: "completed" }),
      ),
    ).toBe("Deine On-Chain-Transaktion ist abgeschlossen");
    expect(
      getOnchainTransferUpdateCopyForLanguage(
        "en",
        update({ status: "completed", depositAddress: REGTEST_ADDRESS }),
      ),
    ).toBe("Your on-chain transaction was updated");
    expect(
      getOnchainTransferUpdateCopyForLanguage(
        "pt-BR",
        update({ status: "fundsSeen", confirmations: 1 }),
      ),
    ).toBe("Sua transação on-chain foi atualizada");
  });
});
