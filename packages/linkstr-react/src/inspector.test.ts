import { ClientId, RetractionDraft, RumorId } from "@linky/linkstr";
import type { InspectorEvent } from "@linky/linkstr";
import { stubWrapTransport } from "@linky/linkstr/testing";
import { Exit } from "effect";
import { linkstrConfigAtom } from "./config";
import { Registry } from "./index";
import { inspectorEventsAtom, inspectorHandlerAtom } from "./inspector";
import { retractReactionAtom } from "./reactions";
import { configWith, makeIdentity, settle } from "./testing";

const alice = makeIdentity();
const bob = makeIdentity();

const draft = new RetractionDraft({
  to: bob.pubkey,
  reactionIds: [RumorId.make("ab".repeat(32))],
  clientId: ClientId.make("client-inspector"),
});

const retract = async (registry: Registry.Registry) => {
  registry.set(retractReactionAtom, draft);
  const exit = await settle(registry, retractReactionAtom);
  assert(Exit.isSuccess(exit));
};

describe("inspectorEventsAtom", () => {
  it("streams operation and wire events to the sink, linked by wrap ids", async () => {
    const registry = Registry.make();
    const seen: Array<InspectorEvent> = [];

    registry.set(
      linkstrConfigAtom,
      configWith(alice, stubWrapTransport([]), { inspector: true }),
    );
    registry.set(inspectorHandlerAtom, {
      onEvent: (event) => {
        seen.push(event);
      },
    });
    const unmount = registry.mount(inspectorEventsAtom);

    await retract(registry);
    await expect.poll(() => seen.length).toBe(3);

    const wires = seen.filter((event) => event._tag === "WirePublished");
    const operation = seen.find((event) => event._tag === "OperationSucceeded");
    assert(operation?._tag === "OperationSucceeded");
    expect(operation.name).toBe("reactions.retract");
    expect(operation.clientId).toBe(draft.clientId);
    assert(operation.selfCopy !== null);
    expect(wires.map((event) => event.wrapId).sort()).toEqual(
      [operation.selfCopy.wrapId, operation.recipientCopy.wrapId].sort(),
    );

    unmount();
    registry.dispose();
  });

  it("stays silent when the config does not enable the inspector", async () => {
    const registry = Registry.make();
    const seen: Array<InspectorEvent> = [];

    registry.set(
      linkstrConfigAtom,
      configWith(alice, stubWrapTransport([]), { inspector: false }),
    );
    registry.set(inspectorHandlerAtom, {
      onEvent: (event) => {
        seen.push(event);
      },
    });
    const unmount = registry.mount(inspectorEventsAtom);

    await retract(registry);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toHaveLength(0);

    unmount();
    registry.dispose();
  });
});
