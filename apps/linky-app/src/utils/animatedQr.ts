import { optimizeCaseInsensitiveQrPayload } from "./qrPayload";

// NUT-16: a payload too large for one QR travels as a multi-part UR animation
// (Blockchain Commons Uniform Resources). Parts are fountain-coded, so the
// receiver can join mid-cycle and still finish without seeing every frame in
// order — which is what makes a phone camera a workable transport.

/**
 * The UR library's CBOR encoder recognises bytes by `instanceof Uint8Array`,
 * and anything from another realm — the `buffer` polyfill's Buffer, or what
 * TextEncoder returns under some hosts — fails that test and is encoded as a
 * map of numeric keys instead: a payload that decodes back as an object and
 * nearly doubles the frame count. Copying into this realm's Uint8Array settles
 * it for every host.
 */
const toPayloadBytes = (payload: string): Uint8Array =>
  new Uint8Array(new TextEncoder().encode(payload));

/**
 * The cashu fork NUT-16 names. Upstream bc-ur decodes through `cbor-sync`,
 * which picks its reader by `data instanceof Buffer` and refuses every frame
 * in a browser bundle; the fork decodes through `cborg`. Its CJS entry
 * requires that ESM-only package, so the ESM build is imported by path.
 */
const loadUr = () => import("@gandlaf21/bc-ur/dist/lib/es6/index.js");

/**
 * Bytes of payload per frame. At 150 a two-kilobyte token becomes sixteen
 * frames of roughly 340 bytewords each: dense enough to finish a cycle in
 * about three seconds, loose enough for a camera to read off a phone screen.
 */
const UR_FRAGMENT_BYTES = 150;

/**
 * How long one frame stays on screen. The scan loop decodes at most every
 * 200 ms, so a frame has to outlast two of its samples — matching its rate
 * would leave the camera sampling in step with the changes and reading the
 * transitions.
 */
export const ANIMATED_QR_FRAME_MS = 420;

const UR_BYTES_FRAME = /^ur:bytes\/[0-9]+-[0-9]+\//i;

/** Whether a scanned value is one frame of an animation rather than a payload. */
export const isAnimatedQrFrame = (value: string): boolean =>
  UR_BYTES_FRAME.test(value.trim());

export interface AnimatedQrFrames {
  /**
   * The next frame to show. Past the first pass these are fountain parts
   * rather than a repeat of the sequence, so a receiver that missed a frame
   * does not have to wait for that exact one to come round again.
   */
  next: () => string;
  /** Frames in one pass — what a receiver needs at minimum. */
  total: number;
}

export const createAnimatedQrFrames = async (
  payload: string,
): Promise<AnimatedQrFrames> => {
  const { UR, UREncoder } = await loadUr();
  const encoder = new UREncoder(
    UR.fromBuffer(toPayloadBytes(payload)),
    UR_FRAGMENT_BYTES,
    0,
  );

  return {
    // Uppercase lets the QR encoder use its denser alphanumeric mode; UR is
    // defined as case-insensitive for exactly this reason.
    next: () => optimizeCaseInsensitiveQrPayload(encoder.nextPart()),
    total: encoder.fragmentsLength,
  };
};

export type AnimatedQrProgress =
  | {
      status: "collecting";
      /** Distinct parts the decoder holds, and how many it needs in total. */
      received: number;
      expected: number | null;
    }
  | { status: "done"; payload: string }
  | { status: "rejected"; reason: string };

export interface AnimatedQrReader {
  /** Feeds one scanned frame and reports what the animation still needs. */
  receive: (frame: string) => AnimatedQrProgress;
}

export const createAnimatedQrReader = async (): Promise<AnimatedQrReader> => {
  const { URDecoder } = await loadUr();
  let decoder = new URDecoder();

  // A decoder that failed its checksum or produced something that is not a
  // token refuses every further part, so the next frame starts a fresh one.
  const restart = (reason: string): AnimatedQrProgress => {
    decoder = new URDecoder();
    return { status: "rejected", reason };
  };

  return {
    receive: (frame) => {
      // Frames are shown uppercase for QR density and come back that way.
      const part = frame.trim().toLowerCase();
      try {
        if (!decoder.receivePart(part)) {
          return { status: "rejected", reason: "part refused" };
        }
      } catch (error) {
        return {
          status: "rejected",
          reason: error instanceof Error ? error.message : "part threw",
        };
      }
      if (decoder.isError()) return restart("decode failed");

      if (!decoder.isComplete()) {
        const expected = decoder.expectedPartCount();
        return {
          status: "collecting",
          received: decoder.receivedPartIndexes().length,
          expected: expected > 0 ? expected : null,
        };
      }

      try {
        const payload = new TextDecoder().decode(
          decoder.resultUR().decodeCBOR(),
        );
        return { status: "done", payload };
      } catch {
        return restart("not a byte string");
      }
    },
  };
};
