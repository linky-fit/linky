import { createId } from "@linky-fit/linksync";
import { Effect } from "effect";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { useUnknownSenderReassignment } from "./useUnknownSenderReassignment";

type Params = Parameters<typeof useUnknownSenderReassignment>[0];

const NPUB = "npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m";

describe("useUnknownSenderReassignment", () => {
  it("moves an unknown sender's conversation to the matching contact only once hydrated", async () => {
    const reassign = vi.fn<Params["reassign"]>(() => 1);
    const contactId = createId<"Contact">();
    const params: Params = {
      contacts: [{ id: contactId, npub: NPUB }],
      contactsRepository: { update: () => Effect.void },
      hydrated: false,
      reassign,
      unknownSenders: [{ id: "unknown:sender", npub: NPUB }],
    };
    const Probe = ({ hydrated }: { hydrated: boolean }) => {
      useUnknownSenderReassignment({ ...params, hydrated });
      return null;
    };
    const view = await renderIntoDocument(<Probe hydrated={false} />);
    await act(async () => {});
    expect(reassign).not.toHaveBeenCalled();

    await view.rerender(<Probe hydrated />);
    expect(reassign).toHaveBeenCalledWith("unknown:sender", contactId);
    await view.unmount();
  });
});
