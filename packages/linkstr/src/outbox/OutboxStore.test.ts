import { Effect, Layer, Schema } from "effect";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import {
  CashuTokenText,
  ChatMessageReceipt,
  EditMessageDraft,
  ImageMessageDraft,
  MessageEditReceipt,
  MessageText,
  PrivateImage,
  TextMessageDraft,
  TokenMessageDraft,
} from "../chat/domain";
import { WrapDelivery } from "../domain/delivery";
import {
  ClientId,
  NostrSecretKey,
  Pubkey,
  RelayUrl,
  RumorId,
  UnixSeconds,
  WrapId,
} from "../domain/primitives";
import {
  PaymentTelemetryDraft,
  PaymentTelemetryReceipt,
} from "../paymentTelemetry/domain";
import { Emoji, ReactionDraft, ReactionReceipt } from "../reactions/domain";
import {
  OutboxJobFailed,
  OutboxJobId,
  OutboxJobSucceeded,
  OutboxOperation,
  OutboxRef,
  StoredOutboxJob,
} from "./domain";
import type { OutboxJobState, OutboxReceipt } from "./domain";
import { stubStorage } from "../testing";
import { OutboxStore } from "./OutboxStore";
import type { OutboxStoreService } from "./OutboxStore";

const secretKey = NostrSecretKey.make(generateSecretKey());
const pubkey = Pubkey.make(getPublicKey(secretKey));
const relay = RelayUrl.make("wss://relay.test");
const rumorId = RumorId.make("ab".repeat(32));
const clientId = ClientId.make("client-42");
const sentAt = UnixSeconds.make(1_700_000_000);
const storageKey = "test.outbox";

const delivery = (suffix: string): WrapDelivery =>
  new WrapDelivery({
    wrapId: WrapId.make(suffix.repeat(32)),
    acceptedBy: [relay],
    rejectedBy: [],
  });

const makeJob = (id: string, state?: OutboxJobState): StoredOutboxJob =>
  new StoredOutboxJob({
    jobId: OutboxJobId.make(id),
    ref: OutboxRef.make(`ref-${id}`),
    operation: {
      _tag: "chat.text",
      draft: new TextMessageDraft({
        to: pubkey,
        content: MessageText.make("hi"),
        clientId,
        sentAt,
      }),
    },
    pubkey,
    enqueuedAt: sentAt,
    state: state ?? { _tag: "queued" },
  });

const telemetryDraft = new PaymentTelemetryDraft({
  id: clientId,
  createdAtSec: sentAt,
  direction: "out",
  status: "ok",
  method: "lightning_invoice",
  phase: "complete",
  mint: null,
  amountBucket: "lte_100",
  feeBucket: null,
  errorCode: null,
  errorDetail: null,
  appHost: null,
  devicePlatform: null,
  appRuntime: null,
  appVersion: "26.9.0",
});

const succeededWith = (id: string, receipt: OutboxReceipt): OutboxJobState => ({
  _tag: "awaiting-ack",
  result: new OutboxJobSucceeded({
    jobId: OutboxJobId.make(id),
    ref: OutboxRef.make(`ref-${id}`),
    receipt,
  }),
});

const buildStore = (layer: Layer.Layer<OutboxStore>): OutboxStoreService =>
  Effect.runSync(OutboxStore.pipe(Effect.provide(layer)));

const run = <A>(effect: Effect.Effect<A>): A => Effect.runSync(effect);

describe("OutboxStore.fromStringStorage", () => {
  it("persists jobs under the given key across store rebuilds", () => {
    const storage = stubStorage();

    const store = buildStore(
      OutboxStore.fromStringStorage(storage, storageKey),
    );
    run(store.insert(makeJob("job-1")));
    run(store.insert(makeJob("job-2")));
    run(
      store.update(
        makeJob("job-1", {
          _tag: "awaiting-ack",
          result: new OutboxJobFailed({
            jobId: OutboxJobId.make("job-1"),
            ref: OutboxRef.make("ref-job-1"),
            reason: "unexpected-error",
            detail: "boom",
          }),
        }),
      ),
    );
    run(store.remove(OutboxJobId.make("job-2")));

    expect([...storage.map.keys()]).toEqual([storageKey]);

    const rebuilt = buildStore(
      OutboxStore.fromStringStorage(storage, storageKey),
    );
    const jobs = run(rebuilt.loadAll);
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job).toBeInstanceOf(StoredOutboxJob);
    expect(job?.jobId).toBe("job-1");
    expect(job?.state._tag).toBe("awaiting-ack");
    if (job?.state._tag !== "awaiting-ack") return;
    expect(job.state.result).toBeInstanceOf(OutboxJobFailed);
  });

  it("treats an unreadable stored value as empty", () => {
    const storage = stubStorage();
    storage.map.set(storageKey, "not json at all");

    const store = buildStore(
      OutboxStore.fromStringStorage(storage, storageKey),
    );
    expect(run(store.loadAll)).toEqual([]);
    run(store.insert(makeJob("job-1")));
    expect(run(store.loadAll)).toHaveLength(1);
  });
});

describe("OutboxStore.inMemory", () => {
  it("keeps insertion order through insert, update, and remove", () => {
    const store = buildStore(OutboxStore.inMemory);
    run(store.insert(makeJob("job-1")));
    run(store.insert(makeJob("job-2")));
    run(store.insert(makeJob("job-3")));
    run(
      store.update(
        makeJob("job-2", {
          _tag: "awaiting-ack",
          result: new OutboxJobFailed({
            jobId: OutboxJobId.make("job-2"),
            ref: OutboxRef.make("ref-job-2"),
            reason: "identity-changed",
            detail: "test",
          }),
        }),
      ),
    );
    run(store.remove(OutboxJobId.make("job-1")));

    const jobs = run(store.loadAll);
    expect(jobs.map((job) => job.jobId)).toEqual(["job-2", "job-3"]);
    expect(jobs[0]?.state._tag).toBe("awaiting-ack");
  });
});

const editOf = RumorId.make("12".repeat(32));
const peerReceipt = {
  rumorId,
  clientId,
  sentAt,
  selfCopy: delivery("cd"),
  recipientCopy: delivery("ef"),
};
const cashuToken = `cashuA${Buffer.from(
  JSON.stringify({
    token: [{ mint: "https://mint.test", proofs: [{ amount: 8 }] }],
    unit: "sat",
  }),
)
  .toString("base64url")
  .replace(/=+$/g, "")}`;
const image = new PrivateImage({
  url: "https://blossom.test/image",
  fileType: "image/jpeg",
  encryptionAlgorithm: "aes-gcm",
  key: "01".repeat(32),
  nonce: "02".repeat(12),
  encryptedSha256: "03".repeat(32),
  originalSha256: "04".repeat(32),
  encryptedSize: 1234,
  width: 640,
  height: 480,
  storageEncoding: "base64",
});

/** Receipt JSON as the two pre-tag generations wrote it, `rumorId` aside. */
const wireDelivery = (suffix: string) => ({
  wrapId: suffix.repeat(32),
  acceptedBy: [relay],
  rejectedBy: [],
});
const wirePeerCopies = {
  clientId,
  sentAt,
  selfCopy: wireDelivery("cd"),
  recipientCopy: wireDelivery("ef"),
};

interface ReceiptCase {
  readonly name: string;
  readonly operation: OutboxOperation;
  readonly receipt: OutboxReceipt;
  readonly receiptClass:
    | typeof ChatMessageReceipt
    | typeof MessageEditReceipt
    | typeof ReactionReceipt
    | typeof PaymentTelemetryReceipt;
  /** Pre-#319 shape: per-vertical id key, no `_tag`. */
  readonly preRenameJson: Record<string, unknown>;
  /** #319 shape: `rumorId`, no `_tag`. */
  readonly untaggedJson: Record<string, unknown>;
}

const chatReceiptCase = (
  name: string,
  operation: OutboxOperation,
): ReceiptCase => ({
  name,
  operation,
  receipt: new ChatMessageReceipt(peerReceipt),
  receiptClass: ChatMessageReceipt,
  preRenameJson: { messageId: rumorId, ...wirePeerCopies },
  untaggedJson: { rumorId, ...wirePeerCopies },
});

const receiptCases: ReadonlyArray<ReceiptCase> = [
  chatReceiptCase("chat.text", {
    _tag: "chat.text",
    draft: new TextMessageDraft({
      to: pubkey,
      content: MessageText.make("hi"),
      clientId,
      sentAt,
    }),
  }),
  chatReceiptCase("chat.token", {
    _tag: "chat.token",
    draft: new TokenMessageDraft({
      to: pubkey,
      token: CashuTokenText.make(cashuToken),
      clientId,
      sentAt,
    }),
  }),
  chatReceiptCase("chat.image", {
    _tag: "chat.image",
    draft: new ImageMessageDraft({ to: pubkey, image, clientId, sentAt }),
  }),
  {
    name: "chat.edit",
    operation: {
      _tag: "chat.edit",
      draft: new EditMessageDraft({
        to: pubkey,
        editOf,
        content: MessageText.make("hi, edited"),
        clientId,
        sentAt,
      }),
    },
    receipt: new MessageEditReceipt({ ...peerReceipt, editOf }),
    receiptClass: MessageEditReceipt,
    preRenameJson: { messageId: rumorId, editOf, ...wirePeerCopies },
    untaggedJson: { rumorId, editOf, ...wirePeerCopies },
  },
  {
    name: "reaction",
    operation: {
      _tag: "reaction",
      draft: new ReactionDraft({
        to: pubkey,
        target: editOf,
        targetKind: "text",
        targetAuthor: pubkey,
        emoji: Emoji.make("👍"),
        clientId,
        sentAt,
      }),
    },
    receipt: new ReactionReceipt(peerReceipt),
    receiptClass: ReactionReceipt,
    preRenameJson: { reactionId: rumorId, ...wirePeerCopies },
    untaggedJson: { rumorId, ...wirePeerCopies },
  },
  {
    name: "paymentTelemetry",
    operation: {
      _tag: "paymentTelemetry",
      draft: telemetryDraft,
      recipient: pubkey,
    },
    receipt: new PaymentTelemetryReceipt({
      rumorId,
      clientId,
      sentAt,
      recipientCopy: delivery("ef"),
    }),
    receiptClass: PaymentTelemetryReceipt,
    preRenameJson: {
      telemetryId: rumorId,
      clientId,
      sentAt,
      recipientCopy: wireDelivery("ef"),
    },
    untaggedJson: {
      rumorId,
      clientId,
      sentAt,
      recipientCopy: wireDelivery("ef"),
    },
  },
];

const encodeOperation = Schema.encodeSync(OutboxOperation);

const storeSucceededJobJson = (
  storage: ReturnType<typeof stubStorage>,
  operation: OutboxOperation,
  receipt: Record<string, unknown>,
): void => {
  const job = {
    jobId: "job",
    ref: "ref-job",
    operation: encodeOperation(operation),
    pubkey,
    enqueuedAt: sentAt,
    state: {
      _tag: "awaiting-ack",
      result: {
        _tag: "OutboxJobSucceeded",
        jobId: "job",
        ref: "ref-job",
        receipt,
      },
    },
  };
  storage.map.set(storageKey, JSON.stringify([job]));
};

const loadSingleSucceededJob = (
  storage: ReturnType<typeof stubStorage>,
): { operation: OutboxOperation; receipt: OutboxReceipt } => {
  const [job] = run(
    buildStore(OutboxStore.fromStringStorage(storage, storageKey)).loadAll,
  );
  if (
    job?.state._tag !== "awaiting-ack" ||
    !(job.state.result instanceof OutboxJobSucceeded)
  ) {
    throw new Error("expected one awaiting-ack success");
  }
  return { operation: job.operation, receipt: job.state.result.receipt };
};

describe.each(receiptCases)(
  "OutboxStore.fromStringStorage $name receipt",
  ({ operation, receipt, receiptClass, preRenameJson, untaggedJson }) => {
    it("revives the same receipt class through the JSON roundtrip", () => {
      const storage = stubStorage();
      run(
        buildStore(OutboxStore.fromStringStorage(storage, storageKey)).insert(
          new StoredOutboxJob({
            ...makeJob("job", succeededWith("job", receipt)),
            operation,
          }),
        ),
      );

      const loaded = loadSingleSucceededJob(storage);
      expect(loaded.operation).toEqual(operation);
      expect(loaded.receipt).toBeInstanceOf(receiptClass);
      expect(loaded.receipt).toEqual(receipt);
    });

    it("decodes the pre-rumorId persisted shape", () => {
      const storage = stubStorage();
      storeSucceededJobJson(storage, operation, preRenameJson);

      const loaded = loadSingleSucceededJob(storage);
      expect(loaded.receipt).toBeInstanceOf(receiptClass);
      expect(loaded.receipt).toEqual(receipt);
    });

    it("decodes the untagged rumorId persisted shape", () => {
      const storage = stubStorage();
      storeSucceededJobJson(storage, operation, untaggedJson);

      const loaded = loadSingleSucceededJob(storage);
      expect(loaded.receipt).toBeInstanceOf(receiptClass);
      expect(loaded.receipt).toEqual(receipt);
    });
  },
);
