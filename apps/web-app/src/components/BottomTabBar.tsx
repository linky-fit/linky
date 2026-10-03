import { Avatar, Stack, TabBar } from "@linky-fit/ui";
import type { NavItem } from "@linky-fit/ui";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { navigateTo } from "../hooks/useRouting";
import type { Translate } from "../i18n";
import { formatShortNpub } from "../utils/formatting";

export type BottomTabKey =
  | "profile"
  | "contacts"
  | "wallet"
  | "proxy"
  | "settings";

const TAB_ROUTE = {
  contacts: "contacts",
  profile: "profile",
  proxy: "proxyPayments",
  settings: "settings",
  wallet: "wallet",
} as const;

interface BottomTabBarProps {
  activeTab: BottomTabKey;
  t: Translate;
}

export function BottomTabBar({
  activeTab,
  t,
}: BottomTabBarProps): React.ReactElement {
  const { currentNpub, effectiveProfileName, effectiveProfilePicture } =
    useAppShellCore();

  const items: NavItem<BottomTabKey>[] = [
    {
      value: "profile",
      label: t("profile"),
      testID: "profile-qr-button",
      leading: (
        <Avatar
          name={
            effectiveProfileName ??
            (currentNpub ? formatShortNpub(currentNpub) : "?")
          }
          uri={effectiveProfilePicture ?? undefined}
          size="xs"
        />
      ),
    },
    { value: "contacts", label: t("contactsTitle"), icon: "Users" },
    { value: "wallet", label: t("wallet"), icon: "Wallet" },
    { value: "proxy", label: t("proxyPayments"), icon: "HandCoins" },
    {
      value: "settings",
      label: t("settings"),
      icon: "Settings",
      testID: "open-menu",
    },
  ];

  const changeTab = (tab: BottomTabKey) => {
    if (tab === activeTab) return;
    navigateTo({ route: TAB_ROUTE[tab] });
  };

  return (
    <Stack backgroundColor="$surface" data-safe-area="bottom">
      <TabBar
        accessibilityLabel={t("list")}
        items={items}
        value={activeTab}
        onValueChange={changeTab}
      />
    </Stack>
  );
}
