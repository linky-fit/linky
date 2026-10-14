import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { makeLinkshuRuntime } from "./runtimes";
import { setup } from "./testing/fakes";
import { createWallet } from "./wallet";

describe("wallet", () => {
  it("holds a new release's reload back while an operation runs", async () => {
    const { account, repositories } = setup();
    const held: object[] = [];
    const wallet = createWallet(
      makeLinkshuRuntime({
        cashuSeed: account.cashuSeed,
        wallet: repositories.wallet,
      }),
      account.secretKey,
      <A>(work: Promise<A>) => {
        held.push(work);
        return work;
      },
    );

    const running = wallet.run(Effect.succeed(1));

    expect(held).toEqual([running]);
    expect(await running).toEqual(Result.succeed(1));
  });
});
