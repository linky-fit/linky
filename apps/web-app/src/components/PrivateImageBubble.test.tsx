import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import {
  decryptPrivateImageMessage,
  type PrivateImageMessagePayload,
} from "../app/lib/privateImageMessage";
import { PrivateImageBubble } from "./PrivateImageBubble";

vi.mock("../app/lib/privateImageMessage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../app/lib/privateImageMessage")>();
  return {
    ...actual,
    decryptPrivateImageMessage: vi.fn(
      async () => new Blob(["img"], { type: "image/jpeg" }),
    ),
  };
});

const decryptMock = vi.mocked(decryptPrivateImageMessage);

const payload: PrivateImageMessagePayload = {
  encryptedSha256: "a".repeat(64),
  encryptedSize: 4,
  encryptionAlgorithm: "aes-gcm",
  fileType: "image/jpeg",
  height: 10,
  key: "b".repeat(64),
  nonce: "c".repeat(24),
  originalSha256: "d".repeat(64),
  storageEncoding: "base64",
  type: "linky.private_image.v1",
  url: "https://example.com/blob",
  width: 10,
};

describe("PrivateImageBubble", () => {
  beforeEach(() => {
    decryptMock.mockClear();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:test"),
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("decrypts once even when the parent re-renders with a fresh onBlobChange", async () => {
    const bubble = () => (
      <PrivateImageBubble
        onBlobChange={() => undefined}
        payload={payload}
        rumorId={null}
        t={(key) => key}
      />
    );
    const rendered = await renderIntoDocument(bubble());
    expect(decryptMock).toHaveBeenCalledTimes(1);

    // The bank offer detail page re-renders every second for its countdown,
    // passing a new inline callback each time.
    await rendered.rerender(bubble());
    await rendered.rerender(bubble());

    expect(decryptMock).toHaveBeenCalledTimes(1);

    await rendered.unmount();
  });

  it("reports the decrypted blob to the parent", async () => {
    const onBlobChange = vi.fn();

    const { root } = await renderIntoDocument(
      <PrivateImageBubble
        onBlobChange={onBlobChange}
        payload={payload}
        rumorId={null}
        t={(key) => key}
      />,
    );

    expect(onBlobChange).toHaveBeenLastCalledWith(expect.any(Blob));

    await act(async () => {
      root.unmount();
    });
  });
});
