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
import { copy } from "../copy";
import type { ShopProfile } from "../domain";
import {
  cropSquare,
  pickImage,
  releaseImage,
  renderSquare,
  type PickedImage,
} from "../platform/imagePicker";
import type { ImageFile } from "../services/blossom";
import { useAppServices } from "../services/react";

/** Shows the shop's picture and replaces it with a square crop of a picked image, or removes it. */
export function ShopPictureDialog({
  shop,
  onClose,
}: {
  readonly shop: ShopProfile;
  readonly onClose: () => void;
}) {
  const services = useAppServices();
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [center, setCenter] = useState<ImageCropCenter>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => (picked === null ? undefined : () => releaseImage(picked)),
    [picked],
  );

  const choose = async () => {
    setError(null);
    try {
      const image = await pickImage();
      if (image === null) return;
      setCenter({ x: image.width / 2, y: image.height / 2 });
      setZoom(1);
      setPicked(image);
    } catch {
      setError(copy.shopPicture.notAnImage);
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
    setError(null);
    try {
      await services.shop.setPicture(await picture());
      onClose();
    } catch (failure) {
      console.warn("[fazole] shop picture not saved", failure);
      setError(copy.shopPicture.failed);
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => (open || saving ? undefined : onClose())}
      title={copy.shopPicture.title}
      description={
        picked === null
          ? copy.shopPicture.description
          : copy.shopPicture.cropHelp
      }
      closeLabel={copy.close}
      testID="shop-picture-dialog"
      actions={
        picked === null ? (
          <>
            <Button testID="shop-picture-choose" onPress={() => void choose()}>
              {shop.picture === null
                ? copy.shopPicture.choose
                : copy.shopPicture.change}
            </Button>
            {shop.picture === null ? null : (
              <Button
                testID="shop-picture-remove"
                variant="secondary"
                loading={saving}
                onPress={() => void apply(() => Promise.resolve(null))}
              >
                {copy.shopPicture.remove}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button
              testID="shop-picture-save"
              loading={saving}
              onPress={() =>
                void apply(() => renderSquare(picked, { center, zoom }))
              }
            >
              {copy.save}
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
            name={shop.name}
            uri={shop.picture ?? undefined}
            icon="Store"
            size="lg"
          />
        </Stack>
      ) : (
        <>
          <ImageCropPreview
            uri={picked.url}
            accessibilityLabel={copy.shopPicture.title}
            imageWidth={picked.width}
            imageHeight={picked.height}
            center={center}
            zoom={zoom}
            onCenterChange={setCenter}
            disabled={saving}
          />
          <SliderField
            label={copy.shopPicture.zoom}
            value={zoom}
            min={1}
            max={3}
            step={0.01}
            disabled={saving}
            onValueChange={(next) => zoomTo(picked, next)}
          />
        </>
      )}
      {error === null ? null : <Notice tone="danger" title={error} />}
    </Dialog>
  );
}
