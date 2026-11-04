import {
  Avatar,
  IconButton,
  Pressable,
  Stack,
  Text,
  TopBar,
} from "@linky-fit/ui";
import React from "react";
import { useNostrPictureByNpub } from "../app/hooks/contacts/useProfileCache";
import { useTopbar } from "../app/hooks/layout/useTopbar";
import { useTranslation } from "../app/hooks/shell";
import { useRouting } from "../hooks/useRouting";
import {
  getDesktopRouteSection,
  getDesktopSectionRoute,
  isDesktopSectionEntryRoute,
} from "../app/routes/desktopRouteSection";
import type { TopbarButton } from "../app/types/appTypes";
import { navigateTo } from "../hooks/useRouting";
import type { Route } from "../types/route";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";

const isMainSection = (route: Route): boolean =>
  route.kind === "contacts" ||
  route.kind === "wallet" ||
  route.kind === "collaboration" ||
  route.kind === "settings" ||
  route.kind === "profile";

interface TopbarProps {
  /** Renders the static header of the desktop detail pane. */
  desktopDetail?: boolean;
}

const TopbarAction = ({ button }: { button: TopbarButton }) => (
  <IconButton
    icon={button.icon}
    accessibilityLabel={button.label}
    size="sm"
    indicator={button.indicator}
    variant={button.isActive ? "secondary" : "ghost"}
    aria-pressed={button.isActive}
    onPress={button.onClick}
    data-guide={button.guide}
  />
);

export function Topbar({
  desktopDetail = false,
}: TopbarProps): React.ReactElement {
  const route = useRouting();
  const { t } = useTranslation();
  const nostrPictureByNpub = useNostrPictureByNpub();
  const state = useTopbar();
  const { chatTopbarContact, topbarLeading, topbarTitle } = state;

  const desktopTopbar: TopbarButton | null = isDesktopSectionEntryRoute(route)
    ? {
        icon: "X",
        label: t("close"),
        onClick: () =>
          navigateTo({
            route: getDesktopSectionRoute(getDesktopRouteSection(route)),
          }),
      }
    : route.kind === "cashuTokenEmit"
      ? {
          icon: "ChevronLeft",
          label: t("back"),
          onClick: () => navigateTo({ route: "cashuTokens" }),
        }
      : state.topbar;
  // The desktop detail pane closes with the X on the left, so a root screen's
  // own action (the profile's pencil) takes the right slot there instead.
  const desktopTopbarRight =
    isDesktopSectionEntryRoute(route) && topbarLeading
      ? topbarLeading
      : state.topbarRight;

  const topbar = desktopDetail
    ? desktopTopbar
    : (state.topbar ?? topbarLeading);
  const topbarRight = desktopDetail ? desktopTopbarRight : state.topbarRight;

  const chatContent = chatTopbarContact
    ? (() => {
        const contactId = chatTopbarContact.contactId;
        const contactName = (chatTopbarContact.name ?? "").trim();
        const name = contactName || t("messagesTitle");
        const npub = normalizeNpubIdentifier(chatTopbarContact.npub ?? "");
        return (
          <Pressable
            gap="$sm"
            aria-label={contactId ? t("contact") : t("messagesTitle")}
            disabled={!contactId}
            onPress={() => {
              if (contactId) navigateTo({ route: "contact", id: contactId });
            }}
          >
            <Avatar
              name={contactName}
              uri={(npub ? nostrPictureByNpub[npub] : null) ?? undefined}
              size="sm"
            />
            <Text variant="label" bold color="$colorSubtle" numberOfLines={1}>
              {name}
            </Text>
          </Pressable>
        );
      })()
    : undefined;

  const props = {
    ...(topbarTitle ? { title: topbarTitle } : {}),
    large: !desktopDetail && isMainSection(route),
    content: chatContent,
    leading: topbar ? <TopbarAction button={topbar} /> : null,
    trailing: topbarRight ? <TopbarAction button={topbarRight} /> : null,
  };

  return desktopDetail ? (
    <TopBar {...props} />
  ) : (
    <Stack data-safe-area="top" backgroundColor="$background">
      <TopBar {...props} />
    </Stack>
  );
}
