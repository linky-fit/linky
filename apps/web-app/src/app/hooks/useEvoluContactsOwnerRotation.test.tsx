import * as Evolu from "@evolu/common";
import { act, useLayoutEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { safeLocalStorageSet } from "../../utils/storage";
import { EVOLU_MESSAGES_OWNER_LAST_ROTATED_AT_MS_STORAGE_KEY } from "../../utils/constants";
import { useOwnerLane } from "./useEvoluContactsOwnerRotation";

vi.mock("../../evolu", () => ({ evolu: {} }));
vi.mock("../../devtools/inspector/appLog", () => ({ reportAppLog: vi.fn() }));
vi.mock("../../utils/slip39Nostr", () => ({
  deriveEvoluOwnerMnemonicFromSlip39: async (
    _seed: string,
    _scope: string,
    index: number,
  ) =>
    Evolu.ownerSecretToMnemonic(
      Evolu.OwnerSecret.orThrow(new Uint8Array(32).fill(index + 1)),
    ),
}));

type Params = Parameters<typeof useOwnerLane>[0];
type Lane = ReturnType<typeof useOwnerLane>;
const metaOwner = Evolu.createAppOwner(
  Evolu.OwnerSecret.orThrow(new Uint8Array(32).fill(99)),
);
const makeParams = (): Params => ({
  scope: "messages",
  appOwnerId: null,
  isSeedLogin: true,
  slip39Seed: "seed",
  pushToast: vi.fn(),
  t: (key) => key,
  upsert: vi.fn<Params["upsert"]>().mockReturnValue({
    ok: true,
    value: { id: Evolu.createIdFromString<"OwnerMeta">("meta") },
  }),
  metaOwner,
  snapshot: null,
  rows: [],
  historyCount: 0,
  allowMissingOwnerMetaBootstrap: false,
});
const mountLane = async (initial: Params) => {
  let latest: Lane | undefined;
  const Probe = ({ params }: { params: Params }) => {
    const lane = useOwnerLane(params);
    useLayoutEffect(() => {
      latest = lane;
    }, [lane]);
    return null;
  };
  const view = await renderIntoDocument(<Probe params={initial} />);
  return {
    ...view,
    lane: () => {
      if (!latest) throw new Error("Lane has not rendered");
      return latest;
    },
    update: (params: Params) => view.rerender(<Probe params={params} />),
  };
};
beforeEach(() => {
  localStorage.clear();
});

describe("owner lanes", () => {
  it("keeps the locally rotated target while an older snapshot is still visible", async () => {
    const params = makeParams();
    const view = await mountLane(params);
    const previousOwner = view.lane().ownerId;
    await act(async () => {
      await view.lane().requestManualRotate();
    });
    expect(view.lane().index).toBe(1);
    expect(view.lane().ownerId).not.toBe(previousOwner);
    const rotatedOwner = view.lane().ownerId;
    await view.update({
      ...params,
      snapshot: { index: 0, baseline: 0, cashuBaseline: null, rotatedAtMs: 1 },
    });
    expect(view.lane().index).toBe(1);
    expect(view.lane().ownerId).toBe(rotatedOwner);
    expect(view.lane().visibleOwnerIds).toContain(previousOwner);
    await view.update({
      ...params,
      snapshot: {
        index: 1,
        baseline: 0,
        cashuBaseline: null,
        rotatedAtMs: Date.now(),
      },
    });
    expect(view.lane().index).toBe(1);
    await view.unmount();
  });
  it("uses mutation history even when live rows are empty and blocks concurrent rotations", async () => {
    const params = { ...makeParams(), historyCount: 160 };
    const view = await mountLane(params);
    expect(view.lane().index).toBe(1);
    expect(params.upsert).toHaveBeenCalledTimes(1);
    expect(view.lane().editCount).toBe(160);
    safeLocalStorageSet(
      EVOLU_MESSAGES_OWNER_LAST_ROTATED_AT_MS_STORAGE_KEY,
      "0",
    );
    await act(async () => {
      await Promise.all([
        view.lane().requestManualRotate(),
        view.lane().requestManualRotate(),
      ]);
    });
    expect(view.lane().index).toBe(2);
    expect(params.upsert).toHaveBeenCalledTimes(2);
    await view.unmount();
  });
  it("leaves the write lane unchanged when its pointer write is rejected", async () => {
    const params = makeParams();
    params.upsert = vi
      .fn<Params["upsert"]>()
      .mockReturnValue({ ok: false, error: "write rejected" });
    const view = await mountLane(params);
    const ownerId = view.lane().ownerId;
    await act(async () => {
      await view.lane().requestManualRotate();
    });
    expect(view.lane().index).toBe(0);
    expect(view.lane().ownerId).toBe(ownerId);
    expect(view.lane().isBusy).toBe(false);
    expect(params.pushToast).toHaveBeenCalledWith(
      "errorPrefix: write rejected",
    );
    await view.unmount();
  });
});
