import { describe, expect, it } from "vitest";
import { DUE, HOUR, recurringOrderFixture } from "./testing/orders";
import {
  claimPatch,
  interruptedRunPatch,
  resumePatch,
  runFailedPatch,
  runSkippedPatch,
  runStartedPatch,
} from "./transitions";

const advance = { nextDueAtSec: DUE + 6 * HOUR, runCount: 1 };

describe("transitions", () => {
  it("claims a due time for a device", () => {
    expect(claimPatch("device-a", DUE - 30, DUE)).toEqual({
      claimDeviceId: "device-a",
      claimAtSec: DUE - 30,
      claimDueAtSec: DUE,
    });
  });

  it("advances the schedule when a run starts and rolls it back on failure", () => {
    expect(runStartedPatch(advance, DUE + 5)).toEqual({
      lastRunAtSec: DUE + 5,
      lastRunStatus: "running",
      nextDueAtSec: DUE + 6 * HOUR,
      runCount: 1,
    });
    expect(runFailedPatch(recurringOrderFixture())).toEqual({
      lastRunStatus: "failed",
      nextDueAtSec: DUE,
      runCount: 0,
    });
    expect(runSkippedPatch(advance, DUE + 5)).toMatchObject({
      lastRunStatus: "skipped",
      nextDueAtSec: DUE + 6 * HOUR,
    });
  });

  describe("interruptedRunPatch", () => {
    const interrupted = recurringOrderFixture({
      claim: { deviceId: "device-a", atSec: DUE - 60, dueAtSec: DUE },
      lastRunStatus: "running",
      schedule: {
        ...recurringOrderFixture().schedule,
        nextDueAtSec: DUE + 6 * HOUR,
        runCount: 1,
      },
    });

    it("restores the claimed due time when nothing was paid", () => {
      expect(interruptedRunPatch(interrupted, false)).toEqual({
        lastRunStatus: "interrupted",
        nextDueAtSec: DUE,
        runCount: 0,
      });
    });

    it("marks the run paid when the history records it", () => {
      expect(interruptedRunPatch(interrupted, true)).toEqual({
        lastRunStatus: "paid",
      });
    });

    it("only marks it when no claim says which due time it was", () => {
      expect(
        interruptedRunPatch({ ...interrupted, claim: null }, false),
      ).toEqual({ lastRunStatus: "interrupted" });
    });
  });

  it("resumes on the next future due time, never a passed one", () => {
    const order = recurringOrderFixture({
      schedule: { ...recurringOrderFixture().schedule, pausedAtSec: DUE - 1 },
    });
    expect(resumePatch(order, DUE - HOUR)).toEqual({
      pausedAtSec: null,
      nextDueAtSec: DUE,
    });
    expect(resumePatch(order, DUE + HOUR)).toEqual({
      pausedAtSec: null,
      nextDueAtSec: DUE + 6 * HOUR,
    });
  });
});
