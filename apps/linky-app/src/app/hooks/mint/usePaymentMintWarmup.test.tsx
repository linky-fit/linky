import { MintBalance, MintUrl, NonNegativeAmount } from "@linky-fit/linkshu";
import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { memoryKvPorts } from "../../../testUtils/appRegistry";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type { Route } from "../../../types/route";
import type { WarmCashuMint } from "../../state/linkshu/commands";
import { platformAtom } from "../../state/platform";
import { scanIsOpenAtom } from "../../state/shell/scan";
import { usePaymentMintWarmup } from "./usePaymentMintWarmup";

const MINT_A = MintUrl.make("https://mint-a.example");
const MINT_B = MintUrl.make("https://mint-b.example");
const MINT_EMPTY = MintUrl.make("https://mint-empty.example");

const balance = (mint: MintUrl, amount: number): MintBalance =>
  new MintBalance({ mint, amount: NonNegativeAmount.make(amount) });

interface HarnessProps {
  readonly mintBalances: ReadonlyArray<MintBalance>;
  readonly routeKind: Route["kind"];
  readonly warmCashuMint: WarmCashuMint | null;
}

const Harness = (props: HarnessProps): null => {
  usePaymentMintWarmup(props);
  return null;
};

const mount = async (options: {
  mintBalances: ReadonlyArray<MintBalance>;
  routeKind: Route["kind"];
  scanIsOpen?: boolean;
  online?: boolean;
  warmCashuMint?: WarmCashuMint | null;
}) => {
  const { ports } = memoryKvPorts();
  const platform =
    options.online === false
      ? { ...ports, lifecycle: { ...ports.lifecycle, isOnline: () => false } }
      : ports;
  const registry = AtomRegistry.make({
    initialValues: [
      [platformAtom, platform],
      [scanIsOpenAtom, options.scanIsOpen ?? false],
    ],
  });
  const warmCashuMint =
    options.warmCashuMint === undefined
      ? vi.fn<WarmCashuMint>(() => Promise.resolve())
      : options.warmCashuMint;
  const view = await renderIntoDocument(
    <RegistryContext.Provider value={registry}>
      <Harness
        mintBalances={options.mintBalances}
        routeKind={options.routeKind}
        warmCashuMint={warmCashuMint}
      />
    </RegistryContext.Provider>,
  );
  return { registry, view, warmCashuMint };
};

describe("usePaymentMintWarmup", () => {
  it.each<Route["kind"]>(["chat", "contacts", "wallet", "settings"])(
    "sends zero warm-up calls on %s when scanner is closed",
    async (routeKind) => {
      const { warmCashuMint } = await mount({
        mintBalances: [balance(MINT_A, 100)],
        routeKind,
        scanIsOpen: false,
      });

      expect(warmCashuMint).not.toHaveBeenCalled();
    },
  );

  it.each<Route["kind"]>([
    "manualPay",
    "contactPay",
    "lnAddressPay",
    "lnInvoicePay",
    "cashuTokenEmit",
  ])("warms only funded mints on %s", async (routeKind) => {
    const { warmCashuMint } = await mount({
      mintBalances: [
        balance(MINT_A, 50),
        balance(MINT_EMPTY, 0),
        balance(MINT_B, 1),
      ],
      routeKind,
    });

    expect(warmCashuMint).toHaveBeenCalledTimes(2);
    expect(warmCashuMint).toHaveBeenCalledWith(MINT_A);
    expect(warmCashuMint).toHaveBeenCalledWith(MINT_B);
    expect(warmCashuMint).not.toHaveBeenCalledWith(MINT_EMPTY);
  });

  it("warms funded mints when the QR scanner opens from a non-payment route", async () => {
    const { registry, warmCashuMint } = await mount({
      mintBalances: [balance(MINT_A, 100), balance(MINT_EMPTY, 0)],
      routeKind: "chat",
      scanIsOpen: false,
    });

    expect(warmCashuMint).not.toHaveBeenCalled();

    await act(async () => {
      registry.set(scanIsOpenAtom, true);
    });

    expect(warmCashuMint).toHaveBeenCalledTimes(1);
    expect(warmCashuMint).toHaveBeenCalledWith(MINT_A);
  });

  it("skips warm-up while offline", async () => {
    const { warmCashuMint } = await mount({
      mintBalances: [balance(MINT_A, 100)],
      routeKind: "manualPay",
      online: false,
    });

    expect(warmCashuMint).not.toHaveBeenCalled();
  });

  it("swallows warm-up errors without surfacing them", async () => {
    const warmCashuMint = vi.fn<WarmCashuMint>(() =>
      Promise.reject(new Error("boom")),
    );

    await expect(
      mount({
        mintBalances: [balance(MINT_A, 100)],
        routeKind: "manualPay",
        warmCashuMint,
      }),
    ).resolves.toBeDefined();
    expect(warmCashuMint).toHaveBeenCalledWith(MINT_A);
  });
});
