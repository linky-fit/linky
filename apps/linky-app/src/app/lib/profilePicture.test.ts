import { encodeNsec, NostrSecretKey } from "@linky-fit/linkstr";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareProfilePicture } from "./profilePicture";

const log = vi.hoisted(() => vi.fn());
vi.mock("../../devtools/inspector/appLog", () => ({ reportAppLog: log }));

const bytes = new TextEncoder().encode("avatar");
const hash = bytesToHex(sha256(bytes));
const preview = "data:image/jpeg;base64,YXZhdGFy";
const url = `https://blossom.primal.net/${hash}.jpg`;
const nsec = encodeNsec(NostrSecretKey.make(new Uint8Array(32).fill(1)));
const fetchMock = vi.fn<typeof fetch>();
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(response({ sha256: hash, url }));
});
afterEach(() => vi.unstubAllGlobals());

describe("public profile photo upload", () => {
  it.each([
    "",
    " https://example.com/avatar.png ",
    "http://example.com/avatar.png",
  ])(
    "keeps an existing URL or empty picture without uploading: %s",
    async (picture) => {
      expect(await prepareProfilePicture(picture, "unused")).toBe(
        picture.trim(),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("uploads the actual image bytes and only returns the verified public URL", async () => {
    expect(await prepareProfilePicture(preview, nsec)).toBe(url);
    const [target, request] = fetchMock.mock.calls[0]!;
    expect(target).toBe("https://blossom.primal.net/upload");
    expect(request?.method).toBe("PUT");
    expect(await new Response(request?.body).text()).toBe("avatar");
    const headers = new Headers(request?.headers);
    expect(headers.get("Content-Type")).toBe("image/jpeg");
    expect(headers.get("X-SHA-256")).toBe(hash);
    expect(headers.get("Authorization")).toMatch(/^Nostr /);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: "profile.pictureUploaded",
        links: { blob: hash },
        payload: { url },
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(nsec);
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      headers.get("Authorization"),
    );
  });

  it("retries a network failure through the proxy as binary with the image MIME type", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await prepareProfilePicture(preview, nsec)).toBe(url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [target, request] = fetchMock.mock.calls[1]!;
    expect(String(target)).toMatch(/\/api\/blossom-upload$/);
    const headers = new Headers(request?.headers);
    expect(headers.get("Content-Type")).toBe("application/octet-stream");
    expect(headers.get("X-Blob-Type")).toBe("image/jpeg");
    expect(headers.get("X-SHA-256")).toBe(hash);
    expect(await new Response(request?.body).text()).toBe("avatar");
  });

  it.each([
    { sha256: "0".repeat(64), url },
    { sha256: hash, url: "data:image/jpeg;base64,YXZhdGFy" },
    { sha256: hash, url: "http://example.com/photo.jpg" },
    { url },
  ])("rejects invalid upload descriptors: %j", async (descriptor) => {
    fetchMock.mockResolvedValueOnce(response(descriptor));
    await expect(prepareProfilePicture(preview, nsec)).rejects.toThrow();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "profile.pictureUploadFailed" }),
    );
  });

  it("rejects an HTTP upload error without returning a picture", async () => {
    fetchMock.mockResolvedValueOnce(response({}, 503));
    await expect(prepareProfilePicture(preview, nsec)).rejects.toThrow(
      "upload-failed:503",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    "blob:local-photo",
    "data:image/svg+xml;base64,YXZhdGFy",
    "data:image/jpeg;base64,",
  ])("refuses unsupported or empty local pictures: %s", async (picture) => {
    await expect(prepareProfilePicture(picture, nsec)).rejects.toThrow(
      "profile-picture-invalid",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not upload without a valid identity", async () => {
    await expect(prepareProfilePicture(preview, "invalid")).rejects.toThrow(
      "profile-picture-auth-failed",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
