import {
  decodeNsec,
  makeBlossomUploadAuthHeader,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Schema } from "effect";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { decodeBase64Url } from "../../utils/base64";
import { getBlossomUploadProxyUrl } from "../../utils/blossomUploadProxy";
import { nowSeconds } from "../../utils/time";
import { isHttpUrl } from "../../utils/validation";

const UPLOAD_URL = "https://blossom.primal.net/upload";
const decodeUpload = Schema.decodeUnknownSync(
  Schema.Struct({
    sha256: Schema.String,
    url: Schema.String.check(
      Schema.makeFilter((url) => url.startsWith("https://") && isHttpUrl(url)),
    ),
  }),
);

export const prepareProfilePicture = async (
  picture: string,
  nsec: string,
): Promise<string> => {
  const value = picture.trim();
  if (!value || isHttpUrl(value)) return value;

  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(value);
  const bytes = match ? decodeBase64Url(match[2]!) : null;
  if (!match || !bytes?.byteLength) throw new Error("profile-picture-invalid");
  const secretKey = decodeNsec(nsec);
  if (!secretKey) throw new Error("profile-picture-auth-failed");

  const hash = bytesToHex(sha256(bytes));
  const links = { blob: hash };
  reportAppLog({
    tag: "profile.pictureUploadStarted",
    summary: "Uploading public profile photo",
    links,
    payload: { size: bytes.byteLength },
  });
  try {
    const authorization = makeBlossomUploadAuthHeader(
      { sha256: hash, serverDomain: new URL(UPLOAD_URL).hostname },
      secretKey,
      UnixSeconds.make(nowSeconds()),
    );
    const request: RequestInit = {
      method: "PUT",
      headers: {
        Authorization: authorization,
        "Content-Type": match[1]!,
        "X-SHA-256": hash,
      },
      body: new Uint8Array(bytes).buffer,
    };
    let response: Response;
    try {
      response = await fetch(UPLOAD_URL, request);
    } catch {
      const headers = new Headers(request.headers);
      headers.set("Content-Type", "application/octet-stream");
      headers.set("X-Blob-Type", match[1]!);
      response = await fetch(getBlossomUploadProxyUrl(), {
        ...request,
        headers,
      });
    }
    if (!response.ok) throw new Error(`upload-failed:${response.status}`);
    const uploaded = decodeUpload(await response.json());
    if (uploaded.sha256.toLowerCase() !== hash)
      throw new Error("upload-hash-mismatch");
    reportAppLog({
      tag: "profile.pictureUploaded",
      summary: "Public profile photo uploaded",
      links,
      payload: { url: uploaded.url },
    });
    return uploaded.url;
  } catch (error) {
    reportAppLog({
      tag: "profile.pictureUploadFailed",
      summary: "Public profile photo upload failed",
      links,
      payload: {},
    });
    throw error;
  }
};
