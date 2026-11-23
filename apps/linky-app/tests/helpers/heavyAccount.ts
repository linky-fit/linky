import { linkyScopes, shardPointerId } from "@linky-fit/linksync";
import type { Page } from "@playwright/test";
import { Schema } from "effect";
import { nip19 } from "nostr-tools";
import {
  DEFAULT_HEAVY_ACCOUNT,
  scaleAccountHistory,
  type AccountHistory,
  type AccountHistoryCounts,
  type SeededAccountSummary,
} from "../../src/devtools/e2e/seedAccountHistory";

const KeysetsResponse = Schema.Struct({
  keysets: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      unit: Schema.optional(Schema.String),
      active: Schema.optional(Schema.Boolean),
    }),
  ),
});

export interface SlowWriteEvent {
  readonly at: number;
  readonly tables: ReadonlyArray<string>;
  readonly rows: number;
  readonly durationMs: number;
}

const SlowWritePayload = Schema.Struct({
  tables: Schema.Array(Schema.String),
  rows: Schema.Number,
  durationMs: Schema.Number,
});

const RawInspectorRow = Schema.Struct({
  at: Schema.Number,
  channel: Schema.String,
  tag: Schema.String,
  payload: Schema.Unknown,
});

const decodeSlowWrites = (
  raw: unknown,
  sinceMs: number,
): ReadonlyArray<SlowWriteEvent> => {
  if (!Array.isArray(raw)) return [];
  const out: SlowWriteEvent[] = [];
  for (const entry of raw) {
    const row = Schema.decodeUnknownOption(RawInspectorRow)(entry);
    if (row._tag !== "Some") continue;
    if (
      row.value.channel !== "evolu.sync" ||
      row.value.tag !== "WriteSlow" ||
      row.value.at < sinceMs
    ) {
      continue;
    }
    const payload = Schema.decodeUnknownOption(SlowWritePayload)(
      row.value.payload,
    );
    if (payload._tag !== "Some") continue;
    out.push({
      at: row.value.at,
      tables: payload.value.tables,
      rows: payload.value.rows,
      durationMs: payload.value.durationMs,
    });
  }
  return out;
};

/** Active `sat` keyset id from a mint's NUT-02 `/v1/keysets` endpoint. */
export const fetchActiveSatKeysetId = async (
  mintUrl: string,
): Promise<string> => {
  const response = await fetch(`${mintUrl}/v1/keysets`);
  if (!response.ok) {
    throw new Error(`mint keysets request failed with ${response.status}`);
  }
  const { keysets } = Schema.decodeUnknownSync(KeysetsResponse)(
    await response.json(),
  );
  const preferred =
    keysets.find((ks) => ks.active !== false && ks.unit === "sat") ??
    keysets.find((ks) => ks.active !== false) ??
    keysets[0];
  if (!preferred) throw new Error(`mint ${mintUrl} returned no keysets`);
  return preferred.id;
};

/** Deterministic valid contact pubkey/npub pairs for fallback seeding on older releases. */
export const buildDeterministicContacts = (
  count: number,
): ReadonlyArray<{ readonly pubkey: string; readonly npub: string }> =>
  Array.from({ length: count }, (_, index) => {
    const pubkey = `${(index + 1).toString(16).padStart(16, "0")}${"a1b2c3d4e5f60718".repeat(3)}`;
    return { pubkey, npub: nip19.npubEncode(pubkey) };
  });

/**
 * Turns on in-memory and IndexedDB inspector capture for the page's lifetime so
 * `evolu.sync WriteSlow` rows are readable on both HEAD and older release builds.
 */
export const enableInspectorCapture = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("linky.inspector_enabled", "true");
      localStorage.setItem("linky.inspector_logs_enabled", "true");
    } catch {
      // ignore
    }
  });
};

/**
 * Reads `evolu.sync WriteSlow` inspector events recorded at or after `sinceMs`.
 * Uses the synchronous in-memory hook on HEAD and falls back to IndexedDB
 * (`linky.inspector_logs`) on older release builds.
 */
export const readSlowWritesSince = async (
  page: Page,
  sinceMs: number,
): Promise<ReadonlyArray<SlowWriteEvent>> => {
  const rawRows = await page.evaluate(async (fromMs: number) => {
    if (window.__linkyE2E?.inspectorRows) {
      return window.__linkyE2E
        .inspectorRows({ channel: "evolu.sync", tag: "WriteSlow" })
        .filter((row) => row.at >= fromMs);
    }
    // persistentInspectorLogSink batches writes on a 250 ms timer.
    await new Promise((resolve) => setTimeout(resolve, 350));
    return new Promise<unknown>((resolve) => {
      const open = indexedDB.open("linky.inspector_logs", 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains("rows")) {
          open.result.createObjectStore("rows", { keyPath: "id" });
        }
      };
      open.onerror = () => resolve([]);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("rows")) {
          db.close();
          resolve([]);
          return;
        }
        const tx = db.transaction("rows", "readonly");
        const req = tx.objectStore("rows").getAll();
        req.onsuccess = () => {
          db.close();
          resolve(Array.isArray(req.result) ? req.result : []);
        };
        req.onerror = () => {
          db.close();
          resolve([]);
        };
      };
    });
  }, sinceMs);

  return decodeSlowWrites(rawRows, sinceMs);
};

export interface SeedHeavyAccountOptions {
  readonly mintUrl: string;
  readonly keysetId?: string;
  readonly counts?: AccountHistoryCounts;
  readonly scale?: number;
}

/**
 * Populates a browser page's Evolu database with a heavy multi-shard history.
 * Uses `window.__linkyE2E.seedAccountHistory` on HEAD and falls back to
 * `seedCashuHistory` + batched `upsert` + `shardPointer` on older release builds.
 */
export const seedHeavyAccount = async (
  page: Page,
  {
    mintUrl,
    keysetId,
    counts = DEFAULT_HEAVY_ACCOUNT,
    scale = 1,
  }: SeedHeavyAccountOptions,
): Promise<SeededAccountSummary> => {
  const resolvedKeysetId = keysetId ?? (await fetchActiveSatKeysetId(mintUrl));
  const scaled = scaleAccountHistory(counts, scale);
  const history: AccountHistory = {
    mint: mintUrl,
    keysetId: resolvedKeysetId,
    ...scaled,
  };
  const fallbackContacts = buildDeterministicContacts(
    Math.max(1, scaled.contacts),
  );
  const pointerIds = {
    contacts: shardPointerId("contacts"),
    messages: shardPointerId("messages"),
    transactions: shardPointerId("transactions"),
  };
  const maxMutations = {
    contacts: linkyScopes.contacts.rotation.maxMutations,
    messages: linkyScopes.messages.rotation.maxMutations,
    transactions: linkyScopes.transactions.rotation.maxMutations,
  };

  return page.evaluate(
    async ({ history, fallbackContacts, pointerIds, maxMutations }) => {
      const hooks = window.__linkyE2E;
      if (!hooks) throw new Error("test hooks missing");
      if (typeof hooks.seedAccountHistory === "function") {
        return hooks.seedAccountHistory(history);
      }

      // Fallback for older release builds (e.g. `bun run journey bench release`)
      // that expose `seedCashuHistory` and `upsert`, before `seedAccountHistory`.
      const hex = (bytes: number): string =>
        Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
      const appOwnerId = await hooks.appOwnerId();
      const pointerRows = await hooks.shardRows("meta", "shardPointer");
      const currentIndex = (scope: string): number => {
        const match = pointerRows.find((row) => row.scope === scope);
        return typeof match?.index === "number" ? match.index : 0;
      };
      const writePointer = async (
        scope: keyof typeof pointerIds,
        index: number,
      ) =>
        hooks.upsert(
          "shardPointer",
          { id: pointerIds[scope], scope, index, rotatedAtMs: Date.now() },
          appOwnerId,
        );
      const baseSec = Math.floor(Date.now() / 1000);

      const contacts: Array<{
        id: string;
        conversationId: string;
        pubkey: string;
        npub: string;
        name: string;
      }> = [];
      let contactsIndex = currentIndex("contacts");
      if (history.contacts > 0) {
        const targetShards = Math.max(
          1,
          Math.min(history.contactShards, history.contacts),
        );
        const perShard = Math.min(
          maxMutations.contacts,
          Math.ceil(history.contacts / targetShards),
        );
        for (let offset = 0; offset < history.contacts; offset += perShard) {
          if (offset > 0) contactsIndex += 1;
          const ownerId = await hooks.shardOwnerId("contacts", contactsIndex);
          const count = Math.min(perShard, history.contacts - offset);
          const batch: Array<Record<string, unknown>> = [];
          for (let i = 0; i < count; i += 1) {
            const idx = offset + i;
            const id = hooks.createId();
            const peer = fallbackContacts[idx % fallbackContacts.length]!;
            const contact = {
              id,
              conversationId: hooks.directConversationIdFor(id),
              pubkey: peer.pubkey,
              npub: peer.npub,
              name: `Heavy contact ${idx + 1}`,
            };
            contacts.push(contact);
            batch.push({
              id: contact.id,
              name: contact.name,
              nameSetByUser: 1,
              npub: contact.npub,
            });
          }
          await Promise.all(
            batch.map((row) => hooks.upsert("contact", row, ownerId)),
          );
        }
        await writePointer("contacts", contactsIndex);
      }

      let messagesIndex = currentIndex("messages");
      let conversationsWritten = 0;
      if (history.messages > 0) {
        const targets =
          contacts.length > 0
            ? contacts
            : [
                {
                  id: hooks.createId(),
                  conversationId: hooks.directConversationIdFor(
                    hooks.createId(),
                  ),
                  pubkey: fallbackContacts[0]!.pubkey,
                  npub: fallbackContacts[0]!.npub,
                  name: "Heavy contact 1",
                },
              ];
        const startSec = baseSec - history.messages * 60;
        const perShard = Math.max(1, maxMutations.messages - 10);
        const latestByConversation = new Map<string, number>();
        for (let offset = 0; offset < history.messages; offset += perShard) {
          if (offset > 0) messagesIndex += 1;
          const ownerId = await hooks.shardOwnerId("messages", messagesIndex);
          const count = Math.min(perShard, history.messages - offset);
          const batch: Array<Record<string, unknown>> = [];
          for (let i = 0; i < count; i += 1) {
            const idx = offset + i;
            const contact = targets[idx % targets.length]!;
            const createdAtSec = Math.max(1, startSec + idx * 60);
            latestByConversation.set(contact.conversationId, createdAtSec);
            batch.push({
              id: hooks.createId(),
              conversationId: contact.conversationId,
              direction: idx % 2 === 0 ? "in" : "out",
              content: `Historical message #${idx + 1} for heavy Evolu shard testing`,
              wrapId: hex(32),
              rumorId: hex(32),
              pubkey: contact.pubkey,
              createdAtSec,
              status: "sent",
            });
          }
          await Promise.all(
            batch.map((row) => hooks.upsert("message", row, ownerId)),
          );
        }
        if (contacts.length > 0) {
          const activeOwnerId = await hooks.shardOwnerId(
            "messages",
            messagesIndex,
          );
          const activeConversations = contacts.filter((contact) =>
            latestByConversation.has(contact.conversationId),
          );
          await Promise.all(
            activeConversations.map((contact) =>
              hooks.upsert(
                "conversation",
                {
                  id: contact.conversationId,
                  kind: "direct",
                  contactId: contact.id,
                  lastSeenAtSec:
                    latestByConversation.get(contact.conversationId) ?? baseSec,
                },
                activeOwnerId,
              ),
            ),
          );
          conversationsWritten = activeConversations.length;
        }
        await writePointer("messages", messagesIndex);
      }

      let transactionsIndex = currentIndex("transactions");
      if (history.transactions > 0) {
        const methods = ["cashu_chat", "lightning_invoice", "cashu"] as const;
        const startSec = baseSec - history.transactions * 120;
        const perShard = Math.max(1, maxMutations.transactions - 20);
        for (
          let offset = 0;
          offset < history.transactions;
          offset += perShard
        ) {
          if (offset > 0) transactionsIndex += 1;
          const ownerId = await hooks.shardOwnerId(
            "transactions",
            transactionsIndex,
          );
          const count = Math.min(perShard, history.transactions - offset);
          const batch: Array<Record<string, unknown>> = [];
          for (let i = 0; i < count; i += 1) {
            const idx = offset + i;
            const method = methods[idx % methods.length] ?? "cashu";
            const contact =
              method === "cashu_chat" && contacts.length > 0
                ? contacts[idx % contacts.length]
                : undefined;
            batch.push({
              id: hooks.createId(),
              createdAtSec: Math.max(1, startSec + idx * 120),
              direction: idx % 2 === 0 ? "out" : "in",
              status: "ok",
              amount: 21 + (idx % 500),
              method,
              note: `Historical payment #${idx + 1}`,
              ...(contact === undefined ? {} : { contactId: contact.id }),
              mint: history.mint,
              unit: "sat",
            });
          }
          await Promise.all(
            batch.map((row) => hooks.upsert("transaction", row, ownerId)),
          );
        }
        await writePointer("transactions", transactionsIndex);
      }

      let cashuIndex = currentIndex("cashu");
      if (history.cashuSends > 0) {
        cashuIndex = await hooks.seedCashuHistory({
          mint: history.mint,
          keysetId: history.keysetId,
          sends: history.cashuSends,
        });
      }

      const owners = await hooks.syncOwnerIds();
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
          cashuProofs: history.cashuSends * 5,
        },
      };
    },
    { history, fallbackContacts, pointerIds, maxMutations },
  );
};
