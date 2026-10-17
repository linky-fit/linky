import { describe, expect, it } from "vitest";
import { guideTarget, guideTargetNodes, guideTargetRef } from "./guideTargets";

describe("guideTarget", () => {
  it("keeps the web's data-guide attribute and one stable ref per id", () => {
    const props = guideTarget("wallet-send");
    expect(props["data-guide"]).toBe("wallet-send");
    expect(props.ref).toBe(guideTargetRef("wallet-send"));
  });

  it("lists the mounted elements of an id, oldest first, until they unmount", () => {
    const first = { name: "first" };
    const second = { name: "second" };
    const ref = guideTargetRef("contact-card-test");
    const unmountFirst = ref(first);
    const unmountSecond = ref(second);
    expect(guideTargetNodes("contact-card-test")).toEqual([first, second]);

    unmountFirst();
    expect(guideTargetNodes("contact-card-test")).toEqual([second]);
    unmountSecond();
    expect(guideTargetNodes("contact-card-test")).toEqual([]);
  });

  it("drops elements that left the tree without their ref's cleanup", () => {
    const detached = { isConnected: false };
    const mounted = { isConnected: true };
    const ref = guideTargetRef("composed-ref-test");
    ref(detached);
    ref(mounted);
    expect(guideTargetNodes("composed-ref-test")).toEqual([mounted]);
  });
});
