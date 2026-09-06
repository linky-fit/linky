import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadBootDiagnostics = async () => {
  vi.resetModules();
  return import("./bootDiagnostics");
};

describe("boot diagnostics", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal("__APP_VERSION__", "test-version");
    vi.stubGlobal("__APP_COMMIT_SHA__", "test-commit");
    window.history.replaceState(
      null,
      "",
      "/contacts?token=query-secret#cashuAhash-secret",
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("records stage timing and redacts known key material", async () => {
    const diagnostics = await loadBootDiagnostics();
    const nsec = `nsec1${"q".repeat(58)}`;
    const cashu = `cashuA${"a".repeat(40)}`;
    const hex = "ab".repeat(32);

    diagnostics.recordBootStage("await-render-commit");
    diagnostics.recordBootError(
      new Error(
        `failed for ${nsec} ${cashu} ${hex} at https://app.linky.fit/#wallet?cashu=another-secret`,
      ),
      "test",
    );

    const report = await diagnostics.collectBootDiagnostics();
    const serialized = JSON.stringify(report);

    expect(report.currentAttempt.app).toEqual({
      commit: "test-commit",
      version: "test-version",
    });
    expect(report.currentAttempt.currentStage).toBe("await-render-commit");
    expect(serialized).toContain("[redacted secret key]");
    expect(serialized).toContain("[redacted cashu token]");
    expect(serialized).toContain("[redacted 32-byte value]");
    expect(serialized).not.toContain(nsec);
    expect(serialized).not.toContain(cashu);
    expect(serialized).not.toContain(hex);
    expect(serialized).not.toContain("another-secret");
    expect(serialized).toContain("https://app.linky.fit/");
  });

  it("omits query strings and hash payloads from the report", async () => {
    const diagnostics = await loadBootDiagnostics();
    const report = await diagnostics.collectBootDiagnostics();
    const serialized = JSON.stringify(report);

    expect(report.environment.page).toEqual({
      origin: window.location.origin,
      pathname: "/contacts",
    });
    expect(serialized).not.toContain("query-secret");
    expect(serialized).not.toContain("hash-secret");
  });

  it("reports the previous attempt retained by the HTML shell", async () => {
    sessionStorage.setItem(
      "linky.boot.diagnostics.previous.v1",
      JSON.stringify({ currentStage: "import-evolu" }),
    );
    const diagnostics = await loadBootDiagnostics();

    const report = await diagnostics.collectBootDiagnostics();

    expect(report.previousAttempt).toEqual({ currentStage: "import-evolu" });
    expect(
      sessionStorage.getItem("linky.boot.diagnostics.current.v1"),
    ).toContain('"module-loaded"');
  });
});
