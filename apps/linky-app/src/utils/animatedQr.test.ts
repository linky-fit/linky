import { describe, expect, it } from "vitest";
import {
  createAnimatedQrFrames,
  createAnimatedQrReader,
  isAnimatedQrFrame,
} from "./animatedQr";

const token = `cashuB${"o2FtcGh0dHBzOi8vY2FzaHUuY3phdWNzYXRhdIGiYWlIAbqH8lOtAF9hcI".repeat(40)}`;

describe("animated QR frames", () => {
  it("splits a large payload into uppercase UR parts", async () => {
    const frames = await createAnimatedQrFrames(token);

    expect(frames.total).toBeGreaterThan(1);
    const first = frames.next();
    expect(first.startsWith("UR:BYTES/")).toBe(true);
    expect(isAnimatedQrFrame(first)).toBe(true);
  });

  it("reassembles the payload from frames seen out of order", async () => {
    const frames = await createAnimatedQrFrames(token);
    const seen: string[] = [];
    for (let i = 0; i < frames.total; i += 1) seen.push(frames.next());

    const reader = await createAnimatedQrReader();
    let done: string | null = null;
    for (const frame of [...seen].reverse()) {
      const progress = reader.receive(frame);
      if (progress.status === "done") done = progress.payload;
    }

    expect(done).toBe(token);
  });

  it("finishes for a receiver that joined mid-cycle", async () => {
    const frames = await createAnimatedQrFrames(token);
    // Miss the opening frames, then keep reading: fountain parts fill the gap
    // without waiting for the exact ones that were missed.
    for (let i = 0; i < 3; i += 1) frames.next();

    const reader = await createAnimatedQrReader();
    let done: string | null = null;
    for (let i = 0; i < frames.total * 4 && done === null; i += 1) {
      const progress = reader.receive(frames.next());
      if (progress.status === "done") done = progress.payload;
    }

    expect(done).toBe(token);
  });

  it("reports how much of the animation it holds", async () => {
    const frames = await createAnimatedQrFrames(token);
    const reader = await createAnimatedQrReader();

    const first = reader.receive(frames.next());
    if (first.status !== "collecting") throw new Error("expected progress");
    expect(first.received).toBe(1);
    expect(first.expected).toBe(frames.total);

    const second = reader.receive(frames.next());
    if (second.status !== "collecting") throw new Error("expected progress");
    expect(second.received).toBe(2);
  });

  it("refuses to mix two animations together", async () => {
    // Both are multi-part; only their checksums tell them apart.
    const other = await createAnimatedQrFrames(`${token}-and-then-some`);
    const reader = await createAnimatedQrReader();
    expect(
      reader.receive((await createAnimatedQrFrames(token)).next()).status,
    ).toBe("collecting");

    expect(reader.receive(other.next()).status).toBe("rejected");
  });

  it("knows a plain payload is not a frame", () => {
    expect(isAnimatedQrFrame(token)).toBe(false);
    expect(isAnimatedQrFrame("lnbc1...")).toBe(false);
    expect(isAnimatedQrFrame("ur:bytes/1-16/lpadbe")).toBe(true);
  });
});
