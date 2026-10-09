import { ProfileMetadata } from "@linky-fit/linkstr";
import { Exit } from "effect";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { useNpubNip05Cleanup } from "./useNpubNip05Cleanup";

const NPUB = "npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8";

const mocks = vi.hoisted(() => ({
  fetchProfile: vi.fn(),
  publishProfile: vi.fn(),
  reportAppLog: vi.fn(),
  saveCachedProfile: vi.fn(),
  setMyProfileMetadata: vi.fn(),
}));

vi.mock("@linky-fit/linkstr-react", () => {
  const fetchProfileAtom = {};
  return {
    fetchProfileAtom,
    publishProfileAtom: {},
    useAtomSet: (atom: unknown) =>
      atom === fetchProfileAtom ? mocks.fetchProfile : mocks.publishProfile,
  };
});

vi.mock("../../../hooks/useDeferredOnlineReady", () => ({
  useDeferredOnlineReady: () => true,
}));

vi.mock("../../../profileCache", () => ({
  loadCachedProfile: () => null,
  saveCachedProfile: mocks.saveCachedProfile,
}));

vi.mock("../../../devtools/inspector/appLog", () => ({
  reportAppLog: mocks.reportAppLog,
}));

const relayProfile = (metadata: ProfileMetadata) =>
  Exit.succeed({ profile: { metadata, updatedAt: 100 }, status: null });

const Probe = ({ enabled }: { enabled: boolean }) => {
  useNpubNip05Cleanup({
    currentNpub: NPUB,
    enabled,
    setMyProfileMetadata: mocks.setMyProfileMetadata,
  });
  return null;
};

const flush = () => act(async () => {});

describe("useNpubNip05Cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.publishProfile.mockResolvedValue(
      Exit.succeed({ eventId: "event-1" }),
    );
  });

  it("republishes the relay profile without its npub nip05, once per session", async () => {
    mocks.fetchProfile.mockResolvedValue(
      relayProfile(
        new ProfileMetadata({
          name: "Alice",
          lud16: `${NPUB}@linky.fit`,
          nip05: `${NPUB}@linky.fit`,
        }),
      ),
    );
    const cleaned = new ProfileMetadata({
      name: "Alice",
      lud16: `${NPUB}@linky.fit`,
    });

    const view = await renderIntoDocument(<Probe enabled={false} />);
    await flush();
    expect(mocks.fetchProfile).not.toHaveBeenCalled();

    await view.rerender(<Probe enabled />);
    await flush();
    await view.rerender(<Probe enabled={false} />);
    await view.rerender(<Probe enabled />);
    await flush();

    expect(mocks.fetchProfile).toHaveBeenCalledTimes(1);
    expect(mocks.publishProfile).toHaveBeenCalledTimes(1);
    expect(mocks.publishProfile).toHaveBeenCalledWith(cleaned);
    expect(mocks.saveCachedProfile).toHaveBeenCalledWith(
      NPUB,
      cleaned,
      expect.any(Number),
    );
    expect(mocks.setMyProfileMetadata).toHaveBeenCalledWith(cleaned);
    expect(mocks.reportAppLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: "profile.npubNip05Dropped",
        links: { wrap: ["event-1"] },
      }),
    );
    await view.unmount();
  });

  it("leaves a bought-name handle alone", async () => {
    mocks.fetchProfile.mockResolvedValue(
      relayProfile(
        new ProfileMetadata({
          lud16: "hynek@linky.fit",
          nip05: "hynek@linky.fit",
        }),
      ),
    );

    const view = await renderIntoDocument(<Probe enabled />);
    await flush();

    expect(mocks.fetchProfile).toHaveBeenCalledTimes(1);
    expect(mocks.publishProfile).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("publishes nothing when the relay fetch fails", async () => {
    mocks.fetchProfile.mockResolvedValue(Exit.fail("unreachable"));

    const view = await renderIntoDocument(<Probe enabled />);
    await flush();

    expect(mocks.publishProfile).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("keeps local state when the publish fails", async () => {
    mocks.fetchProfile.mockResolvedValue(
      relayProfile(new ProfileMetadata({ nip05: `${NPUB}@linky.fit` })),
    );
    mocks.publishProfile.mockResolvedValue(Exit.fail("rejected"));

    const view = await renderIntoDocument(<Probe enabled />);
    await flush();

    expect(mocks.publishProfile).toHaveBeenCalledTimes(1);
    expect(mocks.setMyProfileMetadata).not.toHaveBeenCalled();
    expect(mocks.reportAppLog).not.toHaveBeenCalled();
    await view.unmount();
  });
});
