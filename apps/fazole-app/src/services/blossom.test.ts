import { makeIdentity } from "@linky-fit/linkstr/testing";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { uploadToBlossom } from "./blossom";

const image = { bytes: new Uint8Array([1, 2, 3]), type: "image/webp" };
const hash = bytesToHex(sha256(image.bytes));

const answering =
  (body: unknown, requests: Request[] = []): typeof fetch =>
  (input, init) => {
    requests.push(new Request(input, init));
    return Promise.resolve(Response.json(body));
  };

describe("a Blossom upload", () => {
  it("puts the blob signed for its hash and resolves with its URL", async () => {
    const requests: Request[] = [];
    const url = `https://blossom.primal.net/${hash}.webp`;
    expect(
      await uploadToBlossom(
        image,
        makeIdentity().secretKey,
        answering({ sha256: hash, url }, requests),
      ),
    ).toBe(url);
    const [request] = requests;
    expect(request?.method).toBe("PUT");
    expect(request?.headers.get("X-SHA-256")).toBe(hash);
    expect(request?.headers.get("Authorization")).toMatch(/^Nostr /u);
  });

  it("rejects a server that stored another blob or answers without https", async () => {
    const { secretKey } = makeIdentity();
    await expect(
      uploadToBlossom(
        image,
        secretKey,
        answering({ sha256: "00", url: "https://blossom.primal.net/00" }),
      ),
    ).rejects.toThrow();
    await expect(
      uploadToBlossom(
        image,
        secretKey,
        answering({ sha256: hash, url: `http://blossom.primal.net/${hash}` }),
      ),
    ).rejects.toThrow();
  });
});
