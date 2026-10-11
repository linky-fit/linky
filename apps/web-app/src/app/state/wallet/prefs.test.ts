import { describe, expect, it } from "vitest";
import {
  makeTestAppRegistry,
  memoryKvPorts,
} from "../../../testUtils/appRegistry";
import { PAY_WITH_CASHU_STORAGE_KEY } from "../../../utils/constants";
import { payWithCashuEnabledAtom, receiveMethodAtom } from "./prefs";

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

describe("payWithCashuEnabledAtom", () => {
  it("keeps a stored choice, stores the default on first launch and every write after", () => {
    const fresh = memoryKvPorts();
    const freshRegistry = makeTestAppRegistry({ ports: fresh.ports });
    expect(freshRegistry.get(payWithCashuEnabledAtom)).toBe(true);
    expect(fresh.items.get(PAY_WITH_CASHU_STORAGE_KEY)).toBe("1");

    const { items, ports } = memoryKvPorts({
      [PAY_WITH_CASHU_STORAGE_KEY]: "0",
    });
    const registry = makeTestAppRegistry({ ports });
    expect(registry.get(payWithCashuEnabledAtom)).toBe(false);

    registry.set(payWithCashuEnabledAtom, true);

    expect(items.get(PAY_WITH_CASHU_STORAGE_KEY)).toBe("1");
  });
});
