import { Buffer } from "buffer";
import { decodeBase64Url, encodeBase64Url } from "../utils/base64";

type BufferFromArgs =
  | [arrayLike: ArrayLike<number> | ArrayBufferView]
  | [
      arrayBuffer: ArrayBuffer | SharedArrayBuffer,
      byteOffset?: number,
      length?: number,
    ]
  | [value: string, encoding?: string];

interface ProcessLike {
  emitWarning?: (message: string, type?: string, code?: string) => void;
  env?: Record<string, string | undefined>;
}

const isBufferConstructor = (value: unknown): value is typeof Buffer => {
  return typeof value === "function" && "from" in value && "prototype" in value;
};

const getGlobalBuffer = (): typeof Buffer | null => {
  const candidate = Reflect.get(globalThis, "Buffer");
  return isBufferConstructor(candidate) ? candidate : null;
};

const getGlobalProcess = (): object | null => {
  const candidate = Reflect.get(globalThis, "process");
  if (candidate && typeof candidate === "object") {
    return candidate;
  }
  return null;
};

// Some dependencies (e.g. Cashu libs) expect Node's global Buffer.
// Provide a safe browser polyfill.
if (!getGlobalBuffer()) {
  try {
    Object.defineProperty(globalThis, "Buffer", {
      configurable: true,
      value: Buffer,
      writable: true,
    });
  } catch {
    Reflect.set(globalThis, "Buffer", Buffer);
  }
}

// Some browserified Node deps still expect a global `process`.
// Provide a tiny shim before any lazy-loaded app code runs.
if (!getGlobalProcess()) {
  const processShim: ProcessLike = {
    emitWarning: (message: string, type?: string, code?: string) => {
      if (
        typeof console !== "undefined" &&
        typeof console.warn === "function"
      ) {
        console.warn(message, type, code);
      }
    },
    env: {},
  };

  try {
    Object.defineProperty(globalThis, "process", {
      configurable: true,
      value: processShim,
      writable: true,
    });
  } catch {
    Reflect.set(globalThis, "process", processShim);
  }
}

// The `buffer` polyfill doesn't implement Node's newer "base64url" encoding.
// Some deps (e.g. Evolu) use it for compact URL-safe IDs.
// Patch in minimal support to avoid boot crashes in the browser.
(() => {
  const B = getGlobalBuffer();
  if (!B) return;

  const patchMarker = "__linkyBase64UrlPatched";
  if (Reflect.get(B.prototype, patchMarker) === true) return;

  const origToString = B.prototype.toString;
  Object.defineProperty(B.prototype, "toString", {
    configurable: true,
    value: function (
      this: Buffer,
      encoding?: string,
      start?: number,
      end?: number,
    ) {
      if (encoding === "base64url") {
        return encodeBase64Url(this.subarray(start, end));
      }
      return origToString.call(this, encoding, start, end);
    },
    writable: true,
  });

  const origFrom = B.from;
  Object.defineProperty(B, "from", {
    configurable: true,
    value: function (this: typeof Buffer, ...args: BufferFromArgs) {
      const [value, encodingOrOffset] = args;
      if (typeof value === "string" && encodingOrOffset === "base64url") {
        return Reflect.apply(origFrom, this, [
          decodeBase64Url(value) ?? new Uint8Array(0),
        ]);
      }
      return Reflect.apply(origFrom, this, args);
    },
    writable: true,
  });

  Reflect.set(B.prototype, patchMarker, true);
})();
