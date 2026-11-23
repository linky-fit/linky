import {
  ContactId,
  createId,
  directConversationIdFor,
  linkyScopes,
  sqliteTrue,
  type LinkyScope,
  type LinkyStore,
  type Mutation,
  type Owner,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import { nip19 } from "nostr-tools";
import { nowSeconds } from "../../utils/time";
import { seedCashuHistory } from "./seedCashuHistory";

export interface AccountHistoryCounts {
  /** Number of contacts to write, spread across `contactShards` shards. */
  readonly contacts: number;
  /** Number of `contacts` shards to populate (at least 1 when `contacts > 0`). */
  readonly contactShards: number;
  /** Past Cashu sends to write; each leaves 1 operation and 5 spent proofs (~15 sends/shard). */
  readonly cashuSends: number;
  /** Historical chat messages to write across conversations, rotating `messages` shards. */
  readonly messages: number;
  /** Historical transaction rows to write, rotating `transactions` shards. */
  readonly transactions: number;
}

export interface AccountHistory extends AccountHistoryCounts {
  readonly mint: string;
  readonly keysetId: string;
}

export interface SeededAccountSummary {
  /** Active shard index per rotating scope after seeding. */
  readonly shards: Readonly<Record<string, number>>;
  /** Total owners currently subscribed by the shard store (app owner + visible shards). */
  readonly syncOwners: number;
  readonly rows: {
    readonly contacts: number;
    readonly conversations: number;
    readonly messages: number;
    readonly transactions: number;
    readonly cashuOperations: number;
    readonly cashuProofs: number;
  };
}

/**
 * Default heavy multi-shard profile modelled on a mature Linky power-user
 * account (~80 subscribed Evolu shards, 38 cashu shards, ~9 000 rows).
 */
export const DEFAULT_HEAVY_ACCOUNT: AccountHistoryCounts = {
  contacts: 40,
  contactShards: 4,
  cashuSends: 570,
  messages: 3_000,
  transactions: 2_600,
};

const SPENT_PROOFS_PER_CASHU_SEND = 5;
const TRANSACTION_METHODS = [
  "cashu_chat",
  "lightning_invoice",
  "cashu",
] as const;

/** Scales a profile proportionally while keeping non-zero counts at least 1. */
export const scaleAccountHistory = (
  base: AccountHistoryCounts,
  scale: number,
): AccountHistoryCounts => {
  if (!Number.isFinite(scale) || scale < 0) {
    throw new Error(`scale must be a finite non-negative number, got ${scale}`);
  }
  const scaled = (count: number) =>
    count === 0 || scale === 0 ? 0 : Math.max(1, Math.round(count * scale));
  const contacts = scaled(base.contacts);
  return {
    contacts,
    contactShards:
      contacts === 0 ? 0 : Math.min(contacts, scaled(base.contactShards)),
    cashuSends: scaled(base.cashuSends),
    messages: scaled(base.messages),
    transactions: scaled(base.transactions),
  };
};

export const SEED_USAGE = `usage: bun run journey seed <device> [options]
  --scale <n>            scale the default heavy profile (default: 1)
  --cashu-sends <n>      past Cashu sends to seed (default: ${DEFAULT_HEAVY_ACCOUNT.cashuSends})
  --messages <n>         historical chat messages to seed (default: ${DEFAULT_HEAVY_ACCOUNT.messages})
  --transactions <n>     historical transactions to seed (default: ${DEFAULT_HEAVY_ACCOUNT.transactions})
  --contacts <n>         contacts to seed (default: ${DEFAULT_HEAVY_ACCOUNT.contacts})
  --contact-shards <n>   contact shards to spread contacts across (default: ${DEFAULT_HEAVY_ACCOUNT.contactShards})
  --help                 show this usage`;

export interface ParsedSeedArgs {
  readonly help: boolean;
  readonly counts: AccountHistoryCounts;
}

const parseNonNegativeInt = (
  flag: string,
  value: string | undefined,
): number => {
  if (value === undefined) throw new Error(`${flag} requires a value`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer, got "${value}"`);
  }
  return parsed;
};

const parseScale = (value: string | undefined): number => {
  if (value === undefined) throw new Error("--scale requires a value");
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `--scale must be a finite non-negative number, got "${value}"`,
    );
  }
  return parsed;
};

export const parseSeedArgs = (argv: ReadonlyArray<string>): ParsedSeedArgs => {
  let scale = 1;
  const overrides: {
    contacts?: number;
    contactShards?: number;
    cashuSends?: number;
    messages?: number;
    transactions?: number;
  } = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      return { help: true, counts: DEFAULT_HEAVY_ACCOUNT };
    }
    if (arg === "--scale") {
      scale = parseScale(argv[++i]);
      continue;
    }
    if (arg === "--cashu-sends") {
      overrides.cashuSends = parseNonNegativeInt(arg, argv[++i]);
      continue;
    }
    if (arg === "--messages") {
      overrides.messages = parseNonNegativeInt(arg, argv[++i]);
      continue;
    }
    if (arg === "--transactions") {
      overrides.transactions = parseNonNegativeInt(arg, argv[++i]);
      continue;
    }
    if (arg === "--contacts") {
      overrides.contacts = parseNonNegativeInt(arg, argv[++i]);
      continue;
    }
    if (arg === "--contact-shards") {
      overrides.contactShards = parseNonNegativeInt(arg, argv[++i]);
      continue;
    }
    throw new Error(`unknown option: ${arg}`);
  }

  const base = scaleAccountHistory(DEFAULT_HEAVY_ACCOUNT, scale);
  const contacts = overrides.contacts ?? base.contacts;
  const rawContactShards = overrides.contactShards ?? base.contactShards;
  const contactShards =
    contacts === 0 ? 0 : Math.max(1, Math.min(contacts, rawContactShards));

  return {
    help: false,
    counts: {
      contacts,
      contactShards,
      cashuSends: overrides.cashuSends ?? base.cashuSends,
      messages: overrides.messages ?? base.messages,
      transactions: overrides.transactions ?? base.transactions,
    },
  };
};

const hex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

const deterministicPubkeyHex = (index: number): string =>
  `${(index + 1).toString(16).padStart(16, "0")}${"a1b2c3d4e5f60718".repeat(3)}`;

const maxMutationsFor = (scope: LinkyScope): number => {
  const def = linkyScopes[scope];
  if (def.owner !== "shard" || def.rotation === null) {
    throw new Error(`scope ${scope} does not rotate`);
  }
  return def.rotation.maxMutations;
};

const writeInRotatedShards = async <T>(
  store: LinkyStore,
  mutate: (mutations: ReadonlyArray<Mutation>) => Effect.Effect<void, Error>,
  scope: LinkyScope,
  items: ReadonlyArray<T>,
  perShard: number,
  buildMutation: (item: T, owner: Owner) => Mutation,
): Promise<void> => {
  if (items.length === 0) return;
  const batchSize = Math.max(1, perShard);
  for (let offset = 0; offset < items.length; offset += batchSize) {
    if (offset > 0) await Effect.runPromise(store.rotate(scope));
    const index = await Effect.runPromise(store.activeIndex(scope));
    const owner = store.shardOwner(scope, index);
    const slice = items.slice(offset, offset + batchSize);
    await Effect.runPromise(
      mutate(slice.map((item) => buildMutation(item, owner))),
    );
  }
};

interface SeededContact {
  readonly id: ContactId;
  readonly conversationId: string;
  readonly pubkey: string;
  readonly npub: string;
  readonly name: string;
}

const buildContacts = (count: number): ReadonlyArray<SeededContact> =>
  Array.from({ length: count }, (_, index) => {
    const id = ContactId.orThrow(createId());
    const pubkey = deterministicPubkeyHex(index);
    return {
      id,
      conversationId: directConversationIdFor(id),
      pubkey,
      npub: nip19.npubEncode(pubkey),
      name: `Heavy contact ${index + 1}`,
    };
  });

/**
 * Populates a Linky account across multiple rotated shards of `contacts`,
 * `messages`, `transactions` and `cashu`, without waiting on rotation
 * cooldowns. Returns the resulting shard indexes, subscribed owner count and
 * seeded row counts.
 */
export const seedAccountHistory = async (
  store: LinkyStore,
  mutate: (mutations: ReadonlyArray<Mutation>) => Effect.Effect<void, Error>,
  history: AccountHistory,
): Promise<SeededAccountSummary> => {
  const baseSec = nowSeconds();
  const contacts = buildContacts(history.contacts);

  if (contacts.length > 0) {
    const targetShards = Math.max(
      1,
      Math.min(history.contactShards, contacts.length),
    );
    const perShard = Math.min(
      maxMutationsFor("contacts"),
      Math.ceil(contacts.length / targetShards),
    );
    await writeInRotatedShards(
      store,
      mutate,
      "contacts",
      contacts,
      perShard,
      (contact, owner) => ({
        kind: "upsert",
        table: "contact",
        owner,
        row: {
          id: contact.id,
          name: contact.name,
          nameSetByUser: sqliteTrue,
          npub: contact.npub,
        },
      }),
    );
  }

  let conversationsWritten = 0;
  if (history.messages > 0) {
    const targets = contacts.length > 0 ? contacts : buildContacts(1);
    const messageStartSec = baseSec - history.messages * 60;
    const latestByConversation = new Map<string, number>();
    const messageSpecs = Array.from({ length: history.messages }, (_, i) => {
      const contact = targets[i % targets.length]!;
      const createdAtSec = Math.max(1, messageStartSec + i * 60);
      latestByConversation.set(contact.conversationId, createdAtSec);
      return { index: i, contact, createdAtSec };
    });

    const messagesPerShard = Math.max(1, maxMutationsFor("messages") - 10);
    await writeInRotatedShards(
      store,
      mutate,
      "messages",
      messageSpecs,
      messagesPerShard,
      ({ index, contact, createdAtSec }, owner) => {
        const rumorId = hex(32);
        return {
          kind: "upsert",
          table: "message",
          owner,
          row: {
            id: createId(),
            conversationId: contact.conversationId,
            direction: index % 2 === 0 ? "in" : "out",
            content: `Historical message #${index + 1} for heavy Evolu shard testing`,
            wrapId: hex(32),
            rumorId,
            pubkey: contact.pubkey,
            createdAtSec,
            status: "sent",
          },
        };
      },
    );

    // Put conversation rows in the active (newest) messages shard so every chat
    // remains visible even after a restore or forget of older message shards.
    if (contacts.length > 0) {
      const activeMessagesIndex = await Effect.runPromise(
        store.activeIndex("messages"),
      );
      const activeMessagesOwner = store.shardOwner(
        "messages",
        activeMessagesIndex,
      );
      const conversations = contacts.filter((contact) =>
        latestByConversation.has(contact.conversationId),
      );
      if (conversations.length > 0) {
        await Effect.runPromise(
          mutate(
            conversations.map((contact) => ({
              kind: "upsert",
              table: "conversation",
              owner: activeMessagesOwner,
              row: {
                id: contact.conversationId,
                kind: "direct",
                contactId: contact.id,
                lastSeenAtSec:
                  latestByConversation.get(contact.conversationId) ?? baseSec,
              },
            })),
          ),
        );
        conversationsWritten = conversations.length;
      }
    }
  }

  if (history.transactions > 0) {
    const txStartSec = baseSec - history.transactions * 120;
    const txSpecs = Array.from({ length: history.transactions }, (_, i) => ({
      index: i,
      createdAtSec: Math.max(1, txStartSec + i * 120),
    }));
    const txPerShard = Math.max(1, maxMutationsFor("transactions") - 20);
    await writeInRotatedShards(
      store,
      mutate,
      "transactions",
      txSpecs,
      txPerShard,
      ({ index, createdAtSec }, owner) => {
        const method =
          TRANSACTION_METHODS[index % TRANSACTION_METHODS.length] ?? "cashu";
        const contact =
          method === "cashu_chat" && contacts.length > 0
            ? contacts[index % contacts.length]
            : undefined;
        return {
          kind: "upsert",
          table: "transaction",
          owner,
          row: {
            id: createId(),
            createdAtSec,
            direction: index % 2 === 0 ? "out" : "in",
            status: "ok",
            amount: 21 + (index % 500),
            method,
            note: `Historical payment #${index + 1}`,
            ...(contact === undefined ? {} : { contactId: contact.id }),
            mint: history.mint,
            unit: "sat",
          },
        };
      },
    );
  }

  if (history.cashuSends > 0) {
    await seedCashuHistory(store, mutate, {
      mint: history.mint,
      keysetId: history.keysetId,
      sends: history.cashuSends,
    });
  }

  const [contactsIndex, messagesIndex, transactionsIndex, cashuIndex, owners] =
    await Promise.all([
      Effect.runPromise(store.activeIndex("contacts")),
      Effect.runPromise(store.activeIndex("messages")),
      Effect.runPromise(store.activeIndex("transactions")),
      Effect.runPromise(store.activeIndex("cashu")),
      Effect.runPromise(store.syncOwners()),
    ]);

  return {
    shards: {
      contacts: contactsIndex + 1,
      messages: messagesIndex + 1,
      transactions: transactionsIndex + 1,
      cashu: cashuIndex + 1,
    },
    syncOwners: owners.length,
    rows: {
      contacts: contacts.length,
      conversations: conversationsWritten,
      messages: history.messages,
      transactions: history.transactions,
      cashuOperations: history.cashuSends,
      cashuProofs: history.cashuSends * SPENT_PROOFS_PER_CASHU_SEND,
    },
  };
};
