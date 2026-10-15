// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./blossom-upload";

afterEach(() => vi.unstubAllGlobals());

describe("Blossom upload proxy content type", () => {
  it.each([
    ["image/jpeg", "image/jpeg"],
    ["", "text/plain;charset=UTF-8"],
    ["image/svg+xml", "text/plain;charset=UTF-8"],
  ])("forwards %s as %s", async (contentType, forwardedType) => {
    const bytes = new TextEncoder().encode("uploaded bytes");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const send = vi.fn();
    const setHeader = vi.fn();
    await handler(
      {
        method: "PUT",
        body: bytes,
        headers: {
          authorization: "Nostr proof",
          "content-type": contentType
            ? "application/octet-stream"
            : "text/plain;charset=UTF-8",
          "x-blob-type": contentType,
          "x-sha-256": hash,
        },
      },
      { setHeader, status: () => ({ json: vi.fn(), send }) },
    );
    const request = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(request?.headers).get("Content-Type")).toBe(
      forwardedType,
    );
    expect(await new Response(request?.body).text()).toBe("uploaded bytes");
    expect(setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/json; charset=utf-8",
    );
    expect(send).toHaveBeenCalledWith("{}");
  });
});
