import { describe, expect, it } from "vitest";
import {
  createSlip39Share,
  IdentityProvider,
  MasterSecretProvider,
} from "@linky/identity";
import { Effect, Layer } from "effect";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import {
  createRumor,
  createSeal,
  createWrap,
  wrapEvent,
} from "nostr-tools/nip59";
import { loginWithSecret } from "./auth";
import { decryptReport, normalizeRelays } from "./inbox";

const content = JSON.stringify({
  v: 1,
  id: "synthetic-report",
  createdAtSec: 1700000000,
  direction: "out",
  status: "error",
  method: "lightning_invoice",
  phase: "melt",
  errorCode: "mint_failed",
  errorDetail: "Synthetic mint failure",
  appVersion: "26.9.1",
  devicePlatform: "android",
  appRuntime: "native",
  appHost: "linky.fit",
});

describe("encrypted error inbox", () => {
  it("decrypts a real NIP-59 telemetry wrap only for its recipient", async () => {
    const session = await loginWithSecret(
      await Effect.runPromise(createSlip39Share()),
    );
    const wrongSession = await loginWithSecret(
      await Effect.runPromise(createSlip39Share()),
    );
    const wrap = wrapEvent(
      {
        kind: 24134,
        tags: [
          ["p", session.pubkey],
          ["linky", "payment_telemetry"],
        ],
        content,
      },
      generateSecretKey(),
      session.pubkey,
    );
    const report = await decryptReport(wrap, session, "ws://localhost:7777");
    expect(report?.id).toBe("synthetic-report");
    expect(report?.appVersion).toBe("26.9.1");
    expect(report?.wrapId).toBe(wrap.id);
    expect(
      await decryptReport(wrap, wrongSession, "ws://localhost:7777"),
    ).toBeNull();
    session.dispose();
    expect(
      await decryptReport(wrap, session, "ws://localhost:7777"),
    ).toBeNull();
    wrongSession.dispose();
  });

  it("rejects tampered seal signatures, rumor hashes, authors, and recipients", async () => {
    const session = await loginWithSecret(
      await Effect.runPromise(createSlip39Share()),
    );
    const sender = generateSecretKey();
    const rumor = createRumor(
      {
        kind: 24134,
        tags: [["p", session.pubkey]],
        content,
      },
      sender,
    );
    const seal = createSeal(rumor, sender, session.pubkey);
    const invalidSeal = createWrap(
      { ...seal, sig: "0".repeat(128) },
      session.pubkey,
    );
    expect(
      await decryptReport(invalidSeal, session, "ws://localhost"),
    ).toBeNull();
    const invalidHash = createWrap(
      createSeal({ ...rumor, id: "0".repeat(64) }, sender, session.pubkey),
      session.pubkey,
    );
    expect(
      await decryptReport(invalidHash, session, "ws://localhost"),
    ).toBeNull();
    const otherAuthor = createRumor(
      { kind: 24134, tags: rumor.tags, content },
      generateSecretKey(),
    );
    const invalidAuthor = createWrap(
      createSeal(otherAuthor, sender, session.pubkey),
      session.pubkey,
    );
    expect(
      await decryptReport(invalidAuthor, session, "ws://localhost"),
    ).toBeNull();
    const wrongRecipient = wrapEvent(
      {
        kind: 24134,
        tags: [["p", getPublicKey(generateSecretKey())]],
        content,
      },
      sender,
      session.pubkey,
    );
    expect(
      await decryptReport(wrongRecipient, session, "ws://localhost"),
    ).toBeNull();
    const wrongKind = wrapEvent(
      { kind: 14, tags: rumor.tags, content },
      sender,
      session.pubkey,
    );
    expect(
      await decryptReport(wrongKind, session, "ws://localhost"),
    ).toBeNull();
    const success = wrapEvent(
      {
        kind: 24134,
        tags: rumor.tags,
        content: content.replace('"error"', '"ok"'),
      },
      sender,
      session.pubkey,
    );
    expect(await decryptReport(success, session, "ws://localhost")).toBeNull();
    const tamperedWrap = finalizeEvent(
      { kind: 1059, tags: [], content: seal.content, created_at: 1700000000 },
      sender,
    );
    expect(
      await decryptReport(tamperedWrap, session, "ws://localhost"),
    ).toBeNull();
    session.dispose();
  });

  it("accepts secure relays and local fixtures without credentials or fragments", () => {
    expect(
      normalizeRelays([
        "wss://nos.lol/",
        "wss://nos.lol",
        "ws://localhost:7777/",
        "ws://relay.example",
        "https://nos.lol",
        "wss://secret@nos.lol",
        "wss://nos.lol/#secret",
      ]),
    ).toEqual(["wss://nos.lol", "ws://localhost:7777"]);
  });

  it("returns a fixed login failure without reflecting the entered secret", async () => {
    await expect(loginWithSecret("synthetic-sensitive-input")).rejects.toThrow(
      "Enter a valid Linky 20-word recovery phrase.",
    );
  });

  it("uses the same Nostr account as Linky for a SLIP-39 recovery phrase", async () => {
    const share = await Effect.runPromise(createSlip39Share());
    const identity = await Effect.runPromise(
      Effect.provide(
        IdentityProvider,
        Layer.provide(
          IdentityProvider.Live,
          MasterSecretProvider.fromSlip39Share(share),
        ),
      ),
    );
    const session = await loginWithSecret(share);
    expect(session.pubkey).toBe(identity.nostrPublicKey);
    session.dispose();
    identity.nostrSigningKey.fill(0);
  });
});
