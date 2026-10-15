import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { once } from "node:events";
import {
  Amount,
  getEncodedToken,
  Mint,
  PaymentRequest,
  PaymentRequestTransportType,
  Wallet,
  type PaymentRequestPayload,
  type Proof,
} from "@cashu/cashu-ts";
import {
  generateSecretKey,
  getEventHash,
  getPublicKey,
  nip19,
  verifyEvent,
} from "nostr-tools";
import { unwrapEvent, wrapEvent } from "nostr-tools/nip59";
import { SimplePool } from "nostr-tools/pool";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const record = (value: unknown): Record<string, unknown> => {
  assert(isRecord(value));
  return value;
};

export const proofTotal = (proofs: Proof[]): number =>
  proofs.reduce((total, proof) => total + Number(proof.amount), 0);

export const mintWallet = async (mint: string): Promise<Wallet> => {
  const wallet = new Wallet(new Mint(mint), { unit: "sat" });
  await wallet.loadMint();
  return wallet;
};

export const mintProofs = async (
  mint: string,
  amount: number,
): Promise<Proof[]> => {
  const wallet = await mintWallet(mint);
  const quote = await wallet.createMintQuoteBolt11(amount);
  return wallet.mintProofsBolt11(amount, quote, undefined, { type: "random" });
};

export const mintToken = async (
  mint: string,
  amount: number,
): Promise<string> =>
  getEncodedToken({
    mint,
    unit: "sat",
    proofs: await mintProofs(mint, amount),
  });

const selfSignedLocalhostTls = (): { key: Buffer; cert: Buffer } => {
  const dir = mkdtempSync(join(tmpdir(), "linky-nut18-tls-"));
  try {
    const key = join(dir, "key.pem");
    const cert = join(dir, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-subj",
        "/CN=127.0.0.1",
        "-days",
        "1",
        "-keyout",
        key,
        "-out",
        cert,
      ],
      { stdio: "ignore" },
    );
    return { key: readFileSync(key), cert: readFileSync(cert) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

export class ExternalWallet {
  readonly secretKey = generateSecretKey();
  readonly pubkey = getPublicKey(this.secretKey);
  readonly lockKey = generateSecretKey();
  readonly lockPubkey = `02${getPublicKey(this.lockKey)}`;
  readonly inbox: Array<{
    content: string;
    author: string;
    kind: number;
    wrapId: string;
  }> = [];
  readonly errors: string[] = [];
  readonly posts: Array<{ method: string; contentType: string; body: string }> =
    [];
  readonly pool = new SimplePool();
  private subscription?: ReturnType<SimplePool["subscribeMany"]>;
  private readonly server = createServer();
  // The production build POSTs only to https; the spec's browser ignores the self-signed cert.
  private readonly postServer = createHttpsServer(
    selfSignedLocalhostTls(),
    async (request, response) => {
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      if (request.method === "OPTIONS") {
        response.writeHead(204).end();
        return;
      }
      let body = "";
      for await (const chunk of request) body += String(chunk);
      this.posts.push({
        method: request.method ?? "",
        contentType: request.headers["content-type"] ?? "",
        body,
      });
      response.writeHead(200).end();
    },
  );
  relayUrl = "";
  postUrl = "";

  async start(stackRelay: string): Promise<void> {
    // A transparent WebSocket tunnel gives the payee a relay URL absent from Linky's settings.
    const upstream = new URL(stackRelay);
    this.server.on("upgrade", (request, socket, head) => {
      const target = connect(Number(upstream.port), upstream.hostname, () => {
        target.write(`GET ${request.url} HTTP/1.1\r\n`);
        for (let i = 0; i < request.rawHeaders.length; i += 2)
          target.write(
            `${request.rawHeaders[i]}: ${request.rawHeaders[i + 1]}\r\n`,
          );
        target.write("\r\n");
        target.write(head);
        socket.pipe(target).pipe(socket);
      });
      target.on("error", () => socket.destroy());
      socket.on("error", () => target.destroy());
      socket.on("close", () => target.destroy());
    });
    this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");
    const address = this.server.address();
    assert(address && typeof address !== "string");
    this.relayUrl = `ws://127.0.0.1:${address.port}`;
    this.postServer.listen(0, "127.0.0.1");
    await once(this.postServer, "listening");
    const postAddress = this.postServer.address();
    assert(postAddress && typeof postAddress !== "string");
    this.postUrl = `https://127.0.0.1:${postAddress.port}/payment`;
    await new Promise<void>((resolve) => {
      this.subscription = this.pool.subscribeMany(
        [this.relayUrl],
        { kinds: [1059], "#p": [this.pubkey] },
        {
          oneose: resolve,
          onevent: (event) => {
            try {
              assert.equal(event.kind, 1059);
              assert(verifyEvent(event), "gift wrap signature");
              const rumor = unwrapEvent(event, this.secretKey);
              if (rumor.kind !== 14) return;
              assert.equal(rumor.id, getEventHash(rumor));
              assert(
                rumor.tags.some(
                  (tag) => tag[0] === "p" && tag[1] === this.pubkey,
                ),
              );
              this.inbox.push({
                content: rumor.content,
                author: rumor.pubkey,
                kind: rumor.kind,
                wrapId: event.id,
              });
            } catch (error) {
              this.errors.push(String(error));
            }
          },
        },
      );
    });
  }

  request(options: {
    amount?: number;
    mints: string[];
    post?: boolean;
    locked?: boolean;
  }): string {
    return new PaymentRequest(
      [
        {
          type: options.post
            ? PaymentRequestTransportType.POST
            : PaymentRequestTransportType.NOSTR,
          target: options.post
            ? this.postUrl
            : nip19.nprofileEncode({
                pubkey: this.pubkey,
                relays: [this.relayUrl],
              }),
          ...(options.post ? {} : { tags: [["n", "17"]] }),
        },
      ],
      crypto.randomUUID(),
      options.amount,
      "sat",
      options.mints,
      "External wallet interoperability",
      true,
      options.locked
        ? { kind: "P2PK", data: this.lockPubkey, tags: [] }
        : undefined,
    ).toEncodedCreqA();
  }

  decodeLinkyRequest(
    text: string,
    expected: {
      amount: number;
      pubkey: string;
      mints: string[];
      relay: string;
    },
  ): PaymentRequest {
    assert(text.startsWith("creqA"));
    const request = PaymentRequest.fromEncodedRequest(text);
    const raw = request.toRawRequest();
    assert.equal(typeof raw.i, "string");
    assert(raw.i && raw.i.length > 0);
    assert.equal(Number(raw.a), expected.amount);
    assert.equal(raw.u, "sat");
    assert.equal(raw.s, true);
    assert.deepEqual(raw.m, expected.mints);
    assert.equal(new Set(raw.m).size, raw.m.length);
    assert.equal(raw.t?.length, 1);
    const transport = request.getTransport(PaymentRequestTransportType.NOSTR);
    assert(transport);
    assert(transport.tags?.some((tag) => tag[0] === "n" && tag.includes("17")));
    const target = nip19.decode(transport.target);
    assert.equal(target.type, "nprofile");
    assert.equal(target.data.pubkey, expected.pubkey);
    assert(target.data.relays?.includes(expected.relay));
    return request;
  }

  async validateAndRedeem(
    text: string,
    encodedRequest: string,
    amount: number,
  ) {
    const request = PaymentRequest.fromEncodedRequest(encodedRequest);
    const raw: unknown = JSON.parse(text);
    const payload = record(raw);
    assert(
      Object.keys(payload).every((key) =>
        ["id", "memo", "mint", "unit", "proofs"].includes(key),
      ),
      "NUT-18 payment payload fields",
    );
    assert.equal(payload.id, request.id);
    assert(payload.memo === undefined || typeof payload.memo === "string");
    assert.equal(typeof payload.mint, "string");
    assert.equal(payload.unit, request.unit);
    const mint = String(payload.mint);
    assert(
      !request.mints?.length || request.mints.includes(mint),
      "strict NUT-18 mint list",
    );
    assert(Array.isArray(payload.proofs) && payload.proofs.length > 0);
    const proofs: Proof[] = payload.proofs.map((value: unknown) => {
      const proof = record(value);
      assert(
        typeof proof.amount === "number" &&
          Number.isSafeInteger(proof.amount) &&
          proof.amount > 0,
      );
      assert(typeof proof.id === "string" && /^[0-9a-f]+$/i.test(proof.id));
      assert(
        typeof proof.C === "string" && /^(02|03)[0-9a-f]{64}$/i.test(proof.C),
      );
      assert(typeof proof.secret === "string" && proof.secret.length > 0);
      if (request.nut10) {
        const secret: unknown = JSON.parse(proof.secret);
        assert(Array.isArray(secret) && secret.length === 2);
        assert.equal(secret[0], "P2PK");
        const condition = record(secret[1]);
        assert.equal(condition.data, request.nut10.data);
        assert(
          typeof condition.nonce === "string" && condition.nonce.length > 0,
        );
        assert(
          !condition.tags || JSON.stringify(condition.tags) === "[]",
          "no unrequested refund key or timelock",
        );
      }
      return {
        id: proof.id,
        C: proof.C,
        secret: proof.secret,
        amount: Amount.from(proof.amount),
      };
    });
    assert(proofTotal(proofs) >= amount, "proof face amount covers request");
    const wallet = await mintWallet(mint);
    const fee = Number(wallet.getFeesForProofs(proofs));
    if (request.nut10) {
      await assert.rejects(
        () => wallet.receive(proofs, undefined, { type: "random" }),
        "locked proofs cannot be redeemed without signing",
      );
    }
    const redeemed = await wallet.receive(
      proofs,
      request.nut10
        ? { privkey: Buffer.from(this.lockKey).toString("hex") }
        : undefined,
      { type: "random" },
    );
    assert.equal(proofTotal(redeemed), proofTotal(proofs) - fee);
    return {
      payload,
      face: proofTotal(proofs),
      fee,
      redeemed: proofTotal(redeemed),
      mint,
    };
  }

  async sendText(
    pubkey: string,
    relays: string[],
    content: string,
  ): Promise<void> {
    assert(relays.length > 0);
    const wrap = wrapEvent(
      {
        kind: 14,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", pubkey]],
        content,
      },
      this.secretKey,
      pubkey,
    );
    await Promise.all(this.pool.publish(relays, wrap));
  }

  async pay(request: PaymentRequest, id = request.id): Promise<number> {
    const mint = request.mints?.[0];
    assert(mint);
    const wallet = await mintWallet(mint);
    const amount = Number(request.amount);
    let proofs = await mintProofs(mint, amount + 1);
    // Minting may split into several proofs; compensate using the reference mint's actual keyset fees.
    while (
      proofTotal(proofs) - Number(wallet.getFeesForProofs(proofs)) <
      amount
    )
      proofs = await mintProofs(mint, proofTotal(proofs) + 1);
    const payload: PaymentRequestPayload = { id, mint, unit: "sat", proofs };
    const transport = request.getTransport(PaymentRequestTransportType.NOSTR);
    assert(transport);
    const target = nip19.decode(transport.target);
    assert.equal(target.type, "nprofile");
    await this.sendText(
      target.data.pubkey,
      target.data.relays ?? [],
      JSON.stringify({
        ...payload,
        proofs: proofs.map((proof) => ({
          ...proof,
          amount: Number(proof.amount),
        })),
      }),
    );
    return proofTotal(proofs) - Number(wallet.getFeesForProofs(proofs));
  }

  async close(): Promise<void> {
    this.subscription?.close();
    this.pool.destroy();
    this.postServer.closeAllConnections();
    this.postServer.close();
    this.server.closeAllConnections();
    this.server.close();
  }
}
