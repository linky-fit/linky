import {
  Avatar,
  Button,
  Dialog,
  ImageCropPreview,
  Notice,
  SliderField,
  Stack,
  type ImageCropCenter,
} from "@linky-fit/ui";
import { useEffect, useState } from "react";
import { copy } from "../copy/en";
import type { OperatorProfile } from "../domain/profile";
import {
  cropSquare,
  pickImage,
  releaseImage,
  renderSquare,
  type PickedImage,
} from "../platform/imagePicker";
import type { ImageFile } from "../services/blossom";
import { useAppServices } from "../services/react";

type Problem = "notAnImage" | "failed" | "notPublished";

/** Shows the profile picture and replaces it with a square crop of a picked image, or removes it. */
export function ProfilePictureDialog({
  profile,
  onClose,
}: {
  readonly profile: OperatorProfile;
  readonly onClose: () => void;
}) {
  const services = useAppServices();
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [center, setCenter] = useState<ImageCropCenter>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  useEffect(
    () => (picked === null ? undefined : () => releaseImage(picked)),
    [picked],
  );

  const choose = async () => {
    setProblem(null);
    try {
      const image = await pickImage();
      if (image === null) return;
      setCenter({ x: image.width / 2, y: image.height / 2 });
      setZoom(1);
      setPicked(image);
    } catch {
      setProblem("notAnImage");
    }
  };

  const zoomTo = (image: PickedImage, nextZoom: number) => {
    const square = cropSquare(image.width, image.height, {
      center,
      zoom: nextZoom,
    });
    setZoom(nextZoom);
    setCenter({ x: square.x + square.side / 2, y: square.y + square.side / 2 });
  };

  const apply = async (picture: () => Promise<ImageFile | null>) => {
    setSaving(true);
    setProblem(null);
    try {
      if (await services.profile.setPicture(await picture())) {
        onClose();
        return;
      }
      setPicked(null);
      setProblem("notPublished");
    } catch (failure) {
      console.warn("[onchain-operator] profile picture not saved", failure);
      setProblem("failed");
    }
    setSaving(false);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => (open || saving ? undefined : onClose())}
      title={copy.picture.title}
      description={
        picked === null ? copy.picture.description : copy.picture.cropHelp
      }
      closeLabel={copy.close}
      testID="profile-picture-dialog"
      actions={
        picked === null ? (
          <>
            <Button
              testID="profile-picture-choose"
              onPress={() => void choose()}
            >
              {profile.picture === null
                ? copy.picture.choose
                : copy.picture.change}
            </Button>
            {profile.picture === null ? null : (
              <Button
                testID="profile-picture-remove"
                variant="secondary"
                loading={saving}
                onPress={() => void apply(() => Promise.resolve(null))}
              >
                {copy.picture.remove}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button
              testID="profile-picture-save"
              loading={saving}
              onPress={() =>
                void apply(() => renderSquare(picked, { center, zoom }))
              }
            >
              {copy.settings.save}
            </Button>
            <Button
              variant="secondary"
              disabled={saving}
              onPress={() => setPicked(null)}
            >
              {copy.back}
            </Button>
          </>
        )
      }
    >
      {picked === null ? (
        <Stack alignItems="center">
          <Avatar
            name={profile.name}
            uri={profile.picture ?? undefined}
            size="lg"
          />
        </Stack>
      ) : (
        <>
          <ImageCropPreview
            uri={picked.url}
            accessibilityLabel={copy.picture.title}
            imageWidth={picked.width}
            imageHeight={picked.height}
            center={center}
            zoom={zoom}
            onCenterChange={setCenter}
            disabled={saving}
          />
          <SliderField
            label={copy.picture.zoom}
            value={zoom}
            min={1}
            max={3}
            step={0.01}
            disabled={saving}
            onValueChange={(next) => zoomTo(picked, next)}
          />
        </>
      )}
      {problem === null ? null : (
        <Notice
          tone={problem === "notPublished" ? "warning" : "danger"}
          title={copy.picture[problem]}
        />
      )}
    </Dialog>
  );
}
