import { FileText, Plus } from "lucide-react";
import { useEffect, useMemo, type FC } from "react";

interface ChatAttachmentPreviewProps {
  addLabel: string;
  disabled: boolean;
  files: readonly File[];
  onAdd: () => void;
  onRemove: (file: File) => void;
  removeLabel: string;
}

interface ChatAttachmentItemProps {
  disabled: boolean;
  file: File;
  onRemove: (file: File) => void;
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

const ChatAttachmentItem: FC<ChatAttachmentItemProps> = ({
  disabled,
  file,
  onRemove,
  removeLabel,
}) => {
  const isImage = file.type.startsWith("image/");
  const imageUrl = useObjectUrl(isImage ? file : null);

  return (
    <div className="chat-attachment-item" title={file.name}>
      {imageUrl ? (
        <img src={imageUrl} alt="" />
      ) : (
        <>
          <FileText size={24} aria-hidden="true" />
          <span className="chat-attachment-item-name">{file.name}</span>
        </>
      )}
      <button
        type="button"
        className="chat-attachment-remove"
        onClick={() => onRemove(file)}
        disabled={disabled}
        aria-label={`${removeLabel}: ${file.name}`}
        title={removeLabel}
      >
        ×
      </button>
    </div>
  );
};

export const ChatAttachmentPreview: FC<ChatAttachmentPreviewProps> = ({
  addLabel,
  disabled,
  files,
  onAdd,
  onRemove,
  removeLabel,
}) => (
  <div className="chat-attachment-preview" data-guide="chat-attachments">
    {files.map((file, index) => (
      <ChatAttachmentItem
        key={`${index}:${file.name}:${file.size}:${file.lastModified}`}
        disabled={disabled}
        file={file}
        onRemove={onRemove}
        removeLabel={removeLabel}
      />
    ))}
    <button
      type="button"
      className="chat-attachment-add"
      onPointerDown={(event) => event.preventDefault()}
      onClick={onAdd}
      disabled={disabled}
      aria-label={addLabel}
      title={addLabel}
    >
      <Plus size={20} aria-hidden="true" />
    </button>
  </div>
);
