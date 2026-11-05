import { Pill, Row, Section, Stack, Text } from "@linky-fit/ui";
import React from "react";
import changelogMarkdown from "../../CHANGELOG.md?raw";
import { useTranslation } from "../app/hooks/shell";
import { changelogNotesFor, parseChangelog } from "../app/lib/changelog";
import { isDevBuild } from "../platform/buildEnv";
import { isNightlyOrigin } from "../platform/runtime";
import { normalizeLocale } from "../utils/formatting";

const RELEASES = parseChangelog(changelogMarkdown);

/** The changelog, one section per release; the unreleased notes show only where they are already running. */
export function WhatsNewPage(): React.ReactElement {
  const { lang, t } = useTranslation();
  const showUnreleased = isDevBuild || isNightlyOrigin();
  const dateFormatter = React.useMemo(
    () => new Intl.DateTimeFormat(normalizeLocale(lang), { dateStyle: "long" }),
    [lang],
  );
  const releases = RELEASES.filter(
    (release) =>
      (release.version !== null || showUnreleased) &&
      changelogNotesFor(release, lang).length > 0,
  );

  return (
    <Stack gap="$xl">
      {releases.map((release) => (
        <Stack key={release.version ?? "unreleased"} gap="$sm">
          <Row gap="$sm" alignItems="center">
            <Text variant="title">
              {release.version ?? t("whatsNewUnreleased")}
            </Text>
            {release.version === __APP_VERSION__ ? (
              <Pill size="sm" tone="accent" label={t("whatsNewInstalled")} />
            ) : null}
            <Stack flex={1} />
            {release.date ? (
              <Text variant="caption" color="$colorMuted">
                {dateFormatter.format(new Date(`${release.date}T00:00:00`))}
              </Text>
            ) : null}
          </Row>
          <Section grouped>
            <Stack gap="$sm" paddingVertical="$sm">
              {changelogNotesFor(release, lang).map((note) => (
                <Row key={note} gap="$sm" alignItems="flex-start">
                  <Text color="$colorMuted">•</Text>
                  <Text flex={1}>{note}</Text>
                </Row>
              ))}
            </Stack>
          </Section>
        </Stack>
      ))}
    </Stack>
  );
}
