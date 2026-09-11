import { Effect } from "effect";
import {
  Amount,
  Melt,
  MeltDraft,
  Receive,
  ReceiveDraft,
  Restore,
  RestoreDraft,
  runLinkshu,
  Send,
  SendDraft,
  Tokens,
} from "../../src";
import {
  availableTotalOf,
  fundToken,
  invoiceFor,
  mintUrl,
  randomSeed,
} from "./helpers";

describe("melt vertical against the local mint", () => {
  it("pays a bolt11 invoice with correct fee and change accounting, and restore reproduces the state", async () => {
    const seed = randomSeed();
    const funded = await fundToken(64);
    const invoice = await invoiceFor(21);
    const draft = new MeltDraft({ mint: mintUrl, invoice });

    const paid = await runLinkshu(
      { bip39Seed: seed },
      Effect.gen(function* () {
        const receive = yield* Receive;
        const melt = yield* Melt;
        const tokens = yield* Tokens;
        const funding = yield* receive.receive(
          new ReceiveDraft({ text: funded }),
        );
        const quoted = yield* melt.quote(draft);
        const receipt = yield* melt.melt(draft);
        return {
          funding,
          quoted,
          receipt,
          proofs: yield* tokens.proofs,
          operations: yield* tokens.operations,
        };
      }),
    );

    expect(paid.quoted.mint).toBe(mintUrl);
    expect(paid.quoted.amount).toBe(21);
    expect(paid.receipt.paidAmount).toBe(21);
    expect(paid.receipt.feeReserve).toBe(paid.quoted.feeReserve);

    // The inputs transitioned: nothing is held any more, the melt is closed
    // as paid, and only available change/remainder plus spent inputs remain.
    expect(paid.proofs.some((proof) => proof.state === "held")).toBe(false);
    expect(
      paid.proofs.every(
        (proof) => proof.state === "available" || proof.state === "spent",
      ),
    ).toBe(true);
    expect(
      paid.operations.find((operation) => operation.kind === "melt"),
    ).toMatchObject({ status: "paid", quoteId: paid.receipt.quoteId });

    // Funds conservation: everything the wallet lost is the invoice, the
    // melt fee, and a small swap fee (input_fee_ppk = 100 on this mint).
    const availableTotal = availableTotalOf(paid.proofs);
    const swapFee =
      paid.funding.amount -
      availableTotal -
      paid.receipt.paidAmount -
      paid.receipt.feePaid;
    expect(swapFee).toBeGreaterThanOrEqual(0);
    expect(swapFee).toBeLessThanOrEqual(2);
    // The melt fee stays within the reserve plus the inputs' own input fee.
    expect(paid.receipt.feePaid).toBeLessThanOrEqual(
      paid.receipt.feeReserve + 2,
    );

    // Restore from seed alone (fresh stores) reproduces the wallet state:
    // deterministic blank-output accounting means the melt change and the
    // swap remainder come back, and the counters land past every used slot,
    // so a follow-up spend does not collide.
    const restored = await runLinkshu(
      { bip39Seed: seed },
      Effect.gen(function* () {
        const report = yield* (yield* Restore).restore(
          new RestoreDraft({ mints: [mintUrl] }),
        );
        const sent = yield* (yield* Send).send(
          new SendDraft({
            mint: mintUrl,
            amount: Amount.make(2),
            produceAs: "issued",
          }),
        );
        return { report, sent };
      }),
    );
    expect(restored.report.restoredAmount).toBe(availableTotal);
    expect(restored.sent.amount).toBe(2);
  });

  it("fails with typed InsufficientFunds when the balance cannot cover amount + reserve", async () => {
    const funded = await fundToken(5);
    const invoice = await invoiceFor(50);

    const { funding, quoted, failure, proofs } = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const receive = yield* Receive;
        const melt = yield* Melt;
        const funding = yield* receive.receive(
          new ReceiveDraft({ text: funded }),
        );
        const draft = new MeltDraft({ mint: mintUrl, invoice });
        const quoted = yield* melt.quote(draft);
        const failure = yield* Effect.flip(melt.melt(draft));
        return {
          funding,
          quoted,
          failure,
          proofs: yield* (yield* Tokens).proofs,
        };
      }),
    );

    expect(quoted.amount).toBe(50);
    expect(failure).toMatchObject({
      _tag: "InsufficientFunds",
      mint: mintUrl,
      required: 50 + quoted.feeReserve,
    });
    // The balance is untouched.
    expect(proofs.every((proof) => proof.state === "available")).toBe(true);
    expect(availableTotalOf(proofs)).toBe(funding.amount);
  });
});
