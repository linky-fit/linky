// Seeds a journey device's Evolu database with a heavy multi-shard history, for `bun run journey seed <device>`.
// playwright-cli calls this file as one expression, so it ends without a semicolon.
async (page, { history, fallbackContacts, pointerIds, maxMutations, hookedOrigin }) => {
  const startedAt = Date.now();
  const hasHooks = await page.evaluate(() => Boolean(window.__linkyE2E));
  if (!hasHooks) {
    const hint = hookedOrigin
      ? `Open the device on Linky with test hooks (${hookedOrigin}) or Linky release, seed it, then optionally restore its recovery seed on Linky.`
      : "Open the device on Linky with test hooks or Linky release, seed it, then optionally restore its recovery seed on Linky.";
    throw new Error(`window.__linkyE2E is missing on this origin. ${hint}`);
  }

  const summary = await page.evaluate(
    async ({ history, fallbackContacts, pointerIds, maxMutations }) => {
      const hooks = window.__linkyE2E;
      if (!hooks) throw new Error("test hooks missing");
      if (typeof hooks.seedAccountHistory === "function") {
        return hooks.seedAccountHistory(history);
      }

      const hex = (bytes) =>
        Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
      const appOwnerId = await hooks.appOwnerId();
      const pointerRows = await hooks.shardRows("meta", "shardPointer");
      const currentIndex = (scope) => {
        const match = pointerRows.find((row) => row.scope === scope);
        return typeof match?.index === "number" ? match.index : 0;
      };
      const writePointer = (scope, index) =>
        hooks.upsert(
          "shardPointer",
          { id: pointerIds[scope], scope, index, rotatedAtMs: Date.now() },
          appOwnerId,
        );
      const baseSec = Math.floor(Date.now() / 1000);

      const contacts = [];
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
          const batch = [];
          for (let i = 0; i < count; i += 1) {
            const idx = offset + i;
            const id = hooks.createId();
            const peer = fallbackContacts[idx % fallbackContacts.length];
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
                  conversationId: hooks.directConversationIdFor(hooks.createId()),
                  pubkey: fallbackContacts[0].pubkey,
                  npub: fallbackContacts[0].npub,
                  name: "Heavy contact 1",
                },
              ];
        const startSec = baseSec - history.messages * 60;
        const perShard = Math.max(1, maxMutations.messages - 10);
        const latestByConversation = new Map();
        for (let offset = 0; offset < history.messages; offset += perShard) {
          if (offset > 0) messagesIndex += 1;
          const ownerId = await hooks.shardOwnerId("messages", messagesIndex);
          const count = Math.min(perShard, history.messages - offset);
          const batch = [];
          for (let i = 0; i < count; i += 1) {
            const idx = offset + i;
            const contact = targets[idx % targets.length];
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
        const methods = ["cashu_chat", "lightning_invoice", "cashu"];
        const startSec = baseSec - history.transactions * 120;
        const perShard = Math.max(1, maxMutations.transactions - 20);
        for (let offset = 0; offset < history.transactions; offset += perShard) {
          if (offset > 0) transactionsIndex += 1;
          const ownerId = await hooks.shardOwnerId(
            "transactions",
            transactionsIndex,
          );
          const count = Math.min(perShard, history.transactions - offset);
          const batch = [];
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

  // Cold-boot the app over the seeded shards so subscriptions match a real restart.
  await page.reload({ waitUntil: "domcontentloaded" });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => Boolean(window.__linkyE2E));
    if (ready && (await page.getByLabel("Available balance").isVisible().catch(() => false))) {
      break;
    }
    await page.waitForTimeout(250);
  }
  const syncOwnersAfterReload = await page.evaluate(async () =>
    window.__linkyE2E ? (await window.__linkyE2E.syncOwnerIds()).length : null,
  );
  return {
    ...summary,
    syncOwners: syncOwnersAfterReload ?? summary.syncOwners,
    seededMs: Date.now() - startedAt,
  };
}
