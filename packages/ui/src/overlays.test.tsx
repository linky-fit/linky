import { act, useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "../test/render";
import { Button } from "./controls";
import { Dialog, Sheet } from "./overlays";

function MountedOpen() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onPress={() => setOpen(true)}>Pay</Button>
      {open ? (
        <Dialog open onOpenChange={setOpen} title="Confirm" closeLabel="Close">
          Paying 21 sats
        </Dialog>
      ) : null}
    </>
  );
}

describe("Dialog", () => {
  it("returns focus to the opener of a dialog that mounts open", async () => {
    const container = await render(<MountedOpen />);
    const opener = container.querySelector("button");
    opener?.focus();
    await act(async () => opener?.click());
    const close = document.querySelector<HTMLElement>("[aria-label=Close]");
    expect(document.activeElement).not.toBe(opener);
    await act(async () => close?.click());
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(document.activeElement).toBe(opener);
  });

  it("marks the safe-area edges of a full-screen dialog", async () => {
    await render(
      <Dialog open onOpenChange={() => {}} title="Scan" fullScreen>
        Camera
      </Dialog>,
    );
    const dialog = document.querySelector("[role=dialog]");
    expect(dialog?.querySelector("[data-safe-area=top]")).not.toBeNull();
    expect(dialog?.querySelector("[data-safe-area=bottom]")).not.toBeNull();
  });

  it("restores focus to an explicit returnFocusTo trigger inside another dialog", async () => {
    function NestedSheet() {
      const [sheetOpen, setSheetOpen] = useState(false);
      const moreRef = useRef<React.ComponentRef<typeof Button> | null>(null);
      return (
        <>
          <Dialog open onOpenChange={() => {}} title="Scanner" fullScreen>
            <Button ref={moreRef} onPress={() => setSheetOpen(true)}>
              More
            </Button>
          </Dialog>
          <Sheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            title="More options"
            returnFocusTo={moreRef}
          >
            <Button onPress={() => setSheetOpen(false)}>Close sheet</Button>
          </Sheet>
        </>
      );
    }

    await render(<NestedSheet />);
    const more = Array.from(document.querySelectorAll("button")).find(
      (element) => element.textContent === "More",
    );
    more?.focus();
    await act(async () => more?.click());
    const closeSheet = Array.from(document.querySelectorAll("button")).find(
      (element) => element.textContent === "Close sheet",
    );
    expect(closeSheet).toBeDefined();
    await act(async () => closeSheet?.click());
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(document.activeElement).toBe(more);
  });
});
