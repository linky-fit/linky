import React from "react";
import type { AvatarEditorControlId } from "../derivedProfile";
import type { Translate } from "../i18n";
import { formatShortNpub, getInitials } from "../utils/formatting";
import { Avatar } from "./Avatar";
import { AvatarControlGrid } from "./AvatarControlGrid";
import { AvatarPhotoInput } from "./AvatarPhotoInput";

interface ProfileAvatarEditorProps {
  currentNpub: string;
  cycleProfileAvatarControl: (controlId: AvatarEditorControlId) => void;
  effectiveProfileName: string | null;
  effectiveProfilePicture: string | null;
  onProfilePhotoError: (error: unknown) => void;
  onPickProfilePhoto: () => void;
  onProfilePhotoSelected: (dataUrl: string) => void;
  profileCustomPictureUrl: string;
  profileEditName: string;
  profileEditPicture: string;
  profilePhotoInputRef: React.RefObject<HTMLInputElement | null>;
  profileSelectedPictureKind: "custom" | "generated";
  t: Translate;
}

export function ProfileAvatarEditor({
  currentNpub,
  cycleProfileAvatarControl,
  effectiveProfileName,
  effectiveProfilePicture,
  onProfilePhotoError,
  onPickProfilePhoto,
  onProfilePhotoSelected,
  profileCustomPictureUrl,
  profileEditName,
  profileEditPicture,
  profilePhotoInputRef,
  profileSelectedPictureKind,
  t,
}: ProfileAvatarEditorProps): React.ReactElement {
  const previewPicture = profileEditPicture || effectiveProfilePicture;
  const previewName =
    profileEditName.trim() ||
    effectiveProfileName ||
    formatShortNpub(currentNpub);

  return (
    <div className="profile-avatar-editor">
      <div className="onboarding-avatar-preview">
        <div
          className="contact-avatar is-xl onboarding-avatar-previewImage"
          aria-hidden="true"
        >
          <Avatar
            pictureUrl={previewPicture}
            fallback={getInitials(previewName)}
            fallbackClassName="contact-avatar-fallback"
            loading="lazy"
          />
        </div>
      </div>

      <AvatarPhotoInput
        inputRef={profilePhotoInputRef}
        onError={onProfilePhotoError}
        onSelected={onProfilePhotoSelected}
        t={t}
      />

      <AvatarControlGrid
        custom={{
          isSelected: profileSelectedPictureKind === "custom",
          onPick: onPickProfilePhoto,
          pictureUrl: profileCustomPictureUrl,
        }}
        onCycle={cycleProfileAvatarControl}
        t={t}
      />
    </div>
  );
}
