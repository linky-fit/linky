import React from "react";
import type { Translate } from "../i18n";
import { formatShortNpub, getInitials } from "../utils/formatting";
import { Avatar } from "./Avatar";

interface ProfileShareOverlayProps {
  name: string | null;
  npub: string;
  onClose: () => void;
  pictureUrl: string | null;
  qrSrc: string | null;
  t: Translate;
}

const subscribeScreenOrientation = (onChange: () => void): (() => void) => {
  window.screen.orientation?.addEventListener("change", onChange);
  return () =>
    window.screen.orientation?.removeEventListener("change", onChange);
};

const isScreenUpsideDown = (): boolean =>
  window.screen.orientation?.angle === 180;

/**
 * Full-screen contact card shown while the phone is held top-down towards
 * another person. The content is rotated so they read it upright, unless the
 * OS already rotated the whole screen for them.
 */
export function ProfileShareOverlay({
  name,
  npub,
  onClose,
  pictureUrl,
  qrSrc,
  t,
}: ProfileShareOverlayProps): React.ReactElement {
  const screenUpsideDown = React.useSyncExternalStore(
    subscribeScreenOrientation,
    isScreenUpsideDown,
    () => false,
  );
  const displayName = name ?? formatShortNpub(npub);

  return (
    <div
      className="profile-share-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("myNpubQr")}
      onClick={onClose}
    >
      <div
        className={
          screenUpsideDown
            ? "profile-share-card"
            : "profile-share-card is-flipped"
        }
      >
        <div className="contact-avatar is-xl" aria-hidden="true">
          <Avatar
            pictureUrl={pictureUrl}
            fallback={getInitials(displayName)}
            loading="eager"
          />
        </div>
        <h2 className="contact-detail-name">{displayName}</h2>
        {qrSrc ? (
          <img className="profile-share-qr" src={qrSrc} alt={t("myNpubQr")} />
        ) : (
          <p className="muted profile-share-npub">{npub}</p>
        )}
        <p className="muted">{t("profileShareTapToClose")}</p>
      </div>
    </div>
  );
}
