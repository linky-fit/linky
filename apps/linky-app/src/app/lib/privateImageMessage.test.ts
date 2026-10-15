import { describe, expect, it } from "vitest";
import {
  chatAttachmentErrorKey,
  getChatAttachmentRejection,
  isPrivatePdfPayload,
  parsePrivateImageMessage,
  privateImagePreviewText,
  serializePrivateImageMessage,
  type PrivateImageMessagePayload,
} from "./privateImageMessage";

const base: PrivateImageMessagePayload = {
  encryptedSha256: "3".repeat(64),
  encryptedSize: 1024,
  encryptionAlgorithm: "aes-gcm",
  fileType: "image/jpeg",
  height: 480,
  key: "1".repeat(64),
  nonce: "2".repeat(24),
  originalSha256: "4".repeat(64),
  storageEncoding: "base64",
  type: "linky.private_image.v1",
  url: "https://blossom.example/blob",
  width: 640,
};

describe("privateImageMessage compact format", () => {
  it("roundtrips an image with dimensions", () => {
    expect(
      parsePrivateImageMessage(serializePrivateImageMessage(base)),
    ).toEqual(base);
  });

  it("roundtrips a PDF without dimensions and with its file name", () => {
    const pdf: PrivateImageMessagePayload = {
      encryptedSha256: base.encryptedSha256,
      encryptedSize: base.encryptedSize,
      encryptionAlgorithm: "aes-gcm",
      fileName: "invoice.pdf",
      fileType: "application/pdf",
      key: base.key,
      nonce: base.nonce,
      originalSha256: base.originalSha256,
      storageEncoding: "base64",
      type: "linky.private_image.v1",
      url: base.url,
    };
    const parsed = parsePrivateImageMessage(serializePrivateImageMessage(pdf));

    expect(parsed).toEqual(pdf);
    expect(parsed && isPrivatePdfPayload(parsed)).toBe(true);
    expect(privateImagePreviewText((key) => key, pdf)).toBe("chatPdfMessage");
    expect(privateImagePreviewText((key) => key, base)).toBe(
      "chatImageMessage",
    );
  });

  it("rejects half-specified dimensions", () => {
    const encoded = serializePrivateImageMessage(base).replace(
      /^linky:image:v1:/,
      "",
    );
    const json: unknown = JSON.parse(
      atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (typeof json !== "object" || json === null || !("h" in json)) {
      throw new Error("expected compact payload with h");
    }
    const withoutHeight = Object.fromEntries(
      Object.entries(json).filter(([key]) => key !== "h"),
    );
    expect(parsePrivateImageMessage(JSON.stringify(withoutHeight))).toBeNull();
  });
});

describe("privateImageMessage legacy JSON format", () => {
  it("parses whitespace-padded legacy JSON and rejects plain text", () => {
    expect(parsePrivateImageMessage(`\n  ${JSON.stringify(base)}  \n`)).toEqual(
      base,
    );
    expect(parsePrivateImageMessage("hello there")).toBeNull();
    expect(parsePrivateImageMessage(`[${JSON.stringify(base)}]`)).toBeNull();
  });
});

describe("chat attachment size checks", () => {
  const fileOfSize = (bytes: number, name: string, type: string) =>
    new File([new Uint8Array(bytes)], name, { type });

  it("accepts a PDF up to 2 MB and rejects a larger one", () => {
    expect(
      getChatAttachmentRejection(
        fileOfSize(2 * 1024 * 1024, "a.pdf", "application/pdf"),
      ),
    ).toBeNull();
    expect(
      getChatAttachmentRejection(
        fileOfSize(2 * 1024 * 1024 + 1, "a.pdf", "application/pdf"),
      ),
    ).toBe("chatPdfTooLarge");
    expect(
      getChatAttachmentRejection(fileOfSize(1, "a.txt", "text/plain")),
    ).toBe("chatAttachmentUnsupported");
  });

  it("maps pipeline size errors to i18n keys", () => {
    expect(chatAttachmentErrorKey(new Error("chat-image-too-large"))).toBe(
      "chatImageTooLarge",
    );
    expect(chatAttachmentErrorKey(new Error("upload-failed:413"))).toBeNull();
  });
});
