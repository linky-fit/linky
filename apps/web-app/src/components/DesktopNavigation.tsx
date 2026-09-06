import {
  Users as ContactsIcon,
  Settings,
  Wallet as WalletIcon,
} from "lucide-react";
import React from "react";
import {
  useAppShellActions,
  useAppShellCore,
} from "../app/context/AppShellContexts";
import { getDesktopRouteSection } from "../app/routes/desktopRouteSection";
import { navigateTo } from "../hooks/useRouting";
import { formatShortNpub, getInitials } from "../utils/formatting";
import { Avatar } from "./Avatar";

export function DesktopNavigation(): React.ReactElement {
  const actions = useAppShellActions();
  const state = useAppShellCore();

  const activeSection = getDesktopRouteSection(state.route);
  const profileInitials = getInitials(
    state.effectiveProfileName ??
      (state.currentNpub ? formatShortNpub(state.currentNpub) : "?"),
  );

  return (
    <nav className="desktop-navigation" aria-label={state.t("menu")}>
      <button
        type="button"
        className="desktop-navigation-profile"
        onClick={actions.openProfileQr}
        aria-label={state.t("profile")}
        title={state.t("profile")}
      >
        <Avatar
          pictureUrl={state.effectiveProfilePicture}
          fallback={profileInitials}
          fallbackClassName=""
        />
      </button>

      <div className="desktop-navigation-main">
        <button
          type="button"
          className={`desktop-navigation-item${activeSection === "contacts" ? " is-active" : ""}`}
          onClick={() => navigateTo({ route: "contacts" })}
          aria-current={activeSection === "contacts" ? "page" : undefined}
        >
          <ContactsIcon size={23} />
          <span>{state.t("contactsTitle")}</span>
        </button>

        <button
          type="button"
          className={`desktop-navigation-item${activeSection === "wallet" ? " is-active" : ""}`}
          onClick={() => navigateTo({ route: "wallet" })}
          aria-current={activeSection === "wallet" ? "page" : undefined}
        >
          <WalletIcon size={23} />
          <span>{state.t("wallet")}</span>
        </button>
      </div>

      <button
        type="button"
        className={`desktop-navigation-item desktop-navigation-settings${activeSection === "settings" ? " is-active" : ""}`}
        onClick={() => navigateTo({ route: "settings" })}
        aria-current={activeSection === "settings" ? "page" : undefined}
      >
        <Settings size={23} />
        <span>{state.t("settings")}</span>
      </button>
    </nav>
  );
}
