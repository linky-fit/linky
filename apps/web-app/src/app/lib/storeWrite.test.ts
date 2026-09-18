import { ShardDbError } from "@linky/linksync";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { runWrite } from "./storeWrite";

describe("runWrite", () => {
  it("reports success and turns a failure into status text", async () => {
    expect(await runWrite(Effect.void)).toEqual({ ok: true });
    const failed = await runWrite(
      Effect.fail(new ShardDbError({ table: "contact", message: "rejected" })),
    );
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).toContain("rejected");
  });
});
