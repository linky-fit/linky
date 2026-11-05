import { useDivRef } from "../hooks/useDivRef";
import { useImageZoom } from "../hooks/useImageZoom";
import { useLatest } from "../hooks/useLatest";
import { usePrivateImageUrl } from "../hooks/usePrivateImageUrl";
import {
  Image,
  ImageAttachment,
  LoadingState,
  Stack,
  Text,
} from "@linky-fit/ui";
import React from "react";
import {
  downloadPrivateImageBlob,
  sharePrivateImageBlob,
} from "../app/lib/privateImageFile";
import { isCancelledShareError } from "../platform/fileExport";
import type { PrivateImageMessagePayload } from "../app/lib/privateImageMessage";

import type { Translate } from "../i18n";
import { AttachmentViewer } from "./AttachmentViewer";

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
  const {
    ref: placeholderNodeRef,
    shouldLoad,
    loaded,
    failed,
  } = usePrivateImageUrl(payload);
  const imageUrl = loaded?.url ?? null;
  const imageBlob = loaded?.blob ?? null;
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [viewerErrorText, setViewerErrorText] = React.useState<string | null>(
    null,
  );

  const onBlobChangeRef = useLatest(onBlobChange);
  const viewerStageRef = React.useRef<HTMLDivElement | null>(null);
  const zoom = useImageZoom(viewerStageRef, viewerOpen);
  const viewerStageNodeRef = useDivRef(viewerStageRef);

  React.useEffect(() => {
    onBlobChangeRef.current(imageBlob);
  }, [imageBlob, onBlobChangeRef]);

  const openViewer = () => {
    zoom.reset();
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
      <Text variant="caption" color="$dangerText">
        {t("chatImageLoadFailed")}
      </Text>
    );
  }

  const aspectRatio =
    payload.width && payload.height ? payload.width / payload.height : 1;

  if (!imageUrl) {
    return (
      <Stack
        ref={placeholderNodeRef}
        width="$qr"
        maxWidth="100%"
        aspectRatio={aspectRatio}
        alignItems="center"
        justifyContent="center"
        borderRadius="$control"
        backgroundColor="$neutralSoft"
      >
        {shouldLoad ? <LoadingState label={t("chatImageDecrypting")} /> : null}
      </Stack>
    );
  }

  return (
    <>
      <Stack width="$qr" maxWidth="100%">
        <ImageAttachment
          uri={imageUrl}
          accessibilityLabel={t("chatImageOpen")}
          errorLabel={t("chatImageLoadFailed")}
          aspectRatio={aspectRatio}
          onPress={openViewer}
        />
      </Stack>

      <AttachmentViewer
        open={viewerOpen && imageBlob !== null}
        onClose={closeViewer}
        title={t("chatImageMessage")}
        backLabel={t("chatImageBackToChat")}
        errorText={viewerErrorText}
        actions={[
          { icon: "Download", label: t("chatImageSave"), onPress: saveImage },
          {
            icon: "Share2",
            label: t("share"),
            onPress: () => void shareImage(),
          },
        ]}
      >
        <Stack
          ref={viewerStageNodeRef}
          {...zoom.handlers}
          flex={1}
          width="100%"
          alignItems="center"
          justifyContent="center"
        >
          <Image
            src={imageUrl}
            aria-label={t("chatImageMessage")}
            width="100%"
            height="100%"
            maxWidth="$contentWidth"
            objectFit="contain"
            draggable={false}
            userSelect="none"
            x={zoom.transform.x}
            y={zoom.transform.y}
            scale={zoom.transform.scale}
            transition={zoom.isGesturing ? null : "fast"}
            onClick={(event: React.MouseEvent) => event.stopPropagation()}
          />
        </Stack>
      </AttachmentViewer>
    </>
  );
}
