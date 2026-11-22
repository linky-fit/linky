// A Cashu wallet outside the apps for `bun run journey wallet`: the linkshu CLI, plus NUT-18 requests over Nostr.
import { getDecodedToken } from "@cashu/cashu-ts";
import {
  decodePaymentRequest,
  decodePaymentRequestPayload,
  encodeNostrPaymentRequest,
  encodePaymentRequestPayload,
  PaymentRequestId,
} from "@linky-fit/linkshu";
import { Schema } from "effect";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { unwrapEvent, wrapEvent } from "nostr-tools/nip17";
import { Relay } from "nostr-tools/relay";

const USAGE = `usage: bun run journey wallet <name> <command>
  balance | topup <sat> | send <sat> | receive <token> | melt <bolt11>   the linkshu CLI; --mint <url> picks another mint
  pay-request <creqA…> [sat]    pay a NUT-18 request over its nostr transport; [sat] replaces its amount
  request <sat> [description]   print a NUT-18 request, wait for its payment and receive it
  whoami                        this wallet's npub and nprofile`;

const decodeKeysets = Schema.decodeUnknownSync(
  Schema.Struct({
    keysets: Schema.Array(Schema.Struct({ id: Schema.String })),
  }),
);

const env = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set; run this through bun run journey`);
  return value;
};

const [name, command, ...args] = process.argv.slice(2);
if (!name || !command) {
  console.error(USAGE);
  process.exit(1);
}
const relayUrl = env("LINKY_JOURNEY_NOSTR_RELAY_URL");
const mainMint = env("LINKSHU_MINT_URL");
const repoRoot = env("LINKY_JOURNEY_ROOT");
const dir = join(env("LINKY_JOURNEY_HOME"), "wallets", name);
mkdirSync(dir, { recursive: true });

const keyFile = join(dir, "nostr.key.hex");
if (!existsSync(keyFile))
  writeFileSync(keyFile, Buffer.from(generateSecretKey()).toString("hex"), {
    mode: 0o600,
  });
const secretKey = Uint8Array.from(
  Buffer.from(readFileSync(keyFile, "utf8").trim(), "hex"),
);
const pubkey = getPublicKey(secretKey);
const nprofile = nip19.nprofileEncode({ pubkey, relays: [relayUrl] });

const linkshu = (mint: string, ...cliArgs: string[]): string => {
  const result = spawnSync(
    "bun",
    [
      "apps/linkshu-cli/src/index.ts",
      "--data-dir",
      join(dir, "cashu"),
      "--mint",
      mint,
      ...cliArgs,
    ],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  if (result.status !== 0)
    throw new Error(`linkshu ${cliArgs.join(" ")} failed`);
  return result.stdout.trim();
};

const payRequest = async (encoded: string, amountArg: string | undefined) => {
  const request = decodePaymentRequest(encoded);
  if (!request) throw new Error("not a creqA request");
  const transport = request.transports.find(({ type }) => type === "nostr");
  if (!transport) throw new Error("the request has no nostr transport");
  const recipient = nip19.decode(transport.target);
  if (recipient.type !== "nprofile") throw new Error("not an nprofile target");
  const amount = Number(amountArg ?? request.amount);
  if (!amount) throw new Error("the request names no amount; pass one");
  const mint = request.mints[0] ?? mainMint;

  const token = linkshu(mint, "send", String(amount)).split("\n").at(-1) ?? "";
  const { keysets } = decodeKeysets(
    await (await fetch(`${mint}/v1/keysets`)).json(),
  );
  const decoded = getDecodedToken(
    token,
    keysets.map(({ id }) => id),
  );
  const payload = encodePaymentRequestPayload({
    id: request.id,
    mint: decoded.mint,
    unit: decoded.unit ?? "sat",
    proofs: decoded.proofs.map(({ id, amount, secret, C }) => ({
      id,
      amount: Number(amount),
      secret,
      C,
    })),
  });

  // The stack's relay stands in for whatever relays the payee listed.
  const relay = await Relay.connect(relayUrl);
  await relay.publish(
    wrapEvent(secretKey, { publicKey: recipient.data.pubkey }, payload),
  );
  relay.close();
  console.log(`sent ${amount} sat for request ${request.id ?? "(no id)"}`);
};

const requestPayment = async (amount: number, description: string | null) => {
  const requestId = PaymentRequestId.make(crypto.randomUUID().slice(0, 8));
  console.log(
    encodeNostrPaymentRequest({
      amount,
      mintUrls: [mainMint],
      recipientNprofile: nprofile,
      requestId,
      description,
    }),
  );
  console.error(`waiting for the payment of request ${requestId}…`);
  const relay = await Relay.connect(relayUrl);
  // NIP-59 backdates a wrap by up to two days.
  const since = Math.floor(Date.now() / 1000) - 3 * 24 * 3600;
  relay.subscribe([{ kinds: [1059], "#p": [pubkey], since }], {
    onevent: (wrap) => {
      const { content } = unwrapEvent(wrap, secretKey);
      const payment = decodePaymentRequestPayload(content);
      if (payment?.requestId !== requestId) return;
      console.log(linkshu(payment.mint, "receive", content));
      relay.close();
      process.exit(0);
    },
  });
};

const mintFlag = args.indexOf("--mint");
const mint = mintFlag < 0 ? mainMint : (args[mintFlag + 1] ?? mainMint);
const operands =
  mintFlag < 0 ? args : args.filter((_, i) => i < mintFlag || i > mintFlag + 1);

switch (command) {
  case "whoami":
    console.log(JSON.stringify({ npub: nip19.npubEncode(pubkey), nprofile }));
    break;
  case "balance":
  case "topup":
  case "send":
  case "receive":
  case "melt":
    console.log(linkshu(mint, command, ...operands));
    break;
  case "pay-request":
    await payRequest(operands[0] ?? "", operands[1]);
    break;
  case "request":
    await requestPayment(Number(operands[0]), operands[1] ?? null);
    break;
  default:
    console.error(USAGE);
    process.exit(1);
}
