import { Stack, TabBar } from "@linky-fit/ui";
import type { NavItem } from "@linky-fit/ui";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { navigateTo } from "../hooks/useRouting";
import type { Translate } from "../i18n";
import { formatShortNpub } from "../utils/formatting";
import { OwnAvatar } from "./OwnSupporter";

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
  activeTab: BottomTabKey | null;
  /** Swipe progress from contacts (0) to wallet (1); the nearer tab is active. */
  activeProgress?: number;
  contactsLabel: string;
  onTabChange?: (tab: "contacts" | "wallet") => void;
  t: Translate;
  walletLabel: string;
}

export function BottomTabBar({
  activeTab,
  activeProgress,
  contactsLabel,
  onTabChange,
  t,
  walletLabel,
}: BottomTabBarProps): React.ReactElement {
  const { currentNpub, effectiveProfileName, effectiveProfilePicture } =
    useAppShellCore();

  const swipeProgress =
    activeProgress === undefined
      ? undefined
      : Math.min(1, Math.max(0, activeProgress));
  const value =
    swipeProgress === undefined
      ? (activeTab ?? undefined)
      : swipeProgress >= 0.5
        ? "wallet"
        : "contacts";

  const items: NavItem<BottomTabKey>[] = [
    {
      value: "profile",
      label: t("profile"),
      testID: "profile-qr-button",
      leading: (
        <OwnAvatar
          name={
            effectiveProfileName ??
            (currentNpub ? formatShortNpub(currentNpub) : "?")
          }
          uri={effectiveProfilePicture ?? undefined}
          size="xs"
        />
      ),
    },
    { value: "contacts", label: contactsLabel, icon: "Users" },
    { value: "wallet", label: walletLabel, icon: "Wallet" },
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
    if (onTabChange && (tab === "contacts" || tab === "wallet")) {
      onTabChange(tab);
      return;
    }
    navigateTo({ route: TAB_ROUTE[tab] });
  };

  return (
    <Stack backgroundColor="$surface" data-safe-area="bottom">
      <TabBar
        accessibilityLabel={t("list")}
        items={items}
        value={value}
        onValueChange={changeTab}
        indicatorPosition={
          swipeProgress === undefined
            ? undefined
            : items.findIndex((item) => item.value === "contacts") +
              swipeProgress
        }
      />
    </Stack>
  );
}
