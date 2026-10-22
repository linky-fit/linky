import { makeIdentity } from "@linky-fit/linkstr/testing";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { uploadToBlossom } from "./blossom";

const image = { bytes: new Uint8Array([1, 2, 3]), type: "image/webp" };
const hash = bytesToHex(sha256(image.bytes));

const answering =
  (response: Response, requests: Request[] = []): typeof fetch =>
  (input, init) => {
    requests.push(new Request(input, init));
    return Promise.resolve(response);
  };

describe("a Blossom upload", () => {
  it("puts the blob signed for its hash and resolves with its URL", async () => {
    const requests: Request[] = [];
    const url = `https://blossom.primal.net/${hash}.webp`;
    expect(
      await uploadToBlossom(
        image,
        makeIdentity().secretKey,
        answering(Response.json({ sha256: hash, url }), requests),
      ),
    ).toBe(url);
    const [request] = requests;
    if (request === undefined) throw new Error("nothing uploaded");
    expect(request.url).toBe("https://blossom.primal.net/upload");
    expect(request.method).toBe("PUT");
    expect(request.headers.get("X-SHA-256")).toBe(hash);
    expect(request.headers.get("Content-Type")).toBe("image/webp");
    expect(request.headers.get("Authorization")).toMatch(/^Nostr /u);
    expect(new Uint8Array(await request.arrayBuffer())).toEqual(image.bytes);
  });

  it("rejects a server that stored another blob, answers without https or fails", async () => {
    const { secretKey } = makeIdentity();
    await expect(
      uploadToBlossom(
        image,
        secretKey,
        answering(
          Response.json({ sha256: "00", url: "https://blossom.primal.net/00" }),
        ),
      ),
    ).rejects.toThrow("another blob");
    await expect(
      uploadToBlossom(
        image,
        secretKey,
        answering(
          Response.json({
            sha256: hash,
            url: `http://blossom.primal.net/${hash}`,
          }),
        ),
      ),
    ).rejects.toThrow();
    await expect(
      uploadToBlossom(
        image,
        secretKey,
        answering(new Response("nope", { status: 413 })),
      ),
    ).rejects.toThrow("upload failed: 413");
  });
});
