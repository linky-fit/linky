import { FileText } from "lucide-react";
import { useEffect, useMemo, type FC } from "react";

interface ChatAttachmentPreviewProps {
  file: File;
  onRemove: () => void;
  removeLabel: string;
}

const useObjectUrl = (file: File | null) => {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
};

export const ChatAttachmentPreview: FC<ChatAttachmentPreviewProps> = ({
  file,
  onRemove,
  removeLabel,
}) => {
  const isImage = file.type.startsWith("image/");
  const imageUrl = useObjectUrl(isImage ? file : null);

  return (
    <div className="chat-attachment-preview" data-guide="chat-attachment">
      <div className="chat-attachment-preview-thumb" aria-hidden="true">
        {isImage ? (
          imageUrl ? (
            <img src={imageUrl} alt="" />
          ) : null
        ) : (
          <FileText size={24} />
        )}
      </div>
      <span className="chat-attachment-preview-name">{file.name}</span>
      <button
        type="button"
        className="chat-attachment-preview-remove"
        onClick={onRemove}
        aria-label={removeLabel}
        title={removeLabel}
      >
        ×
      </button>
    </div>
  );
};
