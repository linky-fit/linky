import {
  DocumentPages,
  FileAttachment,
  ImageAttachment,
  Spinner,
  Stack,
  Text,
} from "@linky-fit/ui";
import { useDivRef } from "../hooks/useDivRef";
import { useLatest } from "../hooks/useLatest";
import React from "react";
import {
  renderPdfPages,
  revokePdfPages,
  type RenderedPdfPage,
} from "../app/lib/pdfPreview";
import {
  downloadPrivateImageBlob,
  sharePrivateImageBlob,
} from "../app/lib/privateImageFile";
import { isCancelledShareError } from "../platform/fileExport";
import {
  decryptPrivateImageMessage,
  type PrivateImageMessagePayload,
} from "../app/lib/privateImageMessage";

import type { Translate } from "../i18n";
import { AttachmentViewer } from "./AttachmentViewer";

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
  const placeholderNodeRef = useDivRef(placeholderRef);
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

    return () => {
      cancelled = true;
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
      <Text variant="caption" color="$dangerText">
        {t("chatPdfLoadFailed")}
      </Text>
    );
  }

  if (!shouldLoad) {
    return (
      <Stack ref={placeholderNodeRef} aria-busy>
        <FileAttachment name={fileName} meta={t("chatPdfMessage")} />
      </Stack>
    );
  }

  return (
    <>
      {preview ? (
        <Stack width="$qr" maxWidth="100%" testID="chat-pdf-preview">
          <ImageAttachment
            uri={preview.url}
            accessibilityLabel={t("chatPdfOpen")}
            errorLabel={t("chatPdfLoadFailed")}
            aspectRatio={preview.width / preview.height}
            onPress={openViewer}
          />
          <Stack
            position="absolute"
            left="$sm"
            bottom="$sm"
            maxWidth="90%"
            pointerEvents="none"
          >
            <Text
              variant="caption"
              bold
              numberOfLines={1}
              paddingHorizontal="$sm"
              paddingVertical="$xxs"
              borderRadius="$pill"
              overflow="hidden"
              backgroundColor="$surfaceRaised"
            >
              {fileName}
            </Text>
          </Stack>
        </Stack>
      ) : (
        <FileAttachment
          name={fileName}
          meta={
            fileBlob
              ? `${t("chatPdfMessage")} · ${formatFileSize(fileBlob.size)}`
              : t("chatPdfDecrypting")
          }
          loading={!fileBlob}
          onPress={openViewer}
        />
      )}

      <AttachmentViewer
        open={viewerOpen && fileBlob !== null}
        onClose={closeViewer}
        title={fileName}
        backLabel={t("chatImageBackToChat")}
        errorText={viewerErrorText}
        actions={[
          { icon: "Download", label: t("chatPdfSave"), onPress: saveFile },
          {
            icon: "Share2",
            label: t("share"),
            onPress: () => void shareFile(),
          },
        ]}
      >
        {viewerPages ? (
          <Stack
            flex={1}
            width="100%"
            onClick={(event: React.MouseEvent) => event.stopPropagation()}
          >
            <DocumentPages
              pages={viewerPages.map((page, index) => ({
                uri: page.url,
                accessibilityLabel: `${fileName} ${index + 1}`,
                width: page.width,
                height: page.height,
              }))}
            />
          </Stack>
        ) : viewerErrorText ? null : (
          <Spinner accessibilityLabel={t("chatPdfDecrypting")} />
        )}
      </AttachmentViewer>
    </>
  );
}
