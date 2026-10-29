import {
  Avatar,
  Image,
  LoadingState,
  NavigationRail,
  Row,
  Stack,
  TabBar,
  useMedia,
  type NavItem,
} from "@linky-fit/ui";
import { useEffect, type ReactNode } from "react";
import { copy } from "../copy";
import type { ShopProfile } from "../domain";
import { navigateTo, replaceRoute, useRoute } from "../platform/hashRoute";
import {
  isSection,
  paymentIdOf,
  resolveRoute,
  sections,
  supportRoute,
  type AccountState,
  type Route,
  type Section,
} from "../routing";
import { HistoryScreen } from "../screens/HistoryScreen";
import { PaymentScreen } from "../screens/PaymentScreen";
import { RestoreScreen } from "../screens/RestoreScreen";
import { RestoringScreen } from "../screens/RestoringScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { SetupScreen } from "../screens/SetupScreen";
import { SupportChatScreen } from "../screens/SupportChatScreen";
import { TerminalScreen } from "../screens/TerminalScreen";
import { WalletScreen } from "../screens/WalletScreen";
import { WelcomeScreen } from "../screens/WelcomeScreen";
import {
  useAccountHydrated,
  useSession,
  useShopProfile,
} from "../services/react";
import { PaidBannerHost } from "./PaidBannerHost";

const sectionIcons: Record<Section, NavItem<Section>["icon"]> = {
  terminal: "QrCode",
  history: "History",
  wallet: "Bitcoin",
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

/** The section a route belongs to, for the navigation; `null` outside the signed-in app. */
const sectionOf = (route: Route): Section | null =>
  isSection(route)
    ? route
    : paymentIdOf(route) !== null
      ? "terminal"
      : route === supportRoute
        ? "settings"
        : null;

/** Routes by where the device stands with its account. */
export function AppShell() {
  const session = useSession();
  return session._tag === "SignedIn" ? (
    <SignedIn />
  ) : (
    <Routed
      state={session._tag === "Opening" ? "opening" : "signedOut"}
      shop={null}
    />
  );
}

function SignedIn() {
  const shop = useShopProfile();
  const hydrated = useAccountHydrated();
  const state: AccountState =
    shop === undefined
      ? "opening"
      : shop !== null
        ? "ready"
        : hydrated
          ? "noShop"
          : "syncing";
  return (
    <>
      <PaidBannerHost />
      <Routed state={state} shop={shop ?? null} />
    </>
  );
}

function Routed({
  state,
  shop,
}: {
  readonly state: AccountState;
  readonly shop: ShopProfile | null;
}) {
  const route = useRoute();
  const resolved = resolveRoute(route, state);
  useEffect(() => {
    if (resolved !== route) replaceRoute(resolved);
  }, [resolved, route]);
  return <RouteScreen route={resolved} state={state} shop={shop} />;
}

function RouteScreen({
  route,
  state,
  shop,
}: {
  readonly route: Route;
  readonly state: AccountState;
  readonly shop: ShopProfile | null;
}) {
  // Setup and restore show their own progress while the account opens.
  if (route === "setup") return <SetupScreen />;
  if (route === "restore") return <RestoreScreen />;
  if (state === "opening") return <LoadingState label={copy.loading} />;
  const section = shop === null ? null : sectionOf(route);
  if (shop !== null && section !== null) {
    return (
      <Navigated
        section={section}
        shop={shop}
        tabs={isSection(route) && route !== "terminal"}
      >
        <SignedInScreen route={route} shop={shop} />
      </Navigated>
    );
  }
  return route === "restoring" ? <RestoringScreen /> : <WelcomeScreen />;
}

function SignedInScreen({
  route,
  shop,
}: {
  readonly route: Route;
  readonly shop: ShopProfile;
}) {
  const paymentId = paymentIdOf(route);
  if (paymentId !== null) {
    return <PaymentScreen paymentId={paymentId} shop={shop} />;
  }
  switch (route) {
    case "terminal":
      return <TerminalScreen />;
    case "history":
      return <HistoryScreen />;
    case "wallet":
      return <WalletScreen shop={shop} />;
    case "settings":
      return <SettingsScreen shop={shop} />;
    default:
      return <SupportChatScreen />;
  }
}

/**
 * Wide screens always show the rail, with `section` lit. Phones show bottom
 * tabs only where `tabs` asks for them: the terminal, a payment and the
 * support chat stand alone there.
 */
function Navigated({
  section,
  shop,
  tabs,
  children: body,
}: {
  readonly section: Section;
  readonly shop: ShopProfile;
  readonly tabs: boolean;
  readonly children: ReactNode;
}) {
  const { wide } = useMedia();
  if (wide) {
    return (
      <Row flex={1} gap="$none" alignItems="stretch">
        <NavigationRail
          accessibilityLabel={copy.navigation}
          header={
            shop.picture === null ? (
              <Image
                src="/logo-tile.webp"
                width={44}
                height={44}
                borderRadius={12}
                aria-hidden
              />
            ) : (
              <Avatar name={shop.name ?? ""} uri={shop.picture} icon="Store" />
            )
          }
          items={navItems.filter((item) => item.value !== "settings")}
          footerItems={navItems.filter((item) => item.value === "settings")}
          value={section}
          onValueChange={navigateTo}
        />
        <Stack flex={1} gap="$none" minWidth={0}>
          {body}
        </Stack>
      </Row>
    );
  }
  if (!tabs) return body;
  return (
    <Stack flex={1} gap="$none" minHeight={0}>
      <Stack flex={1} gap="$none" minHeight={0}>
        {body}
      </Stack>
      <Stack data-safe-area="bottom" backgroundColor="$surface">
        <TabBar
          accessibilityLabel={copy.navigation}
          items={navItems}
          value={section}
          onValueChange={navigateTo}
        />
      </Stack>
    </Stack>
  );
}
