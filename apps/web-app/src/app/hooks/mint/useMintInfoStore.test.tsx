import {
  MintInfo,
  MintUnreachable,
  MintUrl,
  type MintRejected,
} from "@linky-fit/linkshu";
import { Result } from "effect";
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { LOCAL_MINT_INFO_STORAGE_KEY_PREFIX } from "../../../utils/constants";
import type { FetchMintInfo } from "../../state/linkshu/commands";
import { useMintInfoStore } from "./useMintInfoStore";

const MINT = "https://cashu.example";
const STORAGE_KEY = `${LOCAL_MINT_INFO_STORAGE_KEY_PREFIX}.owner-1`;

type Store = ReturnType<typeof useMintInfoStore>;

const Harness = ({
  fetchMintInfo,
  storeRef,
}: {
  fetchMintInfo: FetchMintInfo;
  storeRef: React.RefObject<Store | null>;
}): null => {
  const appOwnerIdRef = React.useRef<string | null>("owner-1");
  const store = useMintInfoStore({
    allowTestMints: true,
    appOwnerId: "owner-1",
    appOwnerIdRef,
    walletProofs: [],
    defaultMintUrl: null,
    fetchMintInfo,
    rememberSeenMint: () => {},
  });
  React.useEffect(() => {
    storeRef.current = store;
  }, [store, storeRef]);
  return null;
};

const mount = async (fetchMintInfo: FetchMintInfo) => {
  const storeRef: React.RefObject<Store | null> = { current: null };
  await renderIntoDocument(
    <Harness fetchMintInfo={fetchMintInfo} storeRef={storeRef} />,
  );
  const current = (): Store => {
    if (storeRef.current === null) throw new Error("store not mounted");
    return storeRef.current;
  };
  return { current };
};

const storedRows = (): Array<Record<string, unknown>> =>
  JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");

afterEach(() => localStorage.clear());

describe("useMintInfoStore refresh", () => {
  it("stores linkshu's mint info in the cached row and measures latency", async () => {
    const fetchMintInfo = vi.fn<FetchMintInfo>(() =>
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
    const store = await mount(fetchMintInfo);

    await act(() => store.current().refreshMintInfo(`${MINT}/`));

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
    expect(store.current().getMintRuntime(MINT)?.latencyMs).toEqual(
      expect.any(Number),
    );
  });

  it("records an unknown latency and stores nothing when the mint fails", async () => {
    const store = await mount(() =>
      Promise.resolve(
        Result.fail<MintUnreachable | MintRejected>(
          new MintUnreachable({ mint: MintUrl.make(MINT), detail: null }),
        ),
      ),
    );

    await act(() => store.current().refreshMintInfo(MINT));

    expect(storedRows().some((row) => row.url === MINT)).toBe(false);
    expect(store.current().getMintRuntime(MINT)).toEqual({
      lastCheckedAtSec: expect.any(Number),
      latencyMs: null,
    });
  });
});
