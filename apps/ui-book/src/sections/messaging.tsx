import { useRef, useState } from "react";
import * as UI from "@linky-fit/ui";
import type { Section } from "../section";
import { sampleImage } from "../sample-image";

const sampleDrafts: UI.AttachmentDraft[] = [
  { id: "photo", name: "Color study", previewUri: sampleImage },
  { id: "pdf", name: "Weekend.pdf" },
];

export const messaging: Section = {
  title: "Messaging",
  entries: {
    MessageBubble: () => (
      <UI.Stack>
        <UI.MessageBubble direction="incoming" time="10:40">
          See you on Saturday.
        </UI.MessageBubble>
        <UI.MessageBubble direction="outgoing" time="10:42">
          Sounds good!
        </UI.MessageBubble>
        <UI.MessageBubble direction="outgoing" pending>
          Sending…
        </UI.MessageBubble>
        <UI.MessageBubble
          direction="incoming"
          time="10:43"
          footer={<UI.Pill label="👍 1" size="sm" tone="neutral" />}
          accessory={
            <UI.IconButton
              icon="Ellipsis"
              size="sm"
              accessibilityLabel="Message actions"
              onPress={() => {}}
            />
          }
        >
          With a reaction and an actions button
        </UI.MessageBubble>
      </UI.Stack>
    ),
    DaySeparator: () => <UI.DaySeparator label="Today" />,
    ReplyPreview: () => (
      <UI.ReplyPreview author="Alex Rivers" body="See you on Saturday." />
    ),
    MessageComposerFrame: () => {
      const [message, setMessage] = useState("");
      const [sent, setSent] = useState("");
      const editor = useRef<HTMLDivElement>(null);
      return (
        <UI.Stack>
          <UI.MessageComposerFrame
            header={<UI.Text variant="caption">Custom editor</UI.Text>}
            footer={
              <UI.Button variant="ghost" size="sm" icon="Zap">
                Pay
              </UI.Button>
            }
          >
            <UI.RichTextInput
              ref={editor}
              placeholder="Write a message"
              empty={message === ""}
              onInput={(event) =>
                setMessage(event.currentTarget.textContent ?? "")
              }
              trailing={
                <UI.IconButton
                  icon="Send"
                  variant="primary"
                  size="sm"
                  accessibilityLabel="Send example message"
                  disabled={message.trim() === ""}
                  onPress={() => {
                    setSent(message);
                    setMessage("");
                    if (editor.current) editor.current.textContent = "";
                  }}
                />
              }
            />
          </UI.MessageComposerFrame>
          {sent ? (
            <UI.Text variant="caption">Sent locally: {sent}</UI.Text>
          ) : null}
        </UI.Stack>
      );
    },
    MessageLink: () => (
      <UI.MessageLink href="https://example.com">example.com</UI.MessageLink>
    ),
    LinkPreview: () => (
      <UI.LinkPreview
        title="Weekend plans"
        site="example.com"
        description="A fictional link preview."
        href="https://example.com"
        imageUri={sampleImage}
        faviconUri={sampleImage}
      />
    ),
    FileAttachment: () => (
      <UI.FileAttachment
        name="Weekend.pdf"
        meta="PDF · 24 KB"
        onPress={() => {}}
      />
    ),
    ImageAttachment: () => (
      <UI.ImageAttachment
        uri={sampleImage}
        accessibilityLabel="Attached color study"
        errorLabel="Image unavailable"
        onPress={() => {}}
      />
    ),
    AttachmentTray: () => {
      const [drafts, setDrafts] = useState(sampleDrafts);
      return (
        <UI.Stack>
          <UI.AttachmentTray
            accessibilityLabel="Draft attachments"
            items={drafts}
            removeLabel={(item) => `Remove ${item.name}`}
            onRemove={(id) =>
              setDrafts((current) => current.filter((item) => item.id !== id))
            }
            add={{
              label: "Reset example attachments",
              onPress: () => setDrafts(sampleDrafts),
            }}
          />
          <UI.Text variant="caption">{drafts.length} attachments</UI.Text>
        </UI.Stack>
      );
    },
    EmojiCatalog: () => {
      const [emoji, setEmoji] = useState("🎉");
      return (
        <UI.Stack>
          <UI.EmojiCatalog
            accessibilityLabel="Example emojis"
            groups={[
              {
                key: "smileys",
                label: "Smileys",
                icon: "Smile",
                emojis: ["😀", "😂", "😍", "🤔", "😢", "😡"],
              },
              {
                key: "food",
                label: "Food",
                icon: "Pizza",
                emojis: ["🍕", "🍔", "🍣", "🍩", "☕"],
              },
              {
                key: "flags",
                label: "Flags",
                icon: "Flag",
                emojis: ["🏁", "🇨🇿", "🇩🇪", "🇧🇷"],
              },
            ]}
            onSelect={setEmoji}
          />
          <UI.Text variant="caption">Selected: {emoji}</UI.Text>
        </UI.Stack>
      );
    },
    EmojiPicker: () => {
      const [emoji, setEmoji] = useState("👍");
      const [expanded, setExpanded] = useState(false);
      return (
        <UI.Stack>
          <UI.EmojiPicker
            accessibilityLabel="Example reactions"
            emojis={
              expanded
                ? ["👍", "❤️", "😂", "⚡", "🎉", "🔥", "😮", "😢"]
                : ["👍", "❤️", "😂", "⚡"]
            }
            onSelect={setEmoji}
            {...(expanded
              ? {}
              : {
                  more: {
                    label: "More emojis",
                    onPress: () => setExpanded(true),
                  },
                })}
          />
          <UI.Text variant="caption">Selected: {emoji}</UI.Text>
        </UI.Stack>
      );
    },
  },
};
