import type { Lang } from "../../i18n";

export type ChangelogLocale = "en-US" | "cs-CZ";

export interface ChangelogRelease {
  /** Null for the `[Unreleased]` section. */
  readonly version: string | null;
  /** ISO date as the changelog writes it; null for an unreleased section. */
  readonly date: string | null;
  readonly notes: Readonly<Partial<Record<ChangelogLocale, readonly string[]>>>;
}

const RELEASE_HEADING = /^## \[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/;
const LOCALE_HEADING = /^### (\S+)\s*$/;

const isChangelogLocale = (value: string): value is ChangelogLocale =>
  value === "en-US" || value === "cs-CZ";

/**
 * Reads the app changelog (Keep a Changelog, one `### <locale>` list per
 * release) into releases, newest first as the file lists them.
 */
export const parseChangelog = (markdown: string): ChangelogRelease[] => {
  const releases: ChangelogRelease[] = [];
  let notes: Partial<Record<ChangelogLocale, string[]>> | null = null;
  let items: string[] | null = null;
  for (const line of markdown.split("\n")) {
    const release = RELEASE_HEADING.exec(line);
    if (release) {
      notes = {};
      items = null;
      const version = release[1] ?? "";
      releases.push({
        version: version === "Unreleased" ? null : version,
        date: release[2] ?? null,
        notes,
      });
      continue;
    }
    const locale = LOCALE_HEADING.exec(line)?.[1];
    if (locale !== undefined && notes) {
      if (isChangelogLocale(locale)) {
        items = [];
        notes[locale] = items;
      } else {
        items = null;
      }
      continue;
    }
    if (!items) continue;
    if (line.startsWith("- ")) {
      items.push(line.slice(2).trim());
    } else if (/^\s+\S/.test(line) && items.length > 0) {
      // A wrapped bullet continues on an indented line.
      items[items.length - 1] = `${items[items.length - 1]} ${line.trim()}`;
    }
  }
  return releases;
};

/** The release's notes in the user's language, English where the changelog has no other. */
export const changelogNotesFor = (
  release: ChangelogRelease,
  lang: Lang,
): readonly string[] =>
  (lang === "cs" ? release.notes["cs-CZ"] : undefined) ??
  release.notes["en-US"] ??
  [];
