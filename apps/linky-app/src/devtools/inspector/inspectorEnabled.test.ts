import { describe, expect, it } from "vitest";

import {
  resolveInspectorEmissionEnabled,
  resolveInspectorEnabled,
} from "./inspectorEnabled";

describe("resolveInspectorEnabled", () => {
  it("defaults off in production and on in development", () => {
    expect(resolveInspectorEnabled(null, false)).toBe(false);
    expect(resolveInspectorEnabled(null, true)).toBe(true);
  });

  it("honors an explicit persisted preference in every build", () => {
    expect(resolveInspectorEnabled(true, false)).toBe(true);
    expect(resolveInspectorEnabled(false, true)).toBe(false);
  });
});

describe("resolveInspectorEmissionEnabled", () => {
  it("emits in development or when either independent sink is enabled", () => {
    expect(resolveInspectorEmissionEnabled(false, false, false)).toBe(false);
    expect(resolveInspectorEmissionEnabled(true, false, false)).toBe(true);
    expect(resolveInspectorEmissionEnabled(false, true, false)).toBe(true);
    expect(resolveInspectorEmissionEnabled(false, false, true)).toBe(true);
  });
});
