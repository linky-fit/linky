import { NavigationRail, Pressable } from "@linky-fit/ui";
import React from "react";
import {
  useAppShellActions,
  useAppShellCore,
} from "../app/context/AppShellContexts";
import {
  getDesktopRouteSection,
  getDesktopSectionRoute,
} from "../app/routes/desktopRouteSection";
import { navigateTo } from "../hooks/useRouting";
import { formatShortNpub } from "../utils/formatting";
import { OwnAvatar } from "./OwnSupporter";

export function DesktopNavigation(): React.ReactElement {
  const actions = useAppShellActions();
  const state = useAppShellCore();
  const { t } = state;

  return (
    <NavigationRail
      accessibilityLabel={t("menu")}
      header={
        <Pressable
          borderRadius="$pill"
          aria-label={t("profile")}
          onPress={actions.openProfileQr}
        >
          <OwnAvatar
            name={
              state.effectiveProfileName ??
              (state.currentNpub ? formatShortNpub(state.currentNpub) : "?")
            }
            uri={state.effectiveProfilePicture ?? undefined}
          />
        </Pressable>
      }
      items={[
        { value: "contacts", label: t("contactsTitle"), icon: "Users" },
        { value: "wallet", label: t("wallet"), icon: "Wallet" },
        { value: "proxy", label: t("proxyPayments"), icon: "HandCoins" },
      ]}
      footerItems={[
        { value: "settings", label: t("settings"), icon: "Settings" },
      ]}
      value={getDesktopRouteSection(state.route)}
      onValueChange={(section) =>
        navigateTo({ route: getDesktopSectionRoute(section) })
      }
    />
  );
}
