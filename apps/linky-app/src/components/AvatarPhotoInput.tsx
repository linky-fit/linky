import {
  Button,
  Dialog,
  ImageCropPreview,
  Row,
  SliderField,
} from "@linky-fit/ui";
import type { ImageCropCenter } from "@linky-fit/ui";
import React from "react";
import type { Translate } from "../i18n";
import { createSquareAvatarDataUrl } from "../utils/image";
import type { FilePickerHandle } from "../utils/pickFile";
import { pickFile } from "../utils/pickFile";

interface PendingPhoto {
  file: File;
  height: number;
  objectUrl: string;
  width: number;
}

interface AvatarPhotoInputProps {
  inputRef: React.Ref<FilePickerHandle>;
  onError: (error: unknown) => void;
  onSelected: (dataUrl: string) => void;
  t: Translate;
}

const loadPhoto = async (file: File): Promise<PendingPhoto> => {
  if (!file.type.startsWith("image/")) throw new Error("Unsupported file");

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Image load failed"));
      element.src = objectUrl;
    });
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) throw new Error("Invalid image");
    return { file, height, objectUrl, width };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
};

/** Picks a photo and lets the user crop it to a square avatar. */
export function AvatarPhotoInput({
  inputRef,
  onError,
  onSelected,
  t,
}: AvatarPhotoInputProps): React.ReactElement {
  const [pendingPhoto, setPendingPhoto] = React.useState<PendingPhoto | null>(
    null,
  );
  const [center, setCenter] = React.useState<ImageCropCenter>({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState(1);
  const [isSaving, setIsSaving] = React.useState(false);

  const closeCrop = React.useCallback(() => {
    setPendingPhoto((current) => {
      if (current) URL.revokeObjectURL(current.objectUrl);
      return null;
    });
    setIsSaving(false);
  }, []);

  React.useEffect(
    () => () => {
      if (pendingPhoto) URL.revokeObjectURL(pendingPhoto.objectUrl);
    },
    [pendingPhoto],
  );

  const constrainCenter = (next: ImageCropCenter, nextZoom: number) => {
    if (!pendingPhoto) return next;
    const halfSide =
      Math.min(pendingPhoto.width, pendingPhoto.height) / nextZoom / 2;
    return {
      x: Math.min(pendingPhoto.width - halfSide, Math.max(halfSide, next.x)),
      y: Math.min(pendingPhoto.height - halfSide, Math.max(halfSide, next.y)),
    };
  };

  const handleFile = async (file: File) => {
    try {
      const photo = await loadPhoto(file);
      if (photo.width === photo.height) {
        URL.revokeObjectURL(photo.objectUrl);
        onSelected(await createSquareAvatarDataUrl(file));
        return;
      }
      setCenter({ x: photo.width / 2, y: photo.height / 2 });
      setZoom(1);
      setPendingPhoto(photo);
    } catch (error) {
      onError(error);
    }
  };

  React.useImperativeHandle(inputRef, () => ({
    pick: () =>
      void pickFile("image/*").then((file) => file && handleFile(file)),
  }));

  const saveCrop = async () => {
    if (!pendingPhoto || isSaving) return;
    setIsSaving(true);
    try {
      const dataUrl = await createSquareAvatarDataUrl(pendingPhoto.file, {
        centerX: center.x,
        centerY: center.y,
        zoom,
      });
      onSelected(dataUrl);
      closeCrop();
    } catch (error) {
      setIsSaving(false);
      onError(error);
    }
  };

  return (
    <Dialog
      open={pendingPhoto !== null}
      onOpenChange={(open) => {
        if (!open) closeCrop();
      }}
      title={t("avatarCropTitle")}
      description={t("avatarCropHelp")}
      actions={
        <Row gap="$sm">
          <Button flex={1} loading={isSaving} onPress={() => void saveCrop()}>
            {t("avatarCropConfirm")}
          </Button>
          <Button
            flex={1}
            variant="secondary"
            disabled={isSaving}
            onPress={closeCrop}
          >
            {t("cancel")}
          </Button>
        </Row>
      }
    >
      {pendingPhoto ? (
        <>
          <ImageCropPreview
            uri={pendingPhoto.objectUrl}
            accessibilityLabel={t("avatarCropTitle")}
            imageWidth={pendingPhoto.width}
            imageHeight={pendingPhoto.height}
            center={center}
            zoom={zoom}
            onCenterChange={setCenter}
            disabled={isSaving}
          />
          <SliderField
            label={t("avatarCropZoom")}
            value={zoom}
            min={1}
            max={3}
            step={0.01}
            disabled={isSaving}
            onValueChange={(nextZoom) => {
              setZoom(nextZoom);
              setCenter((current) => constrainCenter(current, nextZoom));
            }}
          />
        </>
      ) : null}
    </Dialog>
  );
}
