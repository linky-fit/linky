import { AttachmentTray } from "@linky-fit/ui";
import { useEffect, useRef, type FC } from "react";

interface ChatAttachmentPreviewProps {
  accessibilityLabel: string;
  addLabel: string;
  disabled: boolean;
  files: readonly File[];
  onAdd: () => void;
  onRemove: (file: File) => void;
  removeLabel: string;
}

const previewUrls = new WeakMap<File, string>();

const previewUrlFor = (file: File): string | null => {
  if (!file.type.startsWith("image/")) return null;
  const cached = previewUrls.get(file);
  if (cached) return cached;
  const url = URL.createObjectURL(file);
  previewUrls.set(file, url);
  return url;
};

/** Staged files outlive the composer, so a preview is revoked only once its file leaves the tray. */
const useRevokeRemovedPreviews = (files: readonly File[]) => {
  const previous = useRef(files);
  useEffect(() => {
    for (const file of previous.current) {
      if (files.includes(file)) continue;
      const url = previewUrls.get(file);
      if (url) URL.revokeObjectURL(url);
      previewUrls.delete(file);
    }
    previous.current = files;
  }, [files]);
};

export const ChatAttachmentPreview: FC<ChatAttachmentPreviewProps> = ({
  accessibilityLabel,
  addLabel,
  disabled,
  files,
  onAdd,
  onRemove,
  removeLabel,
}) => {
  useRevokeRemovedPreviews(files);
  const items = files.map((file, index) => {
    const previewUri = previewUrlFor(file);
    return {
      id: String(index),
      name: file.name,
      ...(previewUri ? { previewUri } : {}),
    };
  });
  return (
    <AttachmentTray
      accessibilityLabel={accessibilityLabel}
      items={items}
      removeLabel={(item) => `${removeLabel}: ${item.name}`}
      onRemove={(id) => {
        const file = files[Number(id)];
        if (file) onRemove(file);
      }}
      add={{ label: addLabel, onPress: onAdd }}
      disabled={disabled}
    />
  );
};
