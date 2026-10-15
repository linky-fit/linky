import { Avatar, Icon, OptionTile, Row, Stack } from "@linky-fit/ui";
import React from "react";
import type { Translate } from "../i18n";
import { formatShortNpub } from "../utils/formatting";
import type { FilePickerHandle } from "../utils/pickFile";
import { AvatarPhotoInput } from "./AvatarPhotoInput";

interface ProfileAvatarEditorProps {
  currentNpub: string;
  shuffleProfileAvatar: () => void;
  effectiveProfileName: string | null;
  effectiveProfilePicture: string | null;
  onProfilePhotoError: (error: unknown) => void;
  onPickProfilePhoto: () => void;
  onProfilePhotoSelected: (dataUrl: string) => void;
  profileCustomPictureUrl: string;
  profileEditName: string;
  profileEditPicture: string;
  profilePhotoInputRef: React.RefObject<FilePickerHandle | null>;
  profileSelectedPictureKind: "custom" | "generated";
  t: Translate;
}

export function ProfileAvatarEditor({
  currentNpub,
  shuffleProfileAvatar,
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
    <Stack gap="$md" marginBottom="$md">
      <Stack alignItems="center">
        <Avatar
          name={previewName}
          uri={previewPicture || undefined}
          size="lg"
        />
      </Stack>

      <AvatarPhotoInput
        inputRef={profilePhotoInputRef}
        onError={onProfilePhotoError}
        onSelected={onProfilePhotoSelected}
        t={t}
      />

      <Row gap="$sm" alignItems="stretch">
        <OptionTile
          flex={1}
          icon="RefreshCcw"
          label={t("shuffleAvatar")}
          selected={profileSelectedPictureKind === "generated"}
          onPress={shuffleProfileAvatar}
        />
        <OptionTile
          flex={1}
          label={t("profileUploadPhoto")}
          leading={
            profileCustomPictureUrl ? (
              <Avatar
                name={t("profileUploadPhoto")}
                uri={profileCustomPictureUrl}
                size="sm"
              />
            ) : (
              <Icon name="Plus" size="lg" />
            )
          }
          selected={profileSelectedPictureKind === "custom"}
          onPress={onPickProfilePhoto}
        />
      </Row>
    </Stack>
  );
}
