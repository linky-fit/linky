import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { renderPdfPages } from "../app/lib/pdfPreview";
import {
  decryptPrivateImageMessage,
  type PrivateImageMessagePayload,
} from "../app/lib/privateImageMessage";
import { PrivateFileBubble } from "./PrivateFileBubble";

vi.mock("../app/lib/privateImageMessage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../app/lib/privateImageMessage")>();
  return {
    ...actual,
    decryptPrivateImageMessage: vi.fn(
      async () => new Blob(["%PDF"], { type: "application/pdf" }),
    ),
  };
});

vi.mock("../app/lib/pdfPreview", () => ({
  renderPdfPages: vi.fn(async () => [
    { height: 400, url: "blob:page-1", width: 300 },
  ]),
  revokePdfPages: vi.fn(),
}));

const renderMock = vi.mocked(renderPdfPages);
const decryptMock = vi.mocked(decryptPrivateImageMessage);

const payload: PrivateImageMessagePayload = {
  encryptedSha256: "a".repeat(64),
  encryptedSize: 4,
  encryptionAlgorithm: "aes-gcm",
  fileName: "invoice.pdf",
  fileType: "application/pdf",
  key: "b".repeat(64),
  nonce: "c".repeat(24),
  originalSha256: "d".repeat(64),
  storageEncoding: "base64",
  type: "linky.private_image.v1",
  url: "https://example.com/blob",
};

const render = async () => {
  const { container } = await renderIntoDocument(
    <PrivateFileBubble
      onBlobChange={() => undefined}
      payload={payload}
      rumorId="rumor-1"
      t={(key) => key}
    />,
  );
  return container;
};

describe("PrivateFileBubble", () => {
  beforeEach(() => {
    renderMock.mockClear();
    decryptMock.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the first page as preview without save/share buttons", async () => {
    const container = await render();

    const preview = container.querySelector<HTMLImageElement>(
      ".chat-private-pdf-preview img",
    );
    expect(preview?.src).toBe("blob:page-1");
    expect(container.textContent).toContain("invoice.pdf");
    expect(container.textContent).not.toContain("chatPdfSave");
    expect(container.textContent).not.toContain("share");
  });

  it("opens a viewer with the pages and save/share actions", async () => {
    const container = await render();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".chat-private-pdf-preview")
        ?.click();
    });

    expect(container.querySelector(".chat-image-viewer")).not.toBeNull();
    expect(
      container.querySelectorAll(".chat-pdf-viewer-pages img"),
    ).toHaveLength(1);
    expect(container.textContent).toContain("chatPdfSave");
    expect(container.textContent).toContain("share");
  });

  it("falls back to the file card when the preview cannot be rendered", async () => {
    renderMock.mockRejectedValueOnce(new Error("broken"));
    const container = await render();

    expect(container.querySelector(".chat-private-pdf-preview")).toBeNull();
    expect(container.querySelector(".chat-private-file")).not.toBeNull();
    expect(container.textContent).toContain("invoice.pdf");
  });
});
