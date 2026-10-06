import { createHash } from "node:crypto";

const BLOSSOM_UPLOAD_URL = "https://blossom.primal.net/upload";
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

interface RequestLike {
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
}

interface ResponseLike {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => {
    json: (body: unknown) => void;
    send: (body: string) => void;
  };
}

const readHeader = (headers: RequestLike["headers"], name: string): string => {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value)
    ? String(value[0] ?? "").trim()
    : String(value ?? "").trim();
};

const readBodyBytes = (body: unknown): Uint8Array | null => {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof body === "string") return new TextEncoder().encode(body);
  return null;
};

const copyToArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

export default async function handler(req: RequestLike, res: ResponseLike) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-SHA-256, X-Blob-Type",
  );
  res.setHeader("Access-Control-Allow-Methods", "OPTIONS, PUT");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "PUT") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const authorization = readHeader(req.headers, "authorization");
  const blobType = readHeader(req.headers, "x-blob-type");
  const expectedSha256 = readHeader(req.headers, "x-sha-256").toLowerCase();
  const bytes = readBodyBytes(req.body);

  if (!authorization.startsWith("Nostr ") || authorization.length > 16_384) {
    res.status(400).json({ error: "Invalid authorization" });
    return;
  }
  if (!SHA256_PATTERN.test(expectedSha256)) {
    res.status(400).json({ error: "Invalid SHA-256" });
    return;
  }
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
    res.status(413).json({ error: "Invalid upload size" });
    return;
  }

  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== expectedSha256) {
    res.status(400).json({ error: "SHA-256 mismatch" });
    return;
  }

  try {
    const response = await fetch(BLOSSOM_UPLOAD_URL, {
      method: "PUT",
      headers: {
        Authorization: authorization,
        "Content-Type": /^image\/(jpeg|png|webp|gif)$/.test(blobType)
          ? blobType
          : "text/plain;charset=UTF-8",
        "X-SHA-256": expectedSha256,
      },
      body: copyToArrayBuffer(bytes),
    });
    const responseText = await response.text();
    // Blossom's descriptor is JSON; never reflect the upstream content type so
    // a hostile response cannot render as a document on the app origin.
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(response.status).send(responseText);
  } catch {
    res.status(502).json({ error: "Blossom upload failed" });
  }
}
