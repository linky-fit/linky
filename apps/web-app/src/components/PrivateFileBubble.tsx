import { useLatest } from "../hooks/useLatest";
import { Download, FileText, Share2 as ShareIcon } from "lucide-react";
import React from "react";
import {
  renderPdfPages,
  revokePdfPages,
  type RenderedPdfPage,
} from "../app/lib/pdfPreview";
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

interface PrivateFileBubbleProps {
  onBlobChange: (blob: Blob | null) => void;
  payload: PrivateImageMessagePayload;
  rumorId: string | null;
  t: Translate;
}

const PREVIEW_WIDTH_PX = 260;
const VIEWER_WIDTH_PX = 920;

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function PrivateFileBubble({
  onBlobChange,
  payload,
  rumorId,
  t,
}: PrivateFileBubbleProps) {
  const placeholderRef = React.useRef<HTMLDivElement | null>(null);
  const [shouldLoad, setShouldLoad] = React.useState(
    typeof IntersectionObserver === "undefined",
  );
  const [fileBlob, setFileBlob] = React.useState<Blob | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [preview, setPreview] = React.useState<RenderedPdfPage | null>(null);
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [viewerPages, setViewerPages] = React.useState<
    RenderedPdfPage[] | null
  >(null);
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
    let rendered: RenderedPdfPage[] = [];
    setFileBlob(null);
    onBlobChangeRef.current(null);
    setFailed(false);
    setPreview(null);
    setViewerOpen(false);
    setViewerPages(null);

    void decryptPrivateImageMessage(payload)
      .then(async (blob) => {
        if (cancelled) return;
        setFileBlob(blob);
        onBlobChangeRef.current(blob);
        // Preview is best-effort: a broken PDF still shows the file card.
        rendered = await renderPdfPages(blob, {
          maxPages: 1,
          targetWidth: PREVIEW_WIDTH_PX,
        }).catch(() => []);
        if (cancelled) revokePdfPages(rendered);
        else setPreview(rendered[0] ?? null);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      revokePdfPages(rendered);
    };
  }, [payload, shouldLoad, onBlobChangeRef]);

  React.useEffect(() => {
    if (!viewerOpen || !fileBlob) return;
    let cancelled = false;
    let rendered: RenderedPdfPage[] = [];

    void renderPdfPages(fileBlob, { targetWidth: VIEWER_WIDTH_PX })
      .then((pages) => {
        rendered = pages;
        if (cancelled) revokePdfPages(pages);
        else setViewerPages(pages);
      })
      .catch(() => {
        if (!cancelled) setViewerErrorText(t("chatPdfLoadFailed"));
      });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewerOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      cancelled = true;
      window.removeEventListener("keydown", handleKeyDown);
      revokePdfPages(rendered);
      setViewerPages(null);
    };
  }, [fileBlob, t, viewerOpen]);

  const exportLinks = rumorId ? { rumor: rumorId } : {};
  const fileName = payload.fileName ?? `${t("chatPdfMessage")}.pdf`;

  const openViewer = () => {
    setViewerErrorText(null);
    setViewerOpen(true);
  };

  const closeViewer = () => {
    setViewerOpen(false);
    setViewerErrorText(null);
  };

  const saveFile = () => {
    if (!fileBlob) return;
    downloadPrivateImageBlob(fileBlob, exportLinks, fileName);
  };

  const shareFile = async () => {
    if (!fileBlob) return;
    setViewerErrorText(null);
    try {
      await sharePrivateImageBlob(
        fileBlob,
        t("chatPdfMessage"),
        exportLinks,
        fileName,
      );
    } catch (error) {
      if (isCancelledShareError(error)) return;
      setViewerErrorText(t("shareUnavailable"));
    }
  };

  if (failed) {
    return (
      <div className="chat-private-image-placeholder is-error">
        {t("chatPdfLoadFailed")}
      </div>
    );
  }

  if (!shouldLoad) {
    return (
      <div ref={placeholderRef} className="chat-private-file" aria-busy="true">
        <span className="chat-private-file-icon" aria-hidden="true">
          <FileText size={28} />
        </span>
        <span className="chat-private-file-body">
          <span className="chat-private-file-name">{fileName}</span>
          <span className="chat-private-file-meta">{t("chatPdfMessage")}</span>
        </span>
      </div>
    );
  }

  return (
    <>
      {preview ? (
        <button
          type="button"
          className="chat-private-image-button chat-private-pdf-preview"
          onClick={openViewer}
          aria-label={t("chatPdfOpen")}
          title={t("chatPdfOpen")}
        >
          <img
            src={preview.url}
            alt={fileName}
            width={preview.width}
            height={preview.height}
            decoding="async"
          />
          <span className="chat-private-pdf-badge">{fileName}</span>
        </button>
      ) : (
        <button
          type="button"
          className="chat-private-file"
          onClick={openViewer}
          disabled={!fileBlob}
          aria-label={t("chatPdfOpen")}
          title={t("chatPdfOpen")}
        >
          <span className="chat-private-file-icon" aria-hidden="true">
            <FileText size={28} />
          </span>
          <span className="chat-private-file-body">
            <span className="chat-private-file-name">{fileName}</span>
            <span className="chat-private-file-meta">
              {fileBlob
                ? `${t("chatPdfMessage")} · ${formatFileSize(fileBlob.size)}`
                : t("chatPdfDecrypting")}
            </span>
          </span>
        </button>
      )}

      {viewerOpen && fileBlob ? (
        <div
          className="chat-image-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={fileName}
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

          <div
            className="chat-image-viewer-stage"
            onClick={(event) => event.stopPropagation()}
          >
            {viewerPages ? (
              <div className="chat-pdf-viewer-pages">
                {viewerPages.map((page, index) => (
                  <img
                    key={page.url}
                    src={page.url}
                    alt={`${fileName} ${index + 1}`}
                    width={page.width}
                    height={page.height}
                    decoding="async"
                  />
                ))}
              </div>
            ) : viewerErrorText ? null : (
              <span className="btn-spinner" aria-hidden="true" />
            )}
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
                onClick={saveFile}
              >
                <span className="btn-label-with-icon">
                  <span className="btn-label-icon" aria-hidden="true">
                    <Download size={20} />
                  </span>
                  <span>{t("chatPdfSave")}</span>
                </span>
              </button>
              <button
                type="button"
                className="chat-image-viewer-action"
                onClick={() => void shareFile()}
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
