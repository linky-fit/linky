import { describe, expect, it } from "vitest";
import { supportChatDays, type SupportMessage } from "./supportChat";

const at = (day: number, hour: number) =>
  new Date(2026, 9, day, hour).getTime() / 1000;

const message = (id: string, createdAtSec: number): SupportMessage => ({
  id,
  direction: "out",
  text: id,
  createdAtSec,
  status: "sent",
});

describe("support chat days", () => {
  it("splits messages by the local day they were written on, oldest first", () => {
    const days = supportChatDays([
      message("a", at(13, 9)),
      message("b", at(13, 23)),
      message("c", at(14, 0)),
    ]);
    expect(days).toEqual([
      {
        startSec: at(13, 0),
        messages: [message("a", at(13, 9)), message("b", at(13, 23))],
      },
      { startSec: at(14, 0), messages: [message("c", at(14, 0))] },
    ]);
  });
});
