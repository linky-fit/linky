import { encodeNsec } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import {
  activeNostrIdentityId,
  NonEmptyString1000,
  OwnerId,
  type NostrIdentityRow,
} from "@linky-fit/linksync";
import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  signedInSession,
  testPlatformPorts,
} from "../../../testUtils/appRegistry";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { platformAtom } from "../../state/platform";
import { sessionAtom } from "../../state/session/session";
import { useIdentityOwnersComposition } from "./useIdentityOwnersComposition";

const mocks = vi.hoisted(() => {
  const synced: { row: NostrIdentityRow | null } = { row: null };
  return { calls: new Array<string>(), synced };
});

vi.mock("../useLinksync", () => ({
  useAppOwnerId: () => "owner-1",
  useIdentityRepository: () => null,
  useInboxCursorsRepository: () => null,
  useSyncedNostrIdentityRow: () => mocks.synced.row,
}));
vi.mock("../useProfileAuthDomain", () => ({
  useProfileAuthDomain: () => ({}),
}));
vi.mock("../shell/ownerCommands", () => ({
  useProvideOwnerCommands: () => {},
}));
vi.mock("../../lib/beaconStore", () => ({
  stopBeaconForIdentityChange: () => mocks.calls.push("stopBeacon"),
}));
vi.mock("../../../platform/identitySecrets", () => ({
  persistSyncedActiveNostrIdentity: async () => {
    mocks.calls.push("persistIdentity");
  },
}));

const localNsec = encodeNsec(makeIdentity().secretKey);
const syncedNsec = encodeNsec(makeIdentity().secretKey);

const mount = async () => {
  const registry = AtomRegistry.make({
    initialValues: [
      [
        platformAtom,
        testPlatformPorts({
          lifecycle: {
            ...testPlatformPorts().lifecycle,
            reload: () => mocks.calls.push("reload"),
          },
        }),
      ],
      [sessionAtom, signedInSession({ nsec: localNsec })],
    ],
  });
  const Harness = () => {
    useIdentityOwnersComposition({
      currentNsec: localNsec,
      lang: "en",
      pushToast: () => {},
      t: (key) => key,
    });
    return null;
  };
  const { unmount } = await renderIntoDocument(
    <RegistryContext.Provider value={registry}>
      <Harness />
    </RegistryContext.Provider>,
  );
  await act(async () => {});
  await unmount();
};

describe("an identity switch synced from another device", () => {
  it("stops the beacon before reloading into the synced identity", async () => {
    mocks.calls.length = 0;
    mocks.synced.row = {
      id: activeNostrIdentityId,
      nsec: NonEmptyString1000.orThrow(syncedNsec),
      npub: null,
      source: null,
      switchedAtSec: null,
      ownerId: OwnerId.orThrow("AAAAAAAAAAAAAAAAAAAAAA"),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      isDeleted: null,
    };

    await mount();

    expect(mocks.calls).toEqual(["stopBeacon", "persistIdentity", "reload"]);
  });

  it("leaves the beacon alone while the synced identity matches", async () => {
    mocks.calls.length = 0;
    mocks.synced.row = null;

    await mount();

    expect(mocks.calls).toEqual([]);
  });
});
