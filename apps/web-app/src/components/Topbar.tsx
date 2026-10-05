import {
  Avatar,
  IconButton,
  Pressable,
  Stack,
  Text,
  TopBar,
} from "@linky-fit/ui";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import {
  getDesktopRouteSection,
  getDesktopSectionRoute,
  isDesktopSectionEntryRoute,
} from "../app/routes/desktopRouteSection";
import type { TopbarButton } from "../app/types/appTypes";
import { navigateTo } from "../hooks/useRouting";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";

interface TopbarProps {
  /** Renders the static header of the desktop detail pane. */
  desktopDetail?: boolean;
}

const TopbarAction = ({
  button,
  guide,
}: {
  button: TopbarButton;
  guide?: string;
}) => (
  <IconButton
    icon={button.icon}
    accessibilityLabel={button.label}
    size="sm"
    variant={button.isActive ? "secondary" : "ghost"}
    aria-pressed={button.isActive}
    onPress={button.onClick}
    data-guide={guide}
  />
);

export function Topbar({
  desktopDetail = false,
}: TopbarProps): React.ReactElement {
  const state = useAppShellCore();
  const { chatTopbarContact, nostrPictureByNpub, t, topbarTitle } = state;

  const desktopTopbar: TopbarButton | null = isDesktopSectionEntryRoute(
    state.route,
  )
    ? {
        icon: "X",
        label: t("close"),
        onClick: () =>
          navigateTo({
            route: getDesktopSectionRoute(getDesktopRouteSection(state.route)),
          }),
      }
    : state.route.kind === "cashuTokenEmit"
      ? {
          icon: "ChevronLeft",
          label: t("back"),
          onClick: () => navigateTo({ route: "cashuTokens" }),
        }
      : state.topbar;
  const desktopTopbarRight =
    state.topbarRight?.icon === "Filter" ? null : state.topbarRight;

  const topbar = desktopDetail ? desktopTopbar : state.topbar;
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
    content: chatContent,
    leading: topbar ? <TopbarAction button={topbar} /> : null,
    trailing: topbarRight ? (
      <TopbarAction
        button={topbarRight}
        {...(topbarRight.icon === "ScanLine"
          ? { guide: "scan-contact-button" }
          : {})}
      />
    ) : null,
  };

  return desktopDetail ? (
    <TopBar {...props} />
  ) : (
    <Stack data-safe-area="top" backgroundColor="$background">
      <TopBar {...props} />
    </Stack>
  );
}
