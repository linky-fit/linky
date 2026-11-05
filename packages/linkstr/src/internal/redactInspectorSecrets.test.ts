import { PrivateImage } from "../chat/domain";
import { redactInspectorSecrets } from "./redactInspectorSecrets";

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

const cashuToken =
  "cashuBo2Ftdgtftftftftftftftftftftftftftftftftftftftftftftftftftftftft";

describe("redactInspectorSecrets", () => {
  it("strips key and nonce from an attachment nested anywhere in the value", () => {
    const redacted = redactInspectorSecrets({
      ref: "row-1",
      operation: { _tag: "chat.image", draft: { to: "peer", image } },
      list: [image],
    });

    expect(redacted).toEqual({
      ref: "row-1",
      operation: {
        _tag: "chat.image",
        draft: {
          to: "peer",
          image: {
            url: "https://blossom.test/image",
            fileType: "image/jpeg",
            encryptionAlgorithm: "aes-gcm",
            encryptedSha256: "03".repeat(32),
            originalSha256: "04".repeat(32),
            encryptedSize: 1234,
            width: 640,
            height: 480,
            storageEncoding: "base64",
          },
        },
      },
      list: [expect.not.objectContaining({ key: expect.anything() })],
    });
    expect(JSON.stringify(redacted)).not.toContain("01".repeat(32));
    expect(JSON.stringify(redacted)).not.toContain("02".repeat(12));
  });

  it("redacts a cashu token from a send draft and a received body", () => {
    const redacted = redactInspectorSecrets({
      params: { to: "peer", token: cashuToken },
      event: {
        _tag: "ChatMessageReceived",
        body: { _tag: "TokenBody", token: cashuToken },
      },
    });

    expect(JSON.stringify(redacted)).not.toContain(cashuToken);
    expect(redacted).toMatchObject({
      params: { token: "[redacted cashu token]" },
      event: { body: { token: "[redacted cashu token]" } },
    });
  });

  it("redacts a shared listing marker inside any text and keeps the rest", () => {
    const text =
      "fresh today\n\nEggs · 90 CZK per 10\nnostr:npub1x\nlinky:listing:v1:eyJrZXkiOiIwMSJ9_-";

    expect(redactInspectorSecrets({ draft: { content: text } })).toEqual({
      draft: {
        content:
          "fresh today\n\nEggs · 90 CZK per 10\nnostr:npub1x\nlinky:listing:v1:[redacted listing]",
      },
    });
  });

  it("leaves a non-cashu token field untouched", () => {
    const value = { auth: { token: "bearer-abc123" } };
    expect(redactInspectorSecrets(value)).toBe(value);
  });

  it("returns the same reference when nothing needs redacting", () => {
    const value = {
      draft: { to: "peer", content: "hello", key: "a storage key" },
      tags: [["p", "peer"]],
      count: 3,
    };

    expect(redactInspectorSecrets(value)).toBe(value);
    expect(redactInspectorSecrets("text")).toBe("text");
    expect(redactInspectorSecrets(null)).toBe(null);
  });
});
