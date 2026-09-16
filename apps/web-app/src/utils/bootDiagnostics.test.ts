import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BOOT_DIAGNOSTIC_TEST_PHRASES } from "./bootDiagnosticSecrets.fixture";

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

  it.each(BOOT_DIAGNOSTIC_TEST_PHRASES)(
    "redacts recovery input throughout the diagnostic pipeline: %s",
    async (phrase) => {
      const diagnostics = await loadBootDiagnostics();
      const varied = phrase.toUpperCase().replaceAll(" ", "\n \t");
      const error = new Error(`restore failed: ${varied}`);
      error.name = phrase;
      error.stack = `Error: ${phrase}\n    at restore (https://app.linky.fit/assets/index.js:1:2)`;
      diagnostics.recordBootStage(phrase);
      diagnostics.recordBootError(error, varied, `at ${phrase}`);

      const stored = sessionStorage.getItem(
        "linky.boot.diagnostics.current.v1",
      );
      const report = JSON.stringify(await diagnostics.collectBootDiagnostics());
      for (const result of [
        stored,
        report,
        diagnostics.formatBootError(error),
      ]) {
        expect(result).toContain("[redacted recovery phrase]");
        expect(result?.toLowerCase()).not.toContain(phrase);
        expect(result?.toLowerCase()).not.toContain(phrase.split(" ")[0]);
      }
      expect(report).toContain("/assets/index.js:1:2");
    },
  );

  it("redacts encoded paths, old stored attempts and escaped error-object whitespace", async () => {
    const phrase = BOOT_DIAGNOSTIC_TEST_PHRASES[0];
    if (!phrase) throw new Error("missing phrase fixture");
    window.history.replaceState(null, "", `/${encodeURIComponent(phrase)}`);
    sessionStorage.setItem(
      "linky.boot.diagnostics.previous.v1",
      JSON.stringify({
        currentStage: "import-evolu",
        events: [
          {
            error: {
              message: phrase,
              name: phrase,
              source: phrase,
              stack: phrase,
            },
          },
        ],
      }),
    );
    const diagnostics = await loadBootDiagnostics();
    diagnostics.recordBootError(
      { input: phrase.replaceAll(" ", "\n") },
      "restore",
    );
    diagnostics.recordBootError(
      new Error(
        `https://app.linky.fit/${encodeURIComponent(phrase)}?secret=hidden`,
      ),
      "restore",
    );
    const report = JSON.stringify(await diagnostics.collectBootDiagnostics());
    expect(report).toContain("import-evolu");
    expect(report).toContain("[redacted recovery phrase]");
    expect(report).not.toContain("item");
    expect(report).not.toContain("hidden");
    expect(
      sessionStorage.getItem("linky.boot.diagnostics.previous.v1"),
    ).not.toContain("item");
  });

  it("preserves useful short errors and removes malformed previous records", async () => {
    sessionStorage.setItem(
      "linky.boot.diagnostics.previous.v1",
      "broken stored report",
    );
    const diagnostics = await loadBootDiagnostics();
    diagnostics.recordBootError(
      new TypeError("Failed to fetch dynamically imported module"),
      "import-app",
    );
    const report = await diagnostics.collectBootDiagnostics();
    expect(report.currentAttempt.events.at(-1)?.error).toMatchObject({
      name: "TypeError",
      message: "Failed to fetch dynamically imported module",
      source: "import-app",
    });
    expect(report.previousAttempt).toBeNull();
    expect(
      sessionStorage.getItem("linky.boot.diagnostics.previous.v1"),
    ).toBeNull();
  });

  it("redacts word arrays and quoted validation errors without a checksum", async () => {
    const diagnostics = await loadBootDiagnostics();
    const phrase = BOOT_DIAGNOSTIC_TEST_PHRASES[0];
    if (!phrase) throw new Error("missing phrase fixture");
    const words = phrase.toUpperCase().split(" ");
    diagnostics.recordBootError({ words }, "restore");
    diagnostics.recordBootError(new Error(JSON.stringify(words)), "restore");
    diagnostics.recordBootError(
      new Error(words.map((word) => `'${word}'`).join(", ")),
      "restore",
    );
    sessionStorage.setItem(
      "linky.boot.diagnostics.previous.v1",
      JSON.stringify({
        words,
        quoted: JSON.stringify(words),
        [phrase]: "invalid seed",
      }),
    );
    const report = JSON.stringify(await diagnostics.collectBootDiagnostics());
    expect(report).toContain("[redacted recovery phrase]");
    expect(report.toLowerCase()).not.toContain("lilac");
    expect(
      sessionStorage
        .getItem("linky.boot.diagnostics.previous.v1")
        ?.toLowerCase(),
    ).not.toContain("lilac");
    expect(
      sessionStorage
        .getItem("linky.boot.diagnostics.current.v1")
        ?.toLowerCase(),
    ).not.toContain("lilac");
  });
});
