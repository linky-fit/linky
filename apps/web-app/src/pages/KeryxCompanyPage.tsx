import type { KeryxSubscriptionId } from "@linky-fit/linksync";
import {
  Avatar,
  Button,
  Divider,
  EmptyState,
  IconButton,
  ListRow,
  Notice,
  Pill,
  Section,
  Spinner,
  Stack,
} from "@linky-fit/ui";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useAdvancedSettingsContext } from "../app/context/SystemSettingsContexts";
import { useKeryx, useRefreshOnOpen } from "../app/hooks/useKeryx";
import { useKeryxMediaUrl } from "../app/hooks/useKeryxMedia";
import {
  announcementKey,
  announcementSourceName,
  visibleAnnouncements,
} from "../app/lib/keryxCache";
import {
  KeryxChannelToggles,
  KeryxCompanyHeader,
  KeryxFooter,
} from "../components/KeryxCompany";
import { useArmedAction } from "../hooks/useArmedAction";
import { navigateTo } from "../hooks/useRouting";
import { formatDate } from "../utils/formatting";

export function KeryxCompanyPage({
  id,
}: {
  id: KeryxSubscriptionId;
}): React.ReactElement {
  const { lang, t } = useAppShellCore();
  const { pushToast } = useAdvancedSettingsContext();
  const keryx = useKeryx();
  const company = keryx.companies.find((candidate) => candidate.id === id);
  const opened = React.useMemo(() => (company ? [company] : []), [company]);
  useRefreshOnOpen(opened, keryx.refresh);
  const removal = useArmedAction(() => pushToast(t("keryxRemoveArmedHint")));
  const entry = company ? keryx.entryOf(company) : null;
  const pendingLogo = useKeryxMediaUrl({
    origin: company?.subscription.origin ?? "",
    url: entry?.pendingIdentity?.logo,
    sha256: entry?.pendingIdentity?.logoSha256,
  });

  if (!company || !entry) return <EmptyState title={t("keryxNotFound")} />;

  const { origin, identity, channels } = company.subscription;
  const refreshing = keryx.state.refreshing.has(origin);
  const failure = keryx.state.errors.get(origin);
  const remove = () =>
    removal.confirm(() => {
      void keryx.remove(company).then((outcome) => {
        if (outcome.ok) navigateTo({ route: "settings" });
        else pushToast(outcome.error);
      });
    });
  const removeButton = (
    <Button
      variant={removal.armed ? "danger" : "secondary"}
      icon="Trash2"
      onPress={remove}
      testID="keryx-remove-company"
    >
      {t("keryxRemoveCompany")}
    </Button>
  );
  // A suspended company offers nothing but removal.
  const header = (
    <KeryxCompanyHeader
      origin={origin}
      identity={identity}
      trailing={
        entry.status === "suspended" ? null : refreshing ? (
          <Spinner />
        ) : (
          <IconButton
            icon="RefreshCcw"
            variant="ghost"
            accessibilityLabel={t("keryxRefresh")}
            onPress={() => void keryx.refresh(company)}
          />
        )
      }
    />
  );

  if (entry.status === "suspended") {
    return (
      <Stack gap="$lg">
        {header}
        <Notice
          tone="danger"
          icon="ShieldAlert"
          title={t("keryxSuspendedTitle")}
          description={t("keryxSuspendedBody")}
        />
        {removeButton}
      </Stack>
    );
  }

  if (entry.status === "rebranded") {
    return (
      <Stack gap="$lg">
        {header}
        <Notice
          tone="danger"
          icon="TriangleAlert"
          title={t("keryxRebrandedTitle")}
          description={t("keryxRebrandedBody").replace(
            "{name}",
            entry.pendingIdentity?.companyName ?? "",
          )}
          action={{
            label: t("keryxRepair"),
            onPress: () => navigateTo({ route: "keryxCompanyNew" }),
          }}
        />
        {removeButton}
      </Stack>
    );
  }

  const announcements = visibleAnnouncements(entry, company.subscription);
  const followed = new Set(channels);
  const toggleChannel = (name: string) => {
    const next = followed.has(name)
      ? channels.filter((channel) => channel !== name)
      : [...channels, name];
    void keryx.setChannels(company, next).then((outcome) => {
      if (!outcome.ok) pushToast(outcome.error);
    });
  };
  const pendingIdentity = entry.pendingIdentity;

  return (
    <Stack gap="$lg">
      {header}
      {failure ? (
        <Notice
          tone="warning"
          title={t(
            failure === "KeryxLiteModeUnsupported"
              ? "keryxLiteModeUnsupported"
              : "keryxRefreshFailed",
          )}
        />
      ) : null}
      {pendingIdentity ? (
        <Notice
          tone="info"
          title={t("keryxLogoChanged")}
          description={
            <Avatar
              name={pendingIdentity.companyName}
              uri={pendingLogo}
              icon="Building"
            />
          }
          action={{
            label: t("keryxLogoAcknowledge"),
            onPress: () =>
              void keryx.acknowledgeIdentity(company, pendingIdentity),
          }}
        />
      ) : null}

      <Section title={t("keryxAnnouncements")}>
        {announcements.length === 0 ? (
          <EmptyState icon="Megaphone" title={t("keryxNoAnnouncements")} />
        ) : (
          announcements.map((announcement) => {
            const key = announcementKey(announcement);
            const isPrivate = announcement.privateFeedUrl !== undefined;
            return (
              <ListRow
                key={key}
                icon={
                  isPrivate
                    ? "Lock"
                    : announcement.channel === "security"
                      ? "ShieldAlert"
                      : "Megaphone"
                }
                title={announcement.title}
                description={`${announcementSourceName(entry, announcement)} · ${formatDate(announcement.datePublished, lang)}`}
                trailing={
                  isPrivate ? (
                    <Pill label={t("keryxPrivate")} tone="info" size="sm" />
                  ) : undefined
                }
                onPress={() =>
                  navigateTo({ route: "keryxAnnouncement", id, key })
                }
              />
            );
          })
        )}
      </Section>

      <Divider />

      <Section title={t("keryxChannels")}>
        <KeryxChannelToggles
          catalog={entry.catalog}
          isFollowed={(name) => followed.has(name)}
          onToggle={toggleChannel}
        />
        {company.subscription.privateFeeds.map((feed) => (
          <ListRow
            key={feed.url}
            icon="Lock"
            title={entry.feedNames[feed.url] ?? t("keryxPrivate")}
            description={t("keryxPrivateFeedAutoSubscribed")}
          />
        ))}
      </Section>

      <Divider />

      {removeButton}
      <KeryxFooter text={t("keryxFooter")} />
    </Stack>
  );
}
