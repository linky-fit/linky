import type { Announcement } from "@linky-fit/keryx";
import type { KeryxSubscriptionId } from "@linky-fit/linksync";
import {
  EmptyState,
  FileAttachment,
  Image,
  MediaFrame,
  Pill,
  Row,
  SandboxedHtml,
  Section,
  Stack,
  Text,
} from "@linky-fit/ui";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useAdvancedSettingsContext } from "../app/context/SystemSettingsContexts";
import { useKeryx } from "../app/hooks/useKeryx";
import {
  openKeryxAttachment,
  useKeryxMediaUrl,
} from "../app/hooks/useKeryxMedia";
import {
  announcementKey,
  announcementSourceName,
  visibleAnnouncements,
} from "../app/lib/keryxCache";
import { sanitizeAnnouncementHtml } from "../app/lib/keryxHtml";
import { KeryxFooter } from "../components/KeryxCompany";
import { formatDate } from "../utils/formatting";

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

function AnnouncementImage({
  origin,
  announcement,
}: {
  origin: string;
  announcement: Announcement;
}) {
  const src = useKeryxMediaUrl({
    origin,
    url: announcement.image,
    sha256: announcement.imageSha256,
    announcementId: announcement.id,
  });
  return src ? (
    <MediaFrame accessibilityLabel={announcement.title} aspectRatio={16 / 9}>
      <Image src={src} width="100%" height="100%" objectFit="contain" />
    </MediaFrame>
  ) : null;
}

export function KeryxAnnouncementPage({
  id,
  announcementKey: key,
}: {
  id: KeryxSubscriptionId;
  announcementKey: string;
}): React.ReactElement {
  const { lang, t } = useAppShellCore();
  const { pushToast } = useAdvancedSettingsContext();
  const keryx = useKeryx();
  const [opening, setOpening] = React.useState<string | null>(null);
  const company = keryx.companies.find((candidate) => candidate.id === id);
  const entry = company ? keryx.entryOf(company) : null;
  const announcement =
    company && entry
      ? visibleAnnouncements(entry, company.subscription).find(
          (candidate) => announcementKey(candidate) === key,
        )
      : undefined;

  if (!company || !entry || !announcement) {
    return <EmptyState title={t("keryxNotFound")} />;
  }

  const { origin } = company.subscription;
  const isSecurity =
    announcement.privateFeedUrl === undefined &&
    announcement.channel === "security";

  return (
    <Stack gap="$lg">
      <Stack gap="$xs">
        <Text variant="heading">{announcement.title}</Text>
        <Row gap="$sm" flexWrap="wrap">
          <Pill
            label={announcementSourceName(entry, announcement)}
            tone={isSecurity ? "danger" : "neutral"}
            size="sm"
          />
          {announcement.privateFeedUrl !== undefined ? (
            <Pill label={t("keryxPrivate")} tone="info" size="sm" />
          ) : null}
          <Text variant="caption" color="$colorMuted">
            {formatDate(announcement.datePublished, lang)}
          </Text>
        </Row>
        <Text variant="caption" mono color="$colorMuted">
          {company.subscription.identity.companyName} · {origin}
        </Text>
      </Stack>
      <AnnouncementImage origin={origin} announcement={announcement} />
      <SandboxedHtml
        html={sanitizeAnnouncementHtml(announcement.contentHtml)}
        title={announcement.title}
      />
      {announcement.attachments.length > 0 ? (
        <Section title={t("keryxAttachments")}>
          {announcement.attachments.map((attachment) => (
            <FileAttachment
              key={attachment.url}
              name={attachment.name ?? hostOf(attachment.url)}
              meta={hostOf(attachment.url)}
              loading={opening === attachment.url}
              onPress={() => {
                setOpening(attachment.url);
                void openKeryxAttachment(
                  origin,
                  attachment,
                  announcement.id,
                ).then((opened) => {
                  setOpening(null);
                  if (!opened) pushToast(t("keryxMediaUnavailable"));
                });
              }}
            />
          ))}
        </Section>
      ) : null}
      <KeryxFooter text={t("keryxFooter")} />
    </Stack>
  );
}
