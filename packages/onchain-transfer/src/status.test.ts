import {
  canOperatorMove,
  isTerminalStatus,
  OperatorTransferStatus,
} from "./status";

const statuses = OperatorTransferStatus.literals;

const allowed: ReadonlyArray<
  readonly [OperatorTransferStatus | null, OperatorTransferStatus]
> = [
  [null, "accepted"],
  [null, "denied"],
  [null, "cancelled"],
  ["accepted", "fundsSeen"],
  ["accepted", "fundsReceived"],
  ["accepted", "cancelled"],
  ["fundsSeen", "fundsSeen"],
  ["fundsSeen", "fundsReceived"],
  ["fundsSeen", "cancelled"],
  ["fundsSeen", "refunded"],
  ["fundsReceived", "completed"],
  ["fundsReceived", "refunded"],
];

describe("operator status moves", () => {
  for (const from of [null, ...statuses]) {
    for (const to of statuses) {
      const expected = allowed.some(([f, t]) => f === from && t === to);
      it(`${from ?? "none"} -> ${to} is ${expected ? "allowed" : "forbidden"}`, () => {
        expect(canOperatorMove(from, to)).toBe(expected);
      });
    }
  }

  it("ends at denied, completed, cancelled and refunded", () => {
    expect(statuses.filter(isTerminalStatus)).toEqual([
      "denied",
      "completed",
      "cancelled",
      "refunded",
    ]);
  });
});
