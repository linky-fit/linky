import { Avatar, NavigationRail, Pressable } from "@linky-fit/ui";
import React from "react";
import { useAtomValue } from "@linky-fit/linkstr-react";
import { useEffectiveProfile } from "../app/hooks/profile/useEffectiveProfile";
import { useTranslation } from "../app/hooks/shell";
import { currentNpubAtom } from "../app/state/session/session";
import {
  getDesktopRouteSection,
  getDesktopSectionRoute,
} from "../app/routes/desktopRouteSection";
import { navigateTo, useRouting } from "../hooks/useRouting";
import { formatShortNpub } from "../utils/formatting";

export function DesktopNavigation(): React.ReactElement {
  const route = useRouting();
  const { t } = useTranslation();
  const currentNpub = useAtomValue(currentNpubAtom);
  const { effectiveProfileName, effectiveProfilePicture } =
    useEffectiveProfile();

  return (
    <NavigationRail
      accessibilityLabel={t("menu")}
      header={
        <Pressable
          borderRadius="$pill"
          aria-label={t("profile")}
          onPress={() => navigateTo({ route: "profile" })}
        >
          <Avatar
            name={
              effectiveProfileName ??
              (currentNpub ? formatShortNpub(currentNpub) : "?")
            }
            uri={effectiveProfilePicture ?? undefined}
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
      value={getDesktopRouteSection(route)}
      onValueChange={(section) =>
        navigateTo({ route: getDesktopSectionRoute(section) })
      }
    />
  );
}
