import {
  makeBlossomUploadAuthHeader,
  UnixSeconds,
  type NostrSecretKey,
} from "@linky-fit/linkstr";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Schema } from "effect";
import { ProfilePicture } from "../storage/profile";
import { nowSeconds } from "../utils/time";

/** An encoded image ready to upload, e.g. `image/webp`. */
export interface ImageFile {
  readonly bytes: Uint8Array;
  readonly type: string;
}

const UploadResponse = Schema.Struct({
  sha256: Schema.String,
  url: ProfilePicture,
});

/**
 * Uploads the image signed by the account's Nostr key and resolves with its public https URL.
 * The server has to answer CORS for any origin, because the static app uploads directly.
 */
export const uploadToBlossom = async (
  image: ImageFile,
  secretKey: NostrSecretKey,
  serverUrl: string,
  fetchFn: typeof fetch,
): Promise<string> => {
  const hash = bytesToHex(sha256(image.bytes));
  const response = await fetchFn(`${serverUrl}/upload`, {
    method: "PUT",
    headers: {
      Authorization: makeBlossomUploadAuthHeader(
        { sha256: hash, serverDomain: new URL(serverUrl).hostname },
        secretKey,
        UnixSeconds.make(nowSeconds()),
      ),
      "Content-Type": image.type,
      "X-SHA-256": hash,
    },
    body: new Blob([new Uint8Array(image.bytes)], { type: image.type }),
  });
  if (!response.ok) throw new Error(`upload failed: ${response.status}`);
  const uploaded = Schema.decodeUnknownSync(UploadResponse)(
    await response.json(),
  );
  if (uploaded.sha256.toLowerCase() !== hash) {
    throw new Error("upload returned another blob");
  }
  return uploaded.url;
};
