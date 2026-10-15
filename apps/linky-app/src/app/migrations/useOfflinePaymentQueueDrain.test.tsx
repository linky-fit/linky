import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { LOCAL_PENDING_PAYMENTS_STORAGE_KEY_PREFIX } from "../../utils/constants";
import type { UpdateLocalNostrMessage } from "../types/appTypes";
import { useOfflinePaymentQueueDrain } from "./useOfflinePaymentQueueDrain";

const OWNER = "owner-1";
const key = `${LOCAL_PENDING_PAYMENTS_STORAGE_KEY_PREFIX}.${OWNER}`;
const entry = (id: string, messageId?: string) => ({
  id,
  contactId: "contact-1",
  amountSat: 600,
  createdAtSec: 1,
  ...(messageId ? { messageId } : {}),
});

afterEach(() => localStorage.clear());

const render = async (hydrated: boolean) => {
  const update = vi.fn<UpdateLocalNostrMessage>(async () => ({ ok: true }));
  const Probe = ({ hydrated }: { hydrated: boolean }) => {
    useOfflinePaymentQueueDrain({
      appOwnerId: OWNER,
      failedNotice: "payment failed",
      hydrated,
      updateLocalNostrMessage: update,
    });
    return null;
  };
  const view = await renderIntoDocument(<Probe hydrated={hydrated} />);
  await act(async () => {});
  return {
    update,
    view,
    hydrate: async () => {
      await view.rerender(<Probe hydrated />);
      await act(async () => {});
    },
  };
};

describe("useOfflinePaymentQueueDrain", () => {
  it("drops the queue once hydrated and marks each placeholder failed", async () => {
    localStorage.setItem(
      key,
      JSON.stringify([entry("a", "message-a"), entry("b")]),
    );

    const { update, view, hydrate } = await render(false);
    expect(update).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).not.toBeNull();

    await hydrate();

    expect(update.mock.calls).toEqual([
      [
        "message-a",
        { content: "payment failed", status: "sent", localOnly: true },
      ],
    ]);
    expect(localStorage.getItem(key)).toBeNull();
    await view.unmount();
  });

  it("does nothing without a queue", async () => {
    const { update, view } = await render(true);

    expect(update).not.toHaveBeenCalled();
    await view.unmount();
  });
});
