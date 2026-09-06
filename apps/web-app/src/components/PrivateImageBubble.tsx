import { useLatest } from "../hooks/useLatest";
import { Download, Share2 as ShareIcon } from "lucide-react";
import React from "react";
import {
  downloadPrivateImageBlob,
  isCancelledShareError,
  sharePrivateImageBlob,
} from "../app/lib/privateImageFile";
import {
  decryptPrivateImageMessage,
  type PrivateImageMessagePayload,
} from "../app/lib/privateImageMessage";

import type { Translate } from "../i18n";

interface PrivateImageBubbleProps {
  onBlobChange: (blob: Blob | null) => void;
  payload: PrivateImageMessagePayload;
  rumorId: string | null;
  t: Translate;
}

export function PrivateImageBubble({
  onBlobChange,
  payload,
  rumorId,
  t,
}: PrivateImageBubbleProps) {
  const placeholderRef = React.useRef<HTMLDivElement | null>(null);
  const [shouldLoad, setShouldLoad] = React.useState(
    typeof IntersectionObserver === "undefined",
  );
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const [imageBlob, setImageBlob] = React.useState<Blob | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [viewerErrorText, setViewerErrorText] = React.useState<string | null>(
    null,
  );

  const onBlobChangeRef = useLatest(onBlobChange);

  React.useEffect(() => {
    if (shouldLoad || typeof IntersectionObserver === "undefined") return;
    const element = placeholderRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "240px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldLoad]);

  React.useEffect(() => {
    if (!shouldLoad) return;
    let cancelled = false;
    let objectUrl: string | null = null;

    setImageUrl(null);
    setImageBlob(null);
    onBlobChangeRef.current(null);
    setFailed(false);
    setViewerOpen(false);
    setViewerErrorText(null);

    void decryptPrivateImageMessage(payload)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImageBlob(blob);
        onBlobChangeRef.current(blob);
        setImageUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [payload, shouldLoad, onBlobChangeRef]);

  React.useEffect(() => {
    if (!viewerOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setViewerOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewerOpen]);

  const openViewer = () => {
    setViewerErrorText(null);
    setViewerOpen(true);
  };

  const closeViewer = () => {
    setViewerOpen(false);
    setViewerErrorText(null);
  };

  const exportLinks = rumorId ? { rumor: rumorId } : {};

  const saveImage = () => {
    if (!imageBlob) return;
    downloadPrivateImageBlob(imageBlob, exportLinks);
  };

  const shareImage = async () => {
    if (!imageBlob) return;

    setViewerErrorText(null);
    try {
      await sharePrivateImageBlob(
        imageBlob,
        t("chatImageMessage"),
        exportLinks,
      );
    } catch (error) {
      if (isCancelledShareError(error)) return;
      setViewerErrorText(t("shareUnavailable"));
    }
  };

  if (failed) {
    return (
      <div className="chat-private-image-placeholder is-error">
        {t("chatImageLoadFailed")}
      </div>
    );
  }

  if (!imageUrl) {
    return (
      <div
        ref={placeholderRef}
        className="chat-private-image-placeholder"
        style={
          payload.width && payload.height
            ? { aspectRatio: `${payload.width} / ${payload.height}` }
            : undefined
        }
      >
        {shouldLoad ? (
          <>
            <span className="btn-spinner" aria-hidden="true" />
            <span>{t("chatImageDecrypting")}</span>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="chat-private-image-button"
        onClick={openViewer}
        aria-label={t("chatImageOpen")}
      >
        <img
          className="chat-private-image"
          src={imageUrl}
          alt={t("chatImageMessage")}
          width={payload.width}
          height={payload.height}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      </button>

      {viewerOpen && imageBlob ? (
        <div
          className="chat-image-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={t("chatImageMessage")}
          onClick={closeViewer}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div
            className="chat-image-viewer-toolbar"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="topbar-btn chat-image-viewer-back"
              onClick={closeViewer}
              aria-label={t("chatImageBackToChat")}
              title={t("chatImageBackToChat")}
            >
              <span aria-hidden="true">&lt;</span>
            </button>
          </div>

          <div className="chat-image-viewer-stage">
            <img
              className="chat-image-viewer-image"
              src={imageUrl}
              alt={t("chatImageMessage")}
              width={payload.width}
              height={payload.height}
              decoding="async"
              referrerPolicy="no-referrer"
              onClick={(event) => event.stopPropagation()}
            />
          </div>

          <div
            className="chat-image-viewer-footer"
            onClick={(event) => event.stopPropagation()}
          >
            {viewerErrorText ? (
              <div className="chat-image-viewer-error" role="status">
                {viewerErrorText}
              </div>
            ) : null}
            <div className="chat-image-viewer-actions">
              <button
                type="button"
                className="chat-image-viewer-action"
                onClick={(event) => {
                  event.stopPropagation();
                  saveImage();
                }}
              >
                <span className="btn-label-with-icon">
                  <span className="btn-label-icon" aria-hidden="true">
                    <Download size={20} />
                  </span>
                  <span>{t("chatImageSave")}</span>
                </span>
              </button>
              <button
                type="button"
                className="chat-image-viewer-action"
                onClick={(event) => {
                  event.stopPropagation();
                  void shareImage();
                }}
              >
                <span className="btn-label-with-icon">
                  <span className="btn-label-icon" aria-hidden="true">
                    <ShareIcon size={20} />
                  </span>
                  <span>{t("share")}</span>
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
