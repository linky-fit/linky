import { Avatar, TabBar, SafeAreaPad } from "@linky-fit/ui";
import type { NavItem } from "@linky-fit/ui";
import React from "react";
import { useAtomValue } from "@linky-fit/linkstr-react";
import { useEffectiveProfile } from "../app/hooks/profile/useEffectiveProfile";
import { currentNpubAtom } from "../app/state/session/session";
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
  const currentNpub = useAtomValue(currentNpubAtom);
  const { effectiveProfileName, effectiveProfilePicture } =
    useEffectiveProfile();

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
    {
      value: "wallet",
      label: t("wallet"),
      icon: "Wallet",
      testID: "open-wallet",
    },
    {
      value: "proxy",
      label: t("proxyPayments"),
      icon: "HandCoins",
      testID: "open-proxy",
    },
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
    <SafeAreaPad backgroundColor="$surface" edge="bottom">
      <TabBar
        accessibilityLabel={t("list")}
        items={items}
        value={activeTab}
        onValueChange={changeTab}
      />
    </SafeAreaPad>
  );
}
