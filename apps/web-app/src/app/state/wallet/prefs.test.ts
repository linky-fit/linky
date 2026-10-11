import { describe, expect, it } from "vitest";
import {
  makeTestAppRegistry,
  memoryKvPorts,
} from "../../../testUtils/appRegistry";
import { receiveMethodAtom } from "./prefs";

describe("receiveMethodAtom", () => {
  it("stores the default on first launch and every write after", () => {
    const { items, ports } = memoryKvPorts();
    const registry = makeTestAppRegistry({ ports });

    expect(registry.get(receiveMethodAtom)).toBe("universal");
    expect(Object.fromEntries(items)).toEqual({
      "linky.receive_method.v1": "universal",
    });

    registry.set(receiveMethodAtom, "lightning");

    expect(items.get("linky.receive_method.v1")).toBe("lightning");
  });
});
