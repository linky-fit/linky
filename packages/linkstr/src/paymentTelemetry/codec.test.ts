import { generateSecretKey, getEventHash, getPublicKey } from "nostr-tools";
import { ClientId, Pubkey, UnixSeconds } from "../domain/primitives";
import { encodePaymentTelemetryRumor } from "./codec";
import { PaymentTelemetryDraft } from "./domain";

const author = Pubkey.make(getPublicKey(generateSecretKey()));
const recipient = Pubkey.make(getPublicKey(generateSecretKey()));
const sentAt = UnixSeconds.make(1_754_000_000);

const draft = new PaymentTelemetryDraft({
  id: ClientId.make("telemetry-1"),
  createdAtSec: UnixSeconds.make(1_753_999_900),
  direction: "out",
  status: "error",
  method: "lightning_address",
  phase: "melt",
  mint: "https://mint.example/Bitcoin",
  amountBucket: "lte_1000",
  feeBucket: null,
  errorCode: "network",
  errorDetail: "fetch failed",
  appHost: "app.example",
  devicePlatform: "android",
  appRuntime: "pwa",
  appVersion: "26.9.0",
});

describe("payment telemetry rumor encoding", () => {
  it("preserves the collector wire shape", () => {
    const rumor = encodePaymentTelemetryRumor(draft, author, recipient, sentAt);

    expect(rumor).toEqual(
      expect.objectContaining({
        pubkey: author,
        created_at: sentAt,
        kind: 24134,
        tags: [
          ["p", recipient],
          ["client", "telemetry-1"],
          ["linky", "payment_telemetry"],
        ],
      }),
    );
    expect(JSON.parse(rumor.content)).toEqual({
      v: 1,
      id: "telemetry-1",
      createdAtSec: 1_753_999_900,
      direction: "out",
      status: "error",
      method: "lightning_address",
      phase: "melt",
      paymentType: null,
      mint: "https://mint.example/Bitcoin",
      amountBucket: "lte_1000",
      feeBucket: null,
      errorCode: "network",
      errorDetail: "fetch failed",
      appHost: "app.example",
      devicePlatform: "android",
      appRuntime: "pwa",
      appVersion: "26.9.0",
    });
    expect(rumor.id).toBe(getEventHash(rumor));
  });

  it("names the kind of payment that went out", () => {
    const rumor = encodePaymentTelemetryRumor(
      new PaymentTelemetryDraft({ ...draft, paymentType: "recurring" }),
      author,
      recipient,
      sentAt,
    );

    expect(JSON.parse(rumor.content)).toMatchObject({
      paymentType: "recurring",
    });
  });
});
