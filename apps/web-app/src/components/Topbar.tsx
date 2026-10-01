import {
  Eye,
  EyeOff,
  Filter as FilterIcon,
  Pencil as EditIcon,
  ScanLine,
  Settings,
} from "lucide-react";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import {
  getDesktopRouteSection,
  isDesktopSectionEntryRoute,
} from "../app/routes/desktopRouteSection";
import { navigateTo } from "../hooks/useRouting";
import { getInitials } from "../utils/formatting";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";
import { Avatar } from "./Avatar";

interface TopbarProps {
  className?: string;
  desktopDetail?: boolean;
}

export function Topbar({
  className = "",
  desktopDetail = false,
}: TopbarProps): React.ReactElement {
  const state = useAppShellCore();

  const desktopTopbar = isDesktopSectionEntryRoute(state.route)
    ? {
        icon: "×",
        label: state.t("close"),
        onClick: () =>
          navigateTo({ route: getDesktopRouteSection(state.route) }),
      }
    : state.route.kind === "cashuTokenEmit"
      ? {
          icon: "<",
          label: state.t("back"),
          onClick: () => navigateTo({ route: "cashuTokens" }),
        }
      : state.topbar;
  const desktopTopbarRight =
    state.topbarRight?.icon === "filter" ? null : state.topbarRight;

  const { chatTopbarContact, nostrPictureByNpub, t, topbarTitle } = state;
  const topbar = desktopDetail ? desktopTopbar : state.topbar;
  const topbarRight = desktopDetail ? desktopTopbarRight : state.topbarRight;
  const canOpenChatContact = Boolean(chatTopbarContact?.contactId);

  return (
    <div className={className}>
      <header className="topbar">
        <div className="topbar-left">
          {topbar ? (
            <button
              className="topbar-btn"
              onClick={topbar.onClick}
              aria-label={topbar.label}
              title={topbar.label}
            >
              <span aria-hidden="true">{topbar.icon}</span>
            </button>
          ) : (
            <span className="topbar-spacer" aria-hidden="true" />
          )}
        </div>

        {chatTopbarContact ? (
          <button
            type="button"
            className="topbar-chat topbar-chat-button"
            aria-label={canOpenChatContact ? t("contact") : t("messagesTitle")}
            disabled={!canOpenChatContact}
            onClick={() => {
              const contactId = chatTopbarContact.contactId;
              if (!contactId) return;
              navigateTo({ route: "contact", id: contactId });
            }}
          >
            <span className="topbar-chat-avatar" aria-hidden="true">
              {(() => {
                const npub = normalizeNpubIdentifier(
                  chatTopbarContact.npub ?? "",
                );
                const url = npub ? nostrPictureByNpub[npub] : null;
                return (
                  <Avatar
                    pictureUrl={url}
                    fallback={getInitials(chatTopbarContact.name ?? "")}
                    fallbackClassName="topbar-chat-avatar-fallback"
                    loading="lazy"
                  />
                );
              })()}
            </span>
            <span className="topbar-chat-name">
              {(chatTopbarContact.name ?? "").trim() || t("messagesTitle")}
            </span>
          </button>
        ) : topbarTitle ? (
          <div className="topbar-title" aria-label={topbarTitle}>
            {topbarTitle}
          </div>
        ) : (
          <span className="topbar-title-spacer" aria-hidden="true" />
        )}

        {topbarRight ? (
          <button
            className={
              topbarRight.isActive ? "topbar-btn is-active" : "topbar-btn"
            }
            onClick={topbarRight.onClick}
            aria-label={topbarRight.label}
            title={topbarRight.label}
            {...(topbarRight.icon === "scan"
              ? { "data-guide": "scan-contact-button" }
              : {})}
          >
            <span aria-hidden="true">
              {topbarRight.icon === "☰" ? (
                <Settings size={20} />
              ) : topbarRight.icon === "edit" ? (
                <EditIcon size={18} />
              ) : topbarRight.icon === "scan" ? (
                <ScanLine size={20} />
              ) : topbarRight.icon === "filter" ? (
                <FilterIcon size={20} />
              ) : topbarRight.icon === "hidden" ? (
                topbarRight.isActive ? (
                  <Eye size={20} />
                ) : (
                  <EyeOff size={20} />
                )
              ) : (
                topbarRight.icon
              )}
            </span>
          </button>
        ) : (
          <span className="topbar-spacer" aria-hidden="true" />
        )}
      </header>
    </div>
  );
}
