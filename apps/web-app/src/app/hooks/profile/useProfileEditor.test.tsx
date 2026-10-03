import { ProfileMetadata } from "@linky-fit/linkstr";
import { act, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { useProfileEditor } from "./useProfileEditor";

vi.mock("@linky-fit/linkstr-react", () => ({
  publishProfileAtom: {},
  publishStatusAtom: {},
  useAtomSet: () => vi.fn(),
}));

describe("profile address claim validation", () => {
  let unmount: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await unmount?.();
  });

  const setup = async (lightningAddress: string) => {
    const editor: { current: ReturnType<typeof useProfileEditor> | null } = {
      current: null,
    };
    const Probe = () => {
      const value = useProfileEditor({
        currentNpub: "npub1current",
        currentNsec: "nsec1custom",
        defaultLightningAddress: "npub1current@linky.fit",
        effectiveMyLightningAddress: lightningAddress,
        effectiveProfileName: "Alice",
        effectiveProfilePicture: null,
        myProfileMetadata: new ProfileMetadata({ lud16: lightningAddress }),
        myProfileStatus: null,
        ownedLightningAddresses: [],
        ownedLightningAddressesLoading: false,
        setMyProfileLnAddress: vi.fn(),
        setMyProfileMetadata: vi.fn(),
        setMyProfileName: vi.fn(),
        setMyProfilePicture: vi.fn(),
        setMyProfileStatus: vi.fn(),
        setStatus: vi.fn(),
        t: (key) => key,
      });
      useEffect(() => {
        editor.current = value;
      }, [value]);
      return null;
    };
    ({ unmount } = await renderIntoDocument(<Probe />));
    await act(async () => editor.current?.toggleProfileEditing());
    return editor;
  };

  it.each(["npub1previous@linky.fit", "alice@linky.fit"])(
    "allows other profile edits while keeping the existing address %s",
    async (address) => {
      const editor = await setup(address);
      await act(async () => editor.current?.setProfileEditName("New name"));
      expect(editor.current?.profileEditsSavable).toBe(true);
      expect(editor.current?.unregisteredOwnLightningAddress).toBeNull();
    },
  );

  it("requires a claim only while the address differs from the existing one", async () => {
    const editor = await setup("alice@linky.fit");
    await act(async () => editor.current?.setProfileEditLnAddress("bob"));
    expect(
      editor.current?.unregisteredOwnLightningAddress?.lightningAddress,
    ).toBe("bob@linky.fit");
    await act(async () =>
      editor.current?.setProfileEditLnAddress(" Alice@LINKY.FIT "),
    );
    expect(editor.current?.unregisteredOwnLightningAddress).toBeNull();
  });
});
