import { RegistryContext } from "@linky-fit/linkstr-react";
import { AtomRegistry } from "effect/reactivity";
import { act, useEffect } from "react";
import { describe, expect, it } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { profileCacheAtom } from "../../state/contacts/profiles";
import { useProfileCache } from "./useProfileCache";

type ProfileCacheHook = ReturnType<typeof useProfileCache>;

const renderCache = async () => {
  const registry = AtomRegistry.make();
  const hook: { current: ProfileCacheHook | null } = { current: null };
  const Probe = () => {
    const value = useProfileCache();
    useEffect(() => {
      hook.current = value;
    }, [value]);
    return null;
  };
  const view = await renderIntoDocument(
    <RegistryContext.Provider value={registry}>
      <Probe />
    </RegistryContext.Provider>,
  );
  const current = (): ProfileCacheHook => {
    if (!hook.current) throw new Error("hook did not render");
    return hook.current;
  };
  return { current, registry, view };
};

describe("useProfileCache", () => {
  it("updates one map like a state setter and keeps the cache when nothing changes", async () => {
    const { current, registry, view } = await renderCache();

    await act(async () => {
      current().setPictureByNpub((prev) => ({ ...prev, npub1a: "a.png" }));
      current().setStatusByNpub({ npub1a: "EUR" });
    });
    const updated = registry.get(profileCacheAtom);
    expect(updated).toEqual({
      metadataByNpub: {},
      pictureByNpub: { npub1a: "a.png" },
      statusByNpub: { npub1a: "EUR" },
    });

    await act(async () => {
      current().setPictureByNpub((prev) => prev);
    });
    expect(registry.get(profileCacheAtom)).toBe(updated);

    await act(async () => current().reset());
    expect(current().cache.pictureByNpub).toEqual({});
    await view.unmount();
  });
});
