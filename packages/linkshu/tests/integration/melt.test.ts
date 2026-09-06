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
  TokenStore,
} from "../../src";
import {
  acceptedTotalOf,
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
        const funding = yield* receive.receive(
          new ReceiveDraft({ text: funded }),
        );
        const quoted = yield* melt.quote(draft);
        const receipt = yield* melt.melt(draft);
        return {
          funding,
          quoted,
          receipt,
          rows: yield* (yield* TokenStore).loadAll,
        };
      }),
    );

    expect(paid.quoted.mint).toBe(mintUrl);
    expect(paid.quoted.amount).toBe(21);
    expect(paid.receipt.paidAmount).toBe(21);
    expect(paid.receipt.feeReserve).toBe(paid.quoted.feeReserve);

    // Consumed rows transitioned correctly: nothing reserved or errored
    // remains, only accepted change/remainder rows.
    expect(paid.rows.every((row) => row.state === "accepted")).toBe(true);

    // Funds conservation: everything the wallet lost is the invoice, the
    // melt fee, and a small swap fee (input_fee_ppk = 100 on this mint).
    const acceptedTotal = acceptedTotalOf(paid.rows);
    const swapFee =
      paid.funding.amount -
      acceptedTotal -
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
    expect(restored.report.restoredAmount).toBe(acceptedTotal);
    expect(restored.sent.amount).toBe(2);
  });

  it("fails with typed InsufficientFunds when the balance cannot cover amount + reserve", async () => {
    const funded = await fundToken(5);
    const invoice = await invoiceFor(50);

    const { quoted, failure, rows } = await runLinkshu(
      { bip39Seed: randomSeed() },
      Effect.gen(function* () {
        const receive = yield* Receive;
        const melt = yield* Melt;
        yield* receive.receive(new ReceiveDraft({ text: funded }));
        const draft = new MeltDraft({ mint: mintUrl, invoice });
        const quoted = yield* melt.quote(draft);
        const failure = yield* Effect.flip(melt.melt(draft));
        return { quoted, failure, rows: yield* (yield* TokenStore).loadAll };
      }),
    );

    expect(quoted.amount).toBe(50);
    expect(failure).toMatchObject({
      _tag: "InsufficientFunds",
      mint: mintUrl,
      required: 50 + quoted.feeReserve,
    });
    // The balance is untouched.
    expect(rows.every((row) => row.state === "accepted")).toBe(true);
  });
});
