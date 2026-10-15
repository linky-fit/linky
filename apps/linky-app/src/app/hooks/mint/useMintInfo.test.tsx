import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import {
  MintInfo,
  MintUnreachable,
  MintUrl,
  type MintRejected,
} from "@linky-fit/linkshu";
import { Result } from "effect";
import { AsyncResult } from "effect/reactivity";
import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { memoryKvPorts } from "../../../testUtils/appRegistry";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { LOCAL_MINT_INFO_STORAGE_KEY_PREFIX } from "../../../utils/constants";
import {
  linkshuCommandsAtom,
  type FetchMintInfo,
  type LinkshuCommands,
} from "../../state/linkshu/commands";
import { platformAtom } from "../../state/platform";
import { appOwnerIdAtom } from "../../state/session/store";
import { mintInfoRowsAtom } from "../../state/wallet/mintInfo";
import {
  useDeleteMint,
  useMintRuntime,
  useRefreshMintInfo,
  useTouchMintInfo,
} from "./useMintInfo";

const MINT = "https://cashu.example";
const STORAGE_KEY = `${LOCAL_MINT_INFO_STORAGE_KEY_PREFIX}.owner-1`;

interface Hooks {
  deleteMint: ReturnType<typeof useDeleteMint>;
  getMintRuntime: ReturnType<typeof useMintRuntime>;
  refreshMintInfo: ReturnType<typeof useRefreshMintInfo>;
  touchMintInfo: ReturnType<typeof useTouchMintInfo>;
}

const mount = async (
  fetchMintInfo: FetchMintInfo,
  initial: Record<string, string> = {},
) => {
  const { items, ports } = memoryKvPorts(initial);
  const commands: Pick<LinkshuCommands, "fetchMintInfo"> = { fetchMintInfo };
  const registry = AtomRegistry.make({
    initialValues: [
      [platformAtom, ports],
      [appOwnerIdAtom, AsyncResult.success("owner-1")],
      [linkshuCommandsAtom, AsyncResult.success(commands)],
    ],
  });
  const hooksRef: { current: Hooks | null } = { current: null };
  const Harness = (): null => {
    const hooks: Hooks = {
      deleteMint: useDeleteMint(),
      getMintRuntime: useMintRuntime(),
      refreshMintInfo: useRefreshMintInfo(),
      touchMintInfo: useTouchMintInfo(),
    };
    React.useEffect(() => {
      hooksRef.current = hooks;
    });
    return null;
  };
  await renderIntoDocument(
    <RegistryContext.Provider value={registry}>
      <Harness />
    </RegistryContext.Provider>,
  );
  const current = (): Hooks => {
    if (hooksRef.current === null) throw new Error("hooks not mounted");
    return hooksRef.current;
  };
  const storedRows = (): Array<Record<string, unknown>> =>
    JSON.parse(items.get(STORAGE_KEY) ?? "[]");
  return { current, registry, storedRows };
};

const reachableMint = () =>
  vi.fn<FetchMintInfo>(() =>
    Promise.resolve(
      Result.succeed(
        new MintInfo({
          url: MintUrl.make(MINT),
          name: "Cashu example",
          inputFeePpk: 100,
          supportsMpp: true,
          supportsP2pk: false,
          isFakeLightning: false,
          iconUrl: `${MINT}/icon.png`,
        }),
      ),
    ),
  );

describe("mint info", () => {
  it("stores linkshu's mint info in the cached row and measures latency", async () => {
    const fetchMintInfo = reachableMint();
    const { current, storedRows } = await mount(fetchMintInfo);

    await act(() => current().refreshMintInfo(`${MINT}/`));

    expect(fetchMintInfo).toHaveBeenCalledWith(MINT);
    expect(storedRows().find((row) => row.url === MINT)).toEqual({
      id: expect.any(String),
      url: MINT,
      firstSeenAtSec: expect.any(Number),
      lastSeenAtSec: expect.any(Number),
      lastCheckedAtSec: expect.any(Number),
      supportsMpp: "1",
      feesJson: '{"ppk":100}',
      infoJson: `{"name":"Cashu example","icon_url":"${MINT}/icon.png"}`,
    });
    expect(current().getMintRuntime(MINT)?.latencyMs).toEqual(
      expect.any(Number),
    );
  });

  it("records an unknown latency and stores nothing when the mint fails", async () => {
    const { current, storedRows } = await mount(() =>
      Promise.resolve(
        Result.fail<MintUnreachable | MintRejected>(
          new MintUnreachable({ mint: MintUrl.make(MINT), detail: null }),
        ),
      ),
    );

    await act(() => current().refreshMintInfo(MINT));

    expect(storedRows().some((row) => row.url === MINT)).toBe(false);
    expect(current().getMintRuntime(MINT)).toEqual({
      lastCheckedAtSec: expect.any(Number),
      latencyMs: null,
    });
  });

  it("starts from the owner's stored rows and stores a touch only when it changes them", async () => {
    const stored = [
      { id: "row-1", url: MINT, firstSeenAtSec: 10, lastSeenAtSec: 20 },
    ];
    const { current, registry, storedRows } = await mount(reachableMint(), {
      [STORAGE_KEY]: JSON.stringify(stored),
    });
    expect(registry.get(mintInfoRowsAtom)).toEqual(stored);

    await act(async () => current().touchMintInfo(MINT, 20));
    expect(storedRows()).toEqual(stored);

    await act(async () => current().touchMintInfo(MINT, 30));
    expect(storedRows()).toEqual([{ ...stored[0], lastSeenAtSec: 30 }]);
  });

  it("keeps a deleted mint deleted: no touch and no refresh revive it", async () => {
    const fetchMintInfo = reachableMint();
    const { current, storedRows } = await mount(fetchMintInfo);
    await act(async () => current().touchMintInfo(MINT, 30));

    await act(async () => current().deleteMint(`${MINT}/`));
    await act(async () => current().touchMintInfo(MINT, 40));
    await act(() => current().refreshMintInfo(MINT));

    expect(fetchMintInfo).not.toHaveBeenCalled();
    expect(storedRows()).toEqual([
      expect.objectContaining({ url: MINT, isDeleted: 1, lastSeenAtSec: 30 }),
    ]);
  });
});
