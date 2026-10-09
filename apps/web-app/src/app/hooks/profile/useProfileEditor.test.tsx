import { ProfileMetadata } from "@linky-fit/linkstr";
import { Exit } from "effect";
import { act, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { useProfileEditor } from "./useProfileEditor";

const mocks = vi.hoisted(() => ({
  publishProfile: vi.fn(),
  publishStatus: vi.fn(),
  prepareProfilePicture: vi.fn(),
  setMyProfilePicture: vi.fn(),
  setStatus: vi.fn(),
}));

vi.mock("@linky-fit/linkstr-react", () => {
  const publishProfileAtom = {};
  return {
    publishProfileAtom,
    publishStatusAtom: {},
    useAtomSet: (atom: unknown) =>
      atom === publishProfileAtom ? mocks.publishProfile : mocks.publishStatus,
  };
});

vi.mock("../../lib/profilePicture", () => ({
  prepareProfilePicture: mocks.prepareProfilePicture,
}));

vi.mock("../../../profileCache", () => ({
  cacheProfileAvatarFromUrl: vi.fn(),
  deleteCachedProfileAvatar: vi.fn(),
  loadCachedProfile: vi.fn(),
  saveCachedProfile: vi.fn(),
  saveCachedStatus: vi.fn(),
}));

describe("profile editor", () => {
  let unmount: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await unmount?.();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.publishProfile.mockResolvedValue(Exit.succeed(undefined));
    mocks.publishStatus.mockResolvedValue(Exit.succeed(undefined));
    mocks.prepareProfilePicture.mockResolvedValue(
      "https://blossom.primal.net/photo.jpg",
    );
  });

  const setup = async (
    lightningAddress: string,
    myProfileMetadata = new ProfileMetadata({ lud16: lightningAddress }),
  ) => {
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
        myProfileMetadata,
        myProfileStatus: null,
        ownedLightningAddresses: [],
        ownedLightningAddressesLoading: false,
        setMyProfileLnAddress: vi.fn(),
        setMyProfileMetadata: vi.fn(),
        setMyProfileName: vi.fn(),
        setMyProfilePicture: mocks.setMyProfilePicture,
        setMyProfileStatus: vi.fn(),
        setStatus: mocks.setStatus,
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

  it("publishes and stores the uploaded photo URL instead of the local preview", async () => {
    const editor = await setup("alice@linky.fit");
    const preview = "data:image/jpeg;base64,YXZhdGFy";
    await act(async () => editor.current?.onProfilePhotoSelected(preview));
    await act(async () => editor.current?.saveProfileEdits());

    expect(mocks.prepareProfilePicture).toHaveBeenCalledWith(
      preview,
      "nsec1custom",
    );
    expect(mocks.publishProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        picture: "https://blossom.primal.net/photo.jpg",
      }),
    );
    expect(mocks.setMyProfilePicture).toHaveBeenCalledWith(
      "https://blossom.primal.net/photo.jpg",
    );
  });

  it("keeps the published profile and edit open when the photo upload fails", async () => {
    const editor = await setup("alice@linky.fit");
    mocks.prepareProfilePicture.mockRejectedValueOnce(
      new Error("upload-failed:503"),
    );
    await act(async () =>
      editor.current?.onProfilePhotoSelected("data:image/jpeg;base64,YXZhdGFy"),
    );
    await act(async () => editor.current?.saveProfileEdits());

    expect(mocks.publishProfile).not.toHaveBeenCalled();
    expect(mocks.publishStatus).not.toHaveBeenCalled();
    expect(mocks.setMyProfilePicture).not.toHaveBeenCalled();
    expect(editor.current?.isProfileEditing).toBe(true);
    expect(mocks.setStatus).toHaveBeenCalledWith(
      expect.stringContaining("upload-failed:503"),
    );
  });

  it("reports the save in flight and turns a second tap away until it settles", async () => {
    let finishStatusPublish!: (exit: Exit.Exit<unknown>) => void;
    mocks.publishStatus.mockImplementationOnce(
      () =>
        new Promise<Exit.Exit<unknown>>((resolve) => {
          finishStatusPublish = resolve;
        }),
    );
    const editor = await setup("alice@linky.fit");
    await act(async () => editor.current?.setProfileEditName("New name"));
    expect(editor.current?.profileIsSaving).toBe(false);

    let firstSave: Promise<void> | undefined;
    await act(async () => {
      firstSave = editor.current?.saveProfileEdits();
    });
    expect(editor.current?.profileIsSaving).toBe(true);

    await act(async () => editor.current?.saveProfileEdits());
    expect(mocks.publishStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishStatusPublish(Exit.succeed(undefined));
      await firstSave;
    });
    expect(editor.current?.profileIsSaving).toBe(false);
    expect(mocks.publishStatus).toHaveBeenCalledTimes(1);
    expect(mocks.publishProfile).toHaveBeenCalledTimes(1);
  });

  it("keeps fields it does not edit, including ones set in other apps", async () => {
    const editor = await setup(
      "alice@linky.fit",
      new ProfileMetadata({
        about: "Builder",
        displayName: "Alice",
        extraFields: { banner: "https://example.com/b.png", bot: false },
        lud16: "alice@linky.fit",
        name: "Alice",
        nip05: "alice@nostr.example",
      }),
    );
    await act(async () => editor.current?.setProfileEditName("New name"));
    await act(async () => editor.current?.saveProfileEdits());

    expect(mocks.publishProfile).toHaveBeenCalledWith(
      new ProfileMetadata({
        about: "Builder",
        displayName: "New name",
        extraFields: { banner: "https://example.com/b.png", bot: false },
        lud16: "alice@linky.fit",
        name: "New name",
        nip05: "alice@linky.fit",
        picture: "https://blossom.primal.net/photo.jpg",
      }),
    );
  });
});
