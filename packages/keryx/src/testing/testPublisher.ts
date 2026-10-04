import { ed25519 } from "@noble/curves/ed25519";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Fetch } from "../domain";
import { canonicalJsonBytes } from "../internal/canonicalJson";
import { keyIdOf, sha256Hex } from "../internal/crypto";

export const ORIGIN = "https://acme.example";
export const REPO_BASE = "https://cdn.acme.example/keryx/";
export const FEED_URL =
  "https://shop.acme.example/channels/tracking/AAAAAAAAAAAAAAAAAAAAAA/feed.json";
export const NOW = new Date("2030-01-01T00:00:00Z");
export const FUTURE = "2031-01-01T00:00:00Z";
export const PAST = "2029-01-01T00:00:00Z";

export interface TestKey {
  readonly secretKey: Uint8Array;
  readonly keyid: string;
  readonly object: {
    readonly keytype: "ed25519";
    readonly scheme: "ed25519";
    readonly keyval: { readonly public: string };
  };
}

export const makeKey = (): TestKey => {
  const secretKey = ed25519.utils.randomPrivateKey();
  const publicHex = bytesToHex(ed25519.getPublicKey(secretKey));
  return {
    secretKey,
    keyid: keyIdOf(publicHex),
    object: {
      keytype: "ed25519",
      scheme: "ed25519",
      keyval: { public: publicHex },
    },
  };
};

const sign = (value: object, key: TestKey): Uint8Array =>
  ed25519.sign(canonicalJsonBytes(value) ?? new Uint8Array(), key.secretKey);

export const signMetadata = (signed: object, keys: ReadonlyArray<TestKey>) => ({
  signatures: keys.map((key) => ({
    keyid: key.keyid,
    sig: bytesToHex(sign(signed, key)),
  })),
  signed,
});

/** Signs a document (an item or a private feed) the Keryx way: base64url over everything but `sig`. */
export const signDocument = <T extends object>(
  document: T,
  keys: ReadonlyArray<TestKey>,
): T & { readonly sig: ReadonlyArray<{ keyid: string; sig: string }> } => ({
  ...document,
  sig: keys.map((key) => ({
    keyid: key.keyid,
    sig: Buffer.from(sign(document, key)).toString("base64url"),
  })),
});

const keysOf = (keys: ReadonlyArray<TestKey>) =>
  Object.fromEntries(keys.map((key) => [key.keyid, key.object]));

const metaOf = (bytes: Uint8Array, version: number) => ({
  version,
  length: bytes.length,
  hashes: { sha256: sha256Hex(bytes) },
});

const encode = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value, null, 2));

export interface TestChannel {
  key: TestKey;
  authors?: ReadonlyArray<TestKey>;
  authorsThreshold?: number;
  authorsPaths?: ReadonlyArray<string>;
  items: Record<string, object>;
}

/**
 * A fake company: keys, a mutable description of its repository, and a
 * `fetch` that serves whatever `publishRoot`/`publish`/`publishFeed` wrote.
 */
export const makeTestPublisher = () => {
  const files = new Map<string, Uint8Array>();
  const requests: string[] = [];
  const keys = {
    master: makeKey(),
    ops: makeKey(),
    engine: makeKey(),
  };
  const author = makeKey();
  const channels: Record<string, TestChannel> = {
    news: { key: makeKey(), items: {} },
    alerts: { key: makeKey(), authors: [author], items: {} },
  };
  const rootCustom: Record<string, unknown> = {
    repo_base: REPO_BASE,
    mode: "full",
  };
  const custom: Record<string, unknown> = {
    company_name: "ACME s.r.o.",
    logo: "https://acme.example/logo.png",
    logo_sha256: "a".repeat(64),
  };
  const state = {
    rootVersion: 0,
    rootKey: keys.master,
    rootCustom,
    custom,
    expires: FUTURE,
    timestampExpires: FUTURE,
    versions: new Map<string, number>(),
    feedVersion: 0,
  };
  const bump = (file: string) => {
    const version = (state.versions.get(file) ?? 0) + 1;
    state.versions.set(file, version);
    return version;
  };
  const put = (url: string, value: unknown): Uint8Array => {
    const bytes = encode(value);
    files.set(url, bytes);
    return bytes;
  };

  const fetch: Fetch = async (url) => {
    requests.push(url);
    const bytes = files.get(url);
    return bytes === undefined
      ? new Response("not found", { status: 404 })
      : new Response(bytes.slice(), { status: 200 });
  };

  const rootSigned = (version: number, rootKey: TestKey) => ({
    _type: "root",
    spec_version: "1.0.31",
    version,
    expires: state.expires,
    consistent_snapshot: false,
    keys: keysOf([rootKey, keys.ops]),
    roles: {
      root: { keyids: [rootKey.keyid], threshold: 1 },
      targets: { keyids: [rootKey.keyid], threshold: 1 },
      snapshot: { keyids: [keys.ops.keyid], threshold: 1 },
      timestamp: { keyids: [keys.ops.keyid], threshold: 1 },
    },
    custom: state.rootCustom,
  });

  /** Writes the next root to the well-known anchor (`N.root.json` and `root.json`). */
  const publishRoot = (options?: {
    readonly rootKey?: TestKey;
    readonly signers?: ReadonlyArray<TestKey>;
    readonly at?: string;
  }) => {
    const rootKey = options?.rootKey ?? state.rootKey;
    const signers = options?.signers ?? [state.rootKey, rootKey];
    state.rootVersion += 1;
    const envelope = signMetadata(rootSigned(state.rootVersion, rootKey), [
      ...new Set(signers),
    ]);
    const at = options?.at ?? `${ORIGIN}/.well-known/keryx/`;
    put(`${at}${state.rootVersion}.root.json`, envelope);
    if (options?.at === undefined) {
      put(`${at}root.json`, envelope);
      state.rootKey = rootKey;
    }
    return envelope;
  };

  const item = (
    channel: string,
    id: string,
    fields: Record<string, unknown> = {},
    signers?: ReadonlyArray<TestKey>,
  ) => {
    const target = channels[channel];
    if (target === undefined) throw new Error(`no channel ${channel}`);
    const signed = signDocument(
      {
        id,
        title: `${channel} ${id}`,
        content_html: `<p>${id}</p>`,
        date_published: "2029-06-01T00:00:00Z",
        ...fields,
      },
      signers ?? target.authors ?? [target.key],
    );
    target.items[id] = signed;
    return signed;
  };

  /** Re-signs targets, every channel role, snapshot and timestamp, and uploads the items. */
  const publish = () => {
    const roles = Object.entries(channels).flatMap(([name, channel]) => [
      {
        name: `channels.${name}`,
        keyids: [channel.key.keyid],
        threshold: 1,
        paths: [`channels/${name}/*`],
        terminating: true,
      },
      ...(channel.authors === undefined
        ? []
        : [
            {
              name: `channels.${name}.authors`,
              keyids: channel.authors.map((key) => key.keyid),
              threshold: channel.authorsThreshold ?? 1,
              paths: channel.authorsPaths ?? [`channels/${name}/*`],
              terminating: false,
            },
          ]),
    ]);
    const meta: Record<string, ReturnType<typeof metaOf>> = {};
    for (const [name, channel] of Object.entries(channels)) {
      const targets: Record<
        string,
        { length: number; hashes: { sha256: string } }
      > = {};
      for (const [id, value] of Object.entries(channel.items)) {
        const path = `channels/${name}/${id}.json`;
        const bytes = put(`${REPO_BASE}${path}`, value);
        targets[path] = {
          length: bytes.length,
          hashes: { sha256: sha256Hex(bytes) },
        };
      }
      const file = `channels.${name}.json`;
      const version = bump(file);
      const bytes = put(
        `${REPO_BASE}${file}`,
        signMetadata(
          {
            _type: "targets",
            spec_version: "1.0.31",
            version,
            expires: state.expires,
            targets,
            delegations: { keys: {}, roles: [] },
          },
          [channel.key],
        ),
      );
      meta[file] = metaOf(bytes, version);
    }
    const targetsVersion = bump("targets.json");
    const targetsBytes = put(
      `${REPO_BASE}targets.json`,
      signMetadata(
        {
          _type: "targets",
          spec_version: "1.0.31",
          version: targetsVersion,
          expires: state.expires,
          targets: {},
          delegations: {
            keys: keysOf(
              Object.values(channels).flatMap((channel) => [
                channel.key,
                ...(channel.authors ?? []),
              ]),
            ),
            roles,
          },
          custom: {
            ...state.custom,
            channels: {
              news: { display_name: "News", description: "Product news" },
              alerts: { display_name: "Security alerts" },
            },
            private_feed_patterns: [
              {
                channel: "tracking",
                pattern:
                  "https://shop.acme.example/channels/tracking/*/feed.json",
                keys: keysOf([keys.engine]),
                keyids: [keys.engine.keyid],
                threshold: 1,
                display_name: "Package tracking",
                purpose: "per-order delivery notifications",
              },
            ],
          },
        },
        [state.rootKey],
      ),
    );
    meta["targets.json"] = metaOf(targetsBytes, targetsVersion);
    const snapshotVersion = bump("snapshot.json");
    const snapshotBytes = put(
      `${REPO_BASE}snapshot.json`,
      signMetadata(
        {
          _type: "snapshot",
          spec_version: "1.0.31",
          version: snapshotVersion,
          expires: state.expires,
          meta,
        },
        [keys.ops],
      ),
    );
    put(
      `${REPO_BASE}timestamp.json`,
      signMetadata(
        {
          _type: "timestamp",
          spec_version: "1.0.31",
          version: bump("timestamp.json"),
          expires: state.timestampExpires,
          meta: { "snapshot.json": metaOf(snapshotBytes, snapshotVersion) },
        },
        [keys.ops],
      ),
    );
  };

  const publishFeed = (
    fields: Record<string, unknown> = {},
    signers: ReadonlyArray<TestKey> = [keys.engine],
  ) => {
    state.feedVersion += 1;
    return put(
      FEED_URL,
      signDocument(
        {
          v: 1,
          channel: "tracking",
          url: FEED_URL,
          version: state.feedVersion,
          expires: FUTURE,
          expired: false,
          items: [
            {
              id: "shipped",
              title: "Your order has shipped",
              content_html: "<p>On its way</p>",
              date_published: "2029-07-01T00:00:00Z",
            },
          ],
          ...fields,
        },
        signers,
      ),
    );
  };

  return {
    keys: { ...keys, author },
    channels,
    state,
    files,
    requests,
    fetch,
    put,
    publishRoot,
    item,
    publish,
    publishFeed,
  };
};

export type TestPublisher = ReturnType<typeof makeTestPublisher>;

/** A publisher with one root, two news items, one alert and a private feed. */
export const makeStandardPublisher = () => {
  const publisher = makeTestPublisher();
  publisher.publishRoot();
  publisher.item("news", "launch");
  publisher.item("news", "update", { date_published: "2029-08-01T00:00:00Z" });
  publisher.item("alerts", "phishing");
  publisher.publish();
  publisher.publishFeed();
  return publisher;
};
