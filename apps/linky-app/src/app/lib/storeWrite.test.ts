import { ShardDbError } from "@linky-fit/linksync";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { runWrite } from "./storeWrite";

describe("runWrite", () => {
  it("reports success and turns a failure into status text", async () => {
    expect(await runWrite(Effect.void)).toEqual({ ok: true });
    expect(
      await runWrite(
        Effect.fail(
          new ShardDbError({ table: "contact", message: "rejected" }),
        ),
      ),
    ).toEqual({ ok: false, error: expect.stringContaining("rejected") });
    expect(await runWrite(Effect.fail("quota exceeded"))).toEqual({
      ok: false,
      error: "quota exceeded",
    });
  });
});
