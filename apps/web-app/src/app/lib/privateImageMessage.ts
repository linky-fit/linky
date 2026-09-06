import {
  makeBlossomUploadAuthHeader,
  NostrSecretKey,
  UnixSeconds,
} from "@linky/linkstr";
import { sha256 } from "@noble/hashes/sha2.js";
import { Schema } from "effect";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { decodeBase64Url, encodeBase64Url } from "../../utils/base64";
import { getUnknownErrorMessage, isRecord } from "../../utils/unknown";
import { asNonEmptyString } from "../../utils/validation";
import { nowSeconds } from "../../utils/time";
import type { I18nKey, Translate } from "../../i18n";

const PRIVATE_IMAGE_MESSAGE_TYPE = "linky.private_image.v1";
const PRIVATE_IMAGE_COMPACT_PREFIX = "linky:image:v1:";
const BLOSSOM_UPLOAD_SERVERS = ["https://blossom.primal.net"];
const LINKY_WEB_APP_ORIGIN = "https://app.linky.fit";
const MAX_IMAGE_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_PDF_BYTES = 2 * 1024 * 1024;
const PDF_FILE_TYPE = "application/pdf";
const PDF_MAGIC = "%PDF-";
// Base64url of a 2 MB payload plus the AES-GCM tag, rounded up — no valid
// attachment is stored larger than this, so anything bigger is refused
// before a single byte is buffered.
const MAX_STORED_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_SIDE_PX = 1280;
const MIN_IMAGE_SIDE_PX = 480;
const IMAGE_JPEG_QUALITY = 0.8;
const IMAGE_RESIZE_FACTOR = 0.8;
const IMAGE_QUALITY_STEP = 0.06;
const MIN_IMAGE_JPEG_QUALITY = 0.62;

export interface PrivateImageMessagePayload {
  encryptedSha256: string;
  encryptedSize: number;
  encryptionAlgorithm: "aes-gcm";
  fileName?: string;
  fileType: string;
  height?: number;
  key: string;
  nonce: string;
  originalSha256: string;
  storageEncoding: "base64" | "raw";
  type: "linky.private_image.v1";
  url: string;
  width?: number;
}

interface CompactPrivateImageMessagePayload {
  a: "g";
  e?: "b";
  f?: string;
  h?: number;
  k: string;
  m: string;
  n: string;
  o: string;
  s: number;
  t: "i1";
  u: string;
  w?: number;
  x: string;
}

interface PreparedPrivateFileBytes {
  bytes: Uint8Array;
  fileName?: string;
  fileType: string;
  height?: number;
  width?: number;
}

interface PreparedPrivateImage {
  encryptedBytes: Uint8Array;
  encryptedSha256: string;
  encryptedSize: number;
  fileName?: string;
  fileType: string;
  height?: number;
  key: string;
  nonce: string;
  originalSha256: string;
  width?: number;
}

interface UploadDescriptor {
  sha256: string;
  url: string;
}

interface BlossomUploadAuth {
  privateKey: Uint8Array;
}

interface PrivateImageSendResult {
  content: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const isNostrSecretKey = Schema.is(NostrSecretKey);

const hexToBytesOrNull = (hex: string): Uint8Array | null => {
  try {
    return hexToBytes(hex.trim());
  } catch {
    return null;
  }
};

const sha256Hex = (bytes: Uint8Array): string => bytesToHex(sha256(bytes));

const base64UrlToText = (value: string): string | null => {
  const bytes = decodeBase64Url(value);
  return bytes ? textDecoder.decode(bytes) : null;
};

const textToBase64Url = (value: string): string =>
  encodeBase64Url(textEncoder.encode(value));

const randomHex = (byteLength: number): string => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
};

const copyToArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const getBlossomUploadProxyUrl = (): string => {
  if (typeof window === "undefined") {
    return `${LINKY_WEB_APP_ORIGIN}/api/blossom-upload`;
  }

  const { hostname, origin, protocol } = window.location;
  const isLocalDevelopment =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]";
  if ((protocol === "https:" || protocol === "http:") && !isLocalDevelopment) {
    return `${origin}/api/blossom-upload`;
  }

  return `${LINKY_WEB_APP_ORIGIN}/api/blossom-upload`;
};

const readPositiveInteger = (value: unknown): number | null => {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.trunc(value);
};

const loadImage = async (file: File): Promise<HTMLImageElement> => {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("image-load-failed"));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const canvasToBlob = async (
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> =>
  await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("image-encode-failed"));
      },
      type,
      quality,
    );
  });

const isPdfFileType = (fileType: string): boolean => fileType === PDF_FILE_TYPE;

export const isPrivatePdfPayload = (
  payload: PrivateImageMessagePayload,
): boolean => isPdfFileType(payload.fileType);

const isPdfFile = (file: File): boolean =>
  isPdfFileType(file.type) || (file.type === "" && /\.pdf$/i.test(file.name));

/** i18n key of the reason the file can't be sent, or null when it can. */
export const getChatAttachmentRejection = (file: File): I18nKey | null => {
  if (isPdfFile(file)) {
    return file.size > MAX_PDF_BYTES ? "chatPdfTooLarge" : null;
  }
  if (!file.type.startsWith("image/")) return "chatAttachmentUnsupported";
  return file.size > MAX_IMAGE_SOURCE_BYTES ? "chatImageTooLarge" : null;
};

export const chatAttachmentErrorKey = (error: unknown): I18nKey | null => {
  const message = getUnknownErrorMessage(error, "");
  if (message === "chat-file-too-large") return "chatPdfTooLarge";
  if (message === "chat-image-too-large") return "chatImageTooLarge";
  if (message === "chat-image-unsupported") return "chatAttachmentUnsupported";
  return null;
};

const readPdfBytes = async (file: File): Promise<PreparedPrivateFileBytes> => {
  if (file.size > MAX_PDF_BYTES) throw new Error("chat-file-too-large");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileName = file.name.trim();
  return {
    bytes,
    fileType: PDF_FILE_TYPE,
    ...(fileName ? { fileName } : {}),
  };
};

const resizeImageToJpegBytes = async (
  file: File,
): Promise<PreparedPrivateFileBytes> => {
  if (!file.type.startsWith("image/")) {
    throw new Error("chat-image-unsupported");
  }
  if (file.size > MAX_IMAGE_SOURCE_BYTES) {
    throw new Error("chat-image-too-large");
  }

  const image = await loadImage(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) throw new Error("chat-image-invalid");

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("chat-image-canvas-unavailable");

  let maxSide = MAX_IMAGE_SIDE_PX;
  let quality = IMAGE_JPEG_QUALITY;
  while (maxSide >= MIN_IMAGE_SIDE_PX) {
    const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    canvas.width = width;
    canvas.height = height;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    if (blob.size <= MAX_IMAGE_OUTPUT_BYTES) {
      return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        fileType: "image/jpeg",
        height,
        width,
      };
    }

    maxSide = Math.floor(maxSide * IMAGE_RESIZE_FACTOR);
    quality = Math.max(MIN_IMAGE_JPEG_QUALITY, quality - IMAGE_QUALITY_STEP);
  }

  throw new Error("chat-image-too-large");
};

const encryptImageBytes = async (file: File): Promise<PreparedPrivateImage> => {
  const source = isPdfFile(file)
    ? await readPdfBytes(file)
    : await resizeImageToJpegBytes(file);
  const key = randomHex(32);
  const nonce = randomHex(12);
  const keyBytes = hexToBytesOrNull(key);
  const nonceBytes = hexToBytesOrNull(nonce);
  if (!keyBytes || !nonceBytes) throw new Error("chat-image-encryption-failed");

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    copyToArrayBuffer(keyBytes),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: copyToArrayBuffer(nonceBytes) },
    cryptoKey,
    copyToArrayBuffer(source.bytes),
  );
  const encryptedBytes = new Uint8Array(encryptedBuffer);
  const storedBytes = textEncoder.encode(encodeBase64Url(encryptedBytes));

  return {
    encryptedBytes: storedBytes,
    encryptedSha256: sha256Hex(storedBytes),
    encryptedSize: storedBytes.byteLength,
    fileType: source.fileType,
    key,
    nonce,
    originalSha256: sha256Hex(source.bytes),
    ...(source.width !== undefined && source.height !== undefined
      ? { width: source.width, height: source.height }
      : {}),
    ...(source.fileName !== undefined ? { fileName: source.fileName } : {}),
  };
};

const uploadToBlossom = async (
  prepared: PreparedPrivateImage,
  auth: BlossomUploadAuth,
): Promise<UploadDescriptor> => {
  if (!isNostrSecretKey(auth.privateKey)) {
    throw new Error("chat-image-auth-failed");
  }
  let lastError: unknown = null;

  for (const server of BLOSSOM_UPLOAD_SERVERS) {
    try {
      const baseUrl = server.replace(/\/+$/, "");
      const serverDomain = new URL(baseUrl).hostname.toLowerCase();
      const authHeader = makeBlossomUploadAuthHeader(
        { sha256: prepared.encryptedSha256, serverDomain },
        auth.privateKey,
        UnixSeconds.make(nowSeconds()),
      );
      const uploadBody = copyToArrayBuffer(prepared.encryptedBytes);
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/upload`, {
          method: "PUT",
          headers: {
            Authorization: authHeader,
            "Content-Type": "text/plain;charset=UTF-8",
          },
          body: uploadBody,
        });
      } catch {
        response = await fetch(getBlossomUploadProxyUrl(), {
          method: "PUT",
          headers: {
            Authorization: authHeader,
            "Content-Type": "text/plain;charset=UTF-8",
            "X-SHA-256": prepared.encryptedSha256,
          },
          body: uploadBody,
        });
      }

      if (!response.ok) {
        throw new Error(`upload-failed:${response.status}`);
      }

      const json = await response.json();
      if (!isRecord(json)) throw new Error("upload-invalid-response");

      const url = asNonEmptyString(json.url);
      const sha = asNonEmptyString(json.sha256);
      if (!url || !sha) throw new Error("upload-invalid-response");
      if (sha.toLowerCase() !== prepared.encryptedSha256) {
        throw new Error("upload-hash-mismatch");
      }
      return { sha256: sha.toLowerCase(), url };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("upload-failed");
};

export const serializePrivateImageMessage = (
  payload: PrivateImageMessagePayload,
): string => {
  const compact: CompactPrivateImageMessagePayload = {
    a: "g",
    ...(payload.storageEncoding === "base64" ? { e: "b" } : {}),
    ...(payload.fileName !== undefined ? { f: payload.fileName } : {}),
    ...(payload.height !== undefined ? { h: payload.height } : {}),
    k: payload.key,
    m: payload.fileType,
    n: payload.nonce,
    o: payload.originalSha256,
    s: payload.encryptedSize,
    t: "i1",
    u: payload.url,
    ...(payload.width !== undefined ? { w: payload.width } : {}),
    x: payload.encryptedSha256,
  };
  return `${PRIVATE_IMAGE_COMPACT_PREFIX}${textToBase64Url(
    JSON.stringify(compact),
  )}`;
};

export const createPrivateImageSendPayload = async (
  file: File,
  auth: BlossomUploadAuth,
): Promise<PrivateImageSendResult> => {
  const prepared = await encryptImageBytes(file);
  const upload = await uploadToBlossom(prepared, auth);
  if (upload.sha256 !== prepared.encryptedSha256) {
    throw new Error("upload-hash-mismatch");
  }

  const payload: PrivateImageMessagePayload = {
    encryptedSha256: prepared.encryptedSha256,
    encryptedSize: prepared.encryptedSize,
    encryptionAlgorithm: "aes-gcm",
    fileType: prepared.fileType,
    key: prepared.key,
    nonce: prepared.nonce,
    originalSha256: prepared.originalSha256,
    storageEncoding: "base64",
    type: PRIVATE_IMAGE_MESSAGE_TYPE,
    url: upload.url,
    ...(prepared.width !== undefined && prepared.height !== undefined
      ? { width: prepared.width, height: prepared.height }
      : {}),
    ...(prepared.fileName !== undefined ? { fileName: prepared.fileName } : {}),
  };

  return {
    content: serializePrivateImageMessage(payload),
  };
};

const parsePrivateImageRecord = (
  parsed: Record<string, unknown>,
): PrivateImageMessagePayload | null => {
  const isCompact = parsed.t === "i1";
  if (!isCompact && parsed.type !== PRIVATE_IMAGE_MESSAGE_TYPE) return null;

  const url = asNonEmptyString(isCompact ? parsed.u : parsed.url);
  const fileType = asNonEmptyString(isCompact ? parsed.m : parsed.fileType);
  const encryptionAlgorithm = isCompact
    ? parsed.a === "g"
      ? "aes-gcm"
      : null
    : asNonEmptyString(parsed.encryptionAlgorithm);
  const key = asNonEmptyString(isCompact ? parsed.k : parsed.key);
  const nonce = asNonEmptyString(isCompact ? parsed.n : parsed.nonce);
  const encryptedSha256 = asNonEmptyString(
    isCompact ? parsed.x : parsed.encryptedSha256,
  );
  const originalSha256 = asNonEmptyString(
    isCompact ? parsed.o : parsed.originalSha256,
  );
  const storageEncodingValue = isCompact ? parsed.e : parsed.storageEncoding;
  const storageEncoding =
    storageEncodingValue === "b" || storageEncodingValue === "base64"
      ? "base64"
      : storageEncodingValue === undefined || storageEncodingValue === "raw"
        ? "raw"
        : null;
  const encryptedSize = readPositiveInteger(
    isCompact ? parsed.s : parsed.encryptedSize,
  );
  const widthValue = isCompact ? parsed.w : parsed.width;
  const heightValue = isCompact ? parsed.h : parsed.height;
  const hasDimensions = widthValue !== undefined || heightValue !== undefined;
  const width = readPositiveInteger(widthValue);
  const height = readPositiveInteger(heightValue);
  const fileName = asNonEmptyString(isCompact ? parsed.f : parsed.fileName);

  if (
    !url ||
    !fileType ||
    encryptionAlgorithm !== "aes-gcm" ||
    !key ||
    !nonce ||
    !encryptedSha256 ||
    !originalSha256 ||
    !storageEncoding ||
    !encryptedSize ||
    encryptedSize > MAX_STORED_ATTACHMENT_BYTES ||
    (hasDimensions && (!width || !height))
  ) {
    return null;
  }

  return {
    encryptedSha256: encryptedSha256.toLowerCase(),
    encryptedSize,
    encryptionAlgorithm,
    fileType,
    key: key.toLowerCase(),
    nonce: nonce.toLowerCase(),
    originalSha256: originalSha256.toLowerCase(),
    storageEncoding,
    type: PRIVATE_IMAGE_MESSAGE_TYPE,
    url,
    ...(width && height ? { width, height } : {}),
    ...(fileName ? { fileName } : {}),
  };
};

export const parsePrivateImageMessage = (
  content: unknown,
): PrivateImageMessagePayload | null => {
  const text = asNonEmptyString(content);
  if (!text) return null;

  if (text.startsWith(PRIVATE_IMAGE_COMPACT_PREFIX)) {
    const encoded = text.slice(PRIVATE_IMAGE_COMPACT_PREFIX.length);
    const jsonText = base64UrlToText(encoded);
    if (!jsonText) return null;
    let compactParsed: unknown;
    try {
      compactParsed = JSON.parse(jsonText);
    } catch {
      return null;
    }
    if (!isRecord(compactParsed)) return null;
    return parsePrivateImageRecord(compactParsed);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  return parsePrivateImageRecord(parsed);
};

const readBodyExactly = async (
  response: Response,
  expectedBytes: number,
): Promise<Uint8Array | null> => {
  const declared = Number(response.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared !== expectedBytes) return null;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength === expectedBytes ? bytes : null;
  }

  const bytes = new Uint8Array(expectedBytes);
  let received = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.byteLength > expectedBytes) return null;
      bytes.set(value, received);
      received += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return received === expectedBytes ? bytes : null;
};

const hasPdfMagic = (bytes: Uint8Array): boolean =>
  textDecoder.decode(bytes.subarray(0, PDF_MAGIC.length)) === PDF_MAGIC;

export const decryptPrivateImageMessage = async (
  payload: PrivateImageMessagePayload,
): Promise<Blob> => {
  const response = await fetch(payload.url);
  if (!response.ok) throw new Error("chat-image-download-failed");

  const storedBytes = await readBodyExactly(response, payload.encryptedSize);
  if (!storedBytes) throw new Error("chat-image-size-mismatch");
  if (sha256Hex(storedBytes) !== payload.encryptedSha256) {
    throw new Error("chat-image-hash-mismatch");
  }
  const encryptedBytes =
    payload.storageEncoding === "base64"
      ? decodeBase64Url(textDecoder.decode(storedBytes))
      : storedBytes;
  if (!encryptedBytes) throw new Error("chat-image-invalid-encoding");

  const keyBytes = hexToBytesOrNull(payload.key);
  const nonceBytes = hexToBytesOrNull(payload.nonce);
  if (!keyBytes || !nonceBytes) throw new Error("chat-image-invalid-key");

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    copyToArrayBuffer(keyBytes),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: copyToArrayBuffer(nonceBytes) },
    cryptoKey,
    copyToArrayBuffer(encryptedBytes),
  );
  const decryptedBytes = new Uint8Array(decryptedBuffer);

  if (sha256Hex(decryptedBytes) !== payload.originalSha256) {
    throw new Error("chat-image-original-hash-mismatch");
  }
  if (isPdfFileType(payload.fileType) && !hasPdfMagic(decryptedBytes)) {
    throw new Error("chat-file-not-pdf");
  }

  return new Blob([decryptedBytes], { type: payload.fileType });
};

export const privateImagePreviewText = (
  t: Translate,
  payload: PrivateImageMessagePayload,
): string =>
  isPrivatePdfPayload(payload) ? t("chatPdfMessage") : t("chatImageMessage");
