import {
  Button,
  LoadingState,
  NavigationRail,
  Notice,
  Row,
  Stack,
  StatusLine,
  TabBar,
  useMedia,
  type NavItem,
} from "@linky-fit/ui";
import type { ReactNode } from "react";
import { copy } from "../copy/en";
import { navigateTo, useRoute } from "../platform/hashRoute";
import { sectionRoute, sections, type Route, type Section } from "../routing";
import { ChatScreen } from "../screens/ChatScreen";
import { ChatsScreen } from "../screens/ChatsScreen";
import { Page } from "../screens/Page";
import { RestoreScreen } from "../screens/RestoreScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { StatsScreen } from "../screens/StatsScreen";
import { TransferDetailScreen } from "../screens/TransferDetailScreen";
import { TransfersScreen } from "../screens/TransfersScreen";
import { WalletScreen } from "../screens/WalletScreen";
import type { OpenFailureReason } from "../services/device";
import { useAccountHydrated, useDevice, useSession } from "../services/react";

const sectionIcons: Record<Section, NavItem<Section>["icon"]> = {
  transfers: "Repeat",
  chats: "MessageCircle",
  wallet: "Wallet",
  stats: "Gauge",
  settings: "Settings",
};

const navItems = sections.map(
  (value): NavItem<Section> => ({
    value,
    label: copy.sections[value],
    icon: sectionIcons[value],
    testID: `nav-${value}`,
  }),
);

const goTo = (section: Section) => navigateTo(sectionRoute(section));

/** Restore while signed out, the sections once the account is open. */
export function AppShell() {
  const session = useSession();
  switch (session._tag) {
    case "SignedOut":
      return <RestoreScreen />;
    case "Opening":
      return <LoadingState label={copy.loading} />;
    case "Failed":
      return <OpenFailed reason={session.reason} />;
    case "SignedIn":
      return <SignedIn />;
  }
}

function OpenFailed({ reason }: { readonly reason: OpenFailureReason }) {
  const device = useDevice();
  const message = {
    otherTab: {
      title: copy.openFailed.otherTabTitle,
      description: copy.openFailed.otherTabDescription,
    },
    storageUnavailable: {
      title: copy.openFailed.storageUnavailableTitle,
      description: copy.openFailed.storageUnavailableDescription,
    },
    other: {
      title: copy.openFailed.title,
      description: copy.openFailed.description,
    },
  }[reason];
  return (
    <Page centered testID="open-failed-screen">
      <Notice
        tone="warning"
        title={message.title}
        description={message.description}
      />
      <Button onPress={device.reload}>{copy.openFailed.reload}</Button>
    </Page>
  );
}

function SignedIn() {
  const route = useRoute();
  const hydrated = useAccountHydrated();
  return (
    <Navigated section={route.section}>
      {hydrated ? null : <StatusLine busy label={copy.syncing} />}
      <RouteScreen route={route} />
    </Navigated>
  );
}

function RouteScreen({ route }: { readonly route: Route }) {
  switch (route.section) {
    case "transfers":
      return route.transferId === null ? (
        <TransfersScreen />
      ) : (
        <TransferDetailScreen transferId={route.transferId} />
      );
    case "chats":
      return route.peer === null ? (
        <ChatsScreen />
      ) : (
        <ChatScreen peer={route.peer} />
      );
    case "wallet":
      return <WalletScreen />;
    case "stats":
      return <StatsScreen />;
    case "settings":
      return <SettingsScreen />;
  }
}

/** The rail on wide screens, bottom tabs on phones. */
function Navigated({
  section,
  children,
}: {
  readonly section: Section;
  readonly children: ReactNode;
}) {
  const { wide } = useMedia();
  const body = (
    <Stack flex={1} gap="$none" minWidth={0} minHeight={0}>
      {children}
    </Stack>
  );
  if (wide) {
    return (
      <Row flex={1} gap="$none" alignItems="stretch">
        <NavigationRail
          accessibilityLabel={copy.navigation}
          items={navItems.filter((item) => item.value !== "settings")}
          footerItems={navItems.filter((item) => item.value === "settings")}
          value={section}
          onValueChange={goTo}
        />
        {body}
      </Row>
    );
  }
  return (
    <Stack flex={1} gap="$none" minHeight={0}>
      {body}
      <Stack data-safe-area="bottom" backgroundColor="$surface">
        <TabBar
          accessibilityLabel={copy.navigation}
          items={navItems}
          value={section}
          onValueChange={goTo}
        />
      </Stack>
    </Stack>
  );
}
