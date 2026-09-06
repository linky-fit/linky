import React from "react";
import type { Translate } from "../i18n";
import { createSquareAvatarDataUrl } from "../utils/image";
import { ModalSheet } from "./ModalSheet";

interface PendingPhoto {
  file: File;
  height: number;
  objectUrl: string;
  width: number;
}

interface AvatarPhotoInputProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
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

export function AvatarPhotoInput({
  inputRef,
  onError,
  onSelected,
  t,
}: AvatarPhotoInputProps): React.ReactElement {
  const [pendingPhoto, setPendingPhoto] = React.useState<PendingPhoto | null>(
    null,
  );
  const [center, setCenter] = React.useState({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState(1);
  const [isSaving, setIsSaving] = React.useState(false);
  const [viewportSize, setViewportSize] = React.useState(280);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);

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

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateSize = () =>
      setViewportSize(viewport.getBoundingClientRect().width);
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [pendingPhoto]);

  const constrainCenter = React.useCallback(
    (next: { x: number; y: number }, nextZoom: number) => {
      if (!pendingPhoto) return next;
      const side = Math.min(pendingPhoto.width, pendingPhoto.height) / nextZoom;
      const halfSide = side / 2;
      return {
        x: Math.min(pendingPhoto.width - halfSide, Math.max(halfSide, next.x)),
        y: Math.min(pendingPhoto.height - halfSide, Math.max(halfSide, next.y)),
      };
    },
    [pendingPhoto],
  );

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;

    try {
      const photo = await loadPhoto(file);
      if (photo.width === photo.height) {
        URL.revokeObjectURL(photo.objectUrl);
        onSelected(await createSquareAvatarDataUrl(file, 160));
        return;
      }
      setCenter({ x: photo.width / 2, y: photo.height / 2 });
      setZoom(1);
      setPendingPhoto(photo);
    } catch (error) {
      onError(error);
    }
  };

  const saveCrop = async () => {
    if (!pendingPhoto || isSaving) return;
    setIsSaving(true);
    try {
      const dataUrl = await createSquareAvatarDataUrl(pendingPhoto.file, 160, {
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

  const imageScale = pendingPhoto
    ? Math.max(
        viewportSize / pendingPhoto.width,
        viewportSize / pendingPhoto.height,
      ) * zoom
    : 1;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={(event) => void handleFileChange(event)}
        className="hidden-input"
      />

      {pendingPhoto ? (
        <ModalSheet
          className="modal-overlay avatar-crop-overlay"
          aria-label={t("avatarCropTitle")}
          onClick={closeCrop}
          sheetClassName="modal-sheet avatar-crop-sheet"
        >
          <div className="modal-title">{t("avatarCropTitle")}</div>
          <p className="modal-body avatar-crop-help">{t("avatarCropHelp")}</p>
          <div
            ref={viewportRef}
            className="avatar-crop-viewport"
            onPointerDown={(event) => {
              dragRef.current = {
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current;
              if (!drag || drag.pointerId !== event.pointerId) return;
              const dx = event.clientX - drag.x;
              const dy = event.clientY - drag.y;
              dragRef.current = {
                ...drag,
                x: event.clientX,
                y: event.clientY,
              };
              setCenter((current) =>
                constrainCenter(
                  {
                    x: current.x - dx / imageScale,
                    y: current.y - dy / imageScale,
                  },
                  zoom,
                ),
              );
            }}
            onPointerUp={(event) => {
              if (dragRef.current?.pointerId === event.pointerId) {
                dragRef.current = null;
              }
            }}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
          >
            <img
              src={pendingPhoto.objectUrl}
              alt=""
              draggable={false}
              style={{
                height: pendingPhoto.height * imageScale,
                left: viewportSize / 2 - center.x * imageScale,
                top: viewportSize / 2 - center.y * imageScale,
                width: pendingPhoto.width * imageScale,
              }}
            />
            <span className="avatar-crop-frame" aria-hidden="true" />
          </div>
          <label className="avatar-crop-zoom">
            <span>{t("avatarCropZoom")}</span>
            <input
              type="range"
              min="1"
              max="3"
              step="0.01"
              value={zoom}
              onChange={(event) => {
                const nextZoom = Number(event.target.value);
                setZoom(nextZoom);
                setCenter((current) => constrainCenter(current, nextZoom));
              }}
            />
          </label>
          <div className="modal-actions avatar-crop-actions">
            <button
              type="button"
              className="btn-wide"
              disabled={isSaving}
              onClick={() => void saveCrop()}
            >
              {isSaving ? t("saving") : t("avatarCropConfirm")}
            </button>
            <button
              type="button"
              className="btn-wide secondary"
              disabled={isSaving}
              onClick={closeCrop}
            >
              {t("cancel")}
            </button>
          </div>
        </ModalSheet>
      ) : null}
    </>
  );
}
