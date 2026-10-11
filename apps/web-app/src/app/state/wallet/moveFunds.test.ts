// @vitest-environment jsdom
import {
  MintUnreachable,
  MintUrl,
  PaymentFailed,
  QuoteId,
} from "@linky-fit/linkshu";
import { Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  autoswapEstimateOf,
  autoswapReceiptOf,
  walletBalancesOf,
} from "../../../testUtils/walletFakes";
import type { LinkshuCommands } from "../linkshu/commands";
import { makeMoveFundsCommands, type MintMove } from "./moveFunds";
import { makeWalletOps } from "./opQueue";

const TARGET = "https://cashu.cz";
const FOREIGN_STORED = "https://Foreign.Example";

type FakeLinkshu = Pick<
  LinkshuCommands,
  | "autoswapCashu"
  | "estimateAutoswapCashu"
  | "readWalletBalances"
  | "resolveAutoswapSource"
>;

const setup = ({
  balances = { [TARGET]: 10, [FOREIGN_STORED]: 80 },
  defaultMint = TARGET,
  autoswapCashu = vi.fn<FakeLinkshu["autoswapCashu"]>(async (move) =>
    Result.succeed(autoswapReceiptOf(move)),
  ),
  resolveAutoswapSource = vi.fn<FakeLinkshu["resolveAutoswapSource"]>(
    async (mint) =>
      mint === "https://foreign.example" ? FOREIGN_STORED : mint,
  ),
}: {
  balances?: Record<string, number>;
  defaultMint?: string | null;
  autoswapCashu?: FakeLinkshu["autoswapCashu"];
  resolveAutoswapSource?: FakeLinkshu["resolveAutoswapSource"];
} = {}) => {
  const linkshu = {
    autoswapCashu: vi.fn(autoswapCashu),
    estimateAutoswapCashu: vi.fn<FakeLinkshu["estimateAutoswapCashu"]>(
      async (move) => Result.succeed(autoswapEstimateOf(move)),
    ),
    readWalletBalances: vi.fn(async () => walletBalancesOf(balances)),
    resolveAutoswapSource: vi.fn(resolveAutoswapSource),
  };
  const ops = makeWalletOps(() => {});
  const rememberSeenMint = vi.fn();
  const commands = makeMoveFundsCommands({
    allowTestMints: true,
    defaultMint,
    linkshu,
    ops,
    rememberSeenMint,
  });
  return { commands, linkshu, ops, rememberSeenMint };
};

const paymentFailedAt = (mint: string) =>
  new PaymentFailed({
    mint: MintUrl.make(mint),
    quoteId: QuoteId.make("quote"),
    detail: null,
  });

describe("estimateMintMove", () => {
  it("claims from the spelling the estimate priced, even after balances shift", async () => {
    const resolveAutoswapSource = vi
      .fn<FakeLinkshu["resolveAutoswapSource"]>()
      .mockResolvedValueOnce("https://Mint.Example.com")
      .mockResolvedValueOnce("https://MINT.example.com");
    const { commands, linkshu } = setup({ resolveAutoswapSource });
    const move: MintMove = {
      sourceMint: "https://mint.example.com",
      targetMint: TARGET,
    };

    const estimate = await commands.estimateMintMove(move);
    if (estimate._tag !== "Estimated") throw new Error("estimate failed");
    await commands.moveMintFunds({
      ...move,
      sourceMint: estimate.estimate.sourceMint,
    });

    expect(linkshu.resolveAutoswapSource).toHaveBeenCalledTimes(1);
    expect(linkshu.estimateAutoswapCashu).toHaveBeenCalledWith({
      ...move,
      sourceMint: "https://Mint.Example.com",
    });
    expect(linkshu.autoswapCashu).toHaveBeenCalledWith({
      ...move,
      sourceMint: "https://Mint.Example.com",
    });
  });

  it("reports a failed estimate with its detail", async () => {
    const { commands, linkshu } = setup();
    linkshu.estimateAutoswapCashu.mockRejectedValueOnce(new Error("offline"));

    expect(
      await commands.estimateMintMove({
        sourceMint: FOREIGN_STORED,
        targetMint: TARGET,
      }),
    ).toEqual({ _tag: "Failed", detail: "offline" });
  });
});

describe("moveMintFunds", () => {
  const move = { sourceMint: FOREIGN_STORED, targetMint: TARGET };

  it("moves once the queue admits it and remembers the target mint", async () => {
    const { commands, rememberSeenMint } = setup();
    const onStarted = vi.fn();

    const outcome = await commands.moveMintFunds(move, { onStarted });

    expect(outcome).toEqual({
      _tag: "Moved",
      receipt: autoswapReceiptOf(move),
    });
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(rememberSeenMint).toHaveBeenCalledWith(TARGET);
  });

  it("counts a melt that paid the target as moved, its claim pending", async () => {
    const { commands } = setup({
      autoswapCashu: async () => Result.fail(paymentFailedAt(TARGET)),
    });
    expect(await commands.moveMintFunds(move)).toEqual({
      _tag: "ClaimPending",
    });
  });

  it("fails on any other error", async () => {
    const { commands } = setup({
      autoswapCashu: async () =>
        Result.fail(paymentFailedAt("https://other.example")),
    });
    expect(await commands.moveMintFunds(move)).toEqual({
      _tag: "Failed",
      detail: expect.any(String),
    });
  });

  it("drops a move started while another wallet operation runs", async () => {
    const { commands, linkshu, ops } = setup();
    let finish = () => {};
    const running = ops.runQueuedTask(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );

    expect(await commands.moveMintFunds(move)).toEqual({ _tag: "Busy" });
    expect(linkshu.autoswapCashu).not.toHaveBeenCalled();
    finish();
    await running;
  });
});

describe("meltToDefaultMint", () => {
  it("sweeps the largest other mint under the spelling linkshu stored", async () => {
    const { commands, linkshu } = setup();

    expect(await commands.meltToDefaultMint()).toEqual({
      _tag: "Moved",
      movedAmount: 50,
      targetMint: TARGET,
    });
    expect(linkshu.resolveAutoswapSource).toHaveBeenCalledTimes(1);
    expect(linkshu.autoswapCashu).toHaveBeenCalledWith({
      sourceMint: FOREIGN_STORED,
      targetMint: TARGET,
    });
  });

  it("reports the swept balance while the claim is pending", async () => {
    const { commands } = setup({
      autoswapCashu: async () => Result.fail(paymentFailedAt(TARGET)),
    });
    expect(await commands.meltToDefaultMint()).toEqual({
      _tag: "ClaimPending",
      amount: 80,
    });
  });

  it("is unavailable while no other mint holds funds", async () => {
    const { commands, linkshu } = setup({ balances: { [TARGET]: 10 } });
    expect(await commands.meltToDefaultMint()).toEqual({
      _tag: "Unavailable",
    });
    expect(linkshu.autoswapCashu).not.toHaveBeenCalled();
  });

  it("refuses a default mint without a url", async () => {
    const { commands } = setup({ defaultMint: " " });
    expect(await commands.meltToDefaultMint()).toEqual({
      _tag: "InvalidTarget",
    });
  });

  it("fails with the claim's error", async () => {
    const { commands } = setup({
      autoswapCashu: async () =>
        Result.fail(
          new MintUnreachable({
            mint: MintUrl.make(FOREIGN_STORED),
            detail: "offline",
          }),
        ),
    });
    expect(await commands.meltToDefaultMint()).toEqual({
      _tag: "Failed",
      detail: expect.any(String),
    });
  });
});
