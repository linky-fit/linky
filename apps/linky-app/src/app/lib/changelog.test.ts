import { describe, expect, it } from "vitest";
import { changelogNotesFor, parseChangelog } from "./changelog";

const CHANGELOG = `# Changelog

Some intro text.

## [Unreleased]

### en-US

- Coming soon.

### cs-CZ

- Brzy.

## [26.11.1] - 2026-11-05

### en-US

- A fresh look in light and dark.
- Settings are tidier,
  on every screen.

### cs-CZ

- Nový vzhled ve světlém i tmavém režimu.

## [26.10.11] - 2026-11-04

### en-US

- The scanner sits top right.
`;

describe("parseChangelog", () => {
  it("reads every release with its date and per-language notes", () => {
    const releases = parseChangelog(CHANGELOG);
    expect(releases.map((release) => [release.version, release.date])).toEqual([
      [null, null],
      ["26.11.1", "2026-11-05"],
      ["26.10.11", "2026-11-04"],
    ]);
    expect(releases[1]?.notes["en-US"]).toEqual([
      "A fresh look in light and dark.",
      "Settings are tidier, on every screen.",
    ]);
    expect(releases[1]?.notes["cs-CZ"]).toEqual([
      "Nový vzhled ve světlém i tmavém režimu.",
    ]);
  });

  it("answers in the user's language and falls back to English", () => {
    const [unreleased, , older] = parseChangelog(CHANGELOG);
    if (!unreleased || !older) throw new Error("releases missing");
    expect(changelogNotesFor(unreleased, "cs")).toEqual(["Brzy."]);
    expect(changelogNotesFor(unreleased, "de")).toEqual(["Coming soon."]);
    expect(changelogNotesFor(older, "cs")).toEqual([
      "The scanner sits top right.",
    ]);
  });
});
