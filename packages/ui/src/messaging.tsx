import { useState } from "react";
import type { ReactNode, Ref } from "react";
import { Anchor, Image, ScrollView, View } from "tamagui";
import type { GetProps, TamaguiElement } from "tamagui";
import { IconButton, Pressable } from "./controls";
import type { LabeledAction } from "./controls";
import { textVariant } from "./styles";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { Row, Stack, Text } from "./layout";
import { border, opacity, space } from "./tokens";

/** Other view props (handlers, a ref, data attributes) reach the message's outer view. */
export interface MessageBubbleProps extends Omit<
  GetProps<typeof Stack>,
  "children" | "direction" | "testID"
> {
  ref?: Ref<TamaguiElement> | undefined;
  direction: "incoming" | "outgoing";
  children: ReactNode;
  time?: string | undefined;
  /** Not yet delivered: dashed outline and dimmed. */
  pending?: boolean | undefined;
  /** Content below the bubble, e.g. reactions. */
  footer?: ReactNode;
  /** Shown beside the bubble on the inner side, outside its width, e.g. an actions button. */
  accessory?: ReactNode;
  testID?: string | undefined;
}

export function MessageBubble({
  direction,
  children,
  time,
  pending = false,
  footer,
  accessory,
  testID,
  ...props
}: MessageBubbleProps) {
  const outgoing = direction === "outgoing";
  return (
    <Stack
      {...props}
      alignSelf={outgoing ? "flex-end" : "flex-start"}
      alignItems={outgoing ? "flex-end" : "flex-start"}
      maxWidth="85%"
      gap="$xs"
    >
      <Stack
        testID={testID}
        position="relative"
        maxWidth="100%"
        gap="$sm"
        paddingHorizontal="$md"
        paddingVertical="$sm"
        borderRadius="$control"
        backgroundColor={outgoing ? "$accentSoft" : "$neutralSoft"}
        borderWidth={border.hairline}
        borderStyle="dashed"
        borderColor={pending ? "$accent" : "$transparent"}
        opacity={pending ? opacity.dimmed : 1}
      >
        {typeof children === "string" ? (
          <Text userSelect="text">{children}</Text>
        ) : (
          children
        )}
        {accessory ? (
          // A zero-width anchor on the bubble's edge lets the accessory overflow outward.
          <Row
            position="absolute"
            top="$none"
            bottom="$none"
            width="$none"
            gap="$none"
            justifyContent={outgoing ? "flex-end" : "flex-start"}
            {...(outgoing ? { left: "$none" } : { right: "$none" })}
          >
            {accessory}
          </Row>
        ) : null}
      </Stack>
      {time ? (
        <Text variant="caption" color="$colorMuted">
          {time}
        </Text>
      ) : null}
      {footer}
    </Stack>
  );
}

export function DaySeparator({ label }: { label: string }) {
  return (
    <Text
      variant="caption"
      bold
      color="$colorMuted"
      alignSelf="center"
      flexShrink={0}
      paddingHorizontal="$md"
      paddingVertical="$xs"
      borderRadius="$pill"
      overflow="hidden"
      backgroundColor="$surface"
    >
      {label}
    </Text>
  );
}

export interface ReplyPreviewProps {
  author: string;
  body: string;
  onPress?: (() => void) | undefined;
  /** Shows a close button; `label` is its accessibility label. */
  dismiss?: LabeledAction | undefined;
}

export function ReplyPreview({
  author,
  body,
  onPress,
  dismiss,
}: ReplyPreviewProps) {
  const Quote = onPress ? Pressable : Stack;
  return (
    <Row
      gap="$sm"
      padding="$sm"
      borderRadius="$control"
      backgroundColor="$neutralSoft"
    >
      <Quote
        onPress={onPress}
        flex={1}
        flexDirection="column"
        alignItems="stretch"
        gap="$xxs"
        paddingLeft="$sm"
        borderLeftWidth={border.emphasis}
        borderColor="$accent"
      >
        <Text variant="caption" bold color="$accentText" numberOfLines={1}>
          {author}
        </Text>
        <Text variant="caption" color="$colorSubtle" numberOfLines={2}>
          {body}
        </Text>
      </Quote>
      {dismiss ? (
        <IconButton
          icon="X"
          accessibilityLabel={dismiss.label}
          size="sm"
          onPress={dismiss.onPress}
        />
      ) : null}
    </Row>
  );
}

export interface MessageComposerFrameProps {
  /** The text input with its send action inside, e.g. a `RichTextInput` with `trailing`. */
  children: ReactNode;
  /** Shown above the input, e.g. a reply preview or attachments. */
  header?: ReactNode;
  /** Shown below the input, e.g. payment actions. */
  footer?: ReactNode;
}

/** Sits flush under the message list, whose content pads the space above the composer, so messages scroll right up to its top edge. */
export function MessageComposerFrame({
  children,
  header,
  footer,
}: MessageComposerFrameProps) {
  return (
    <Stack
      gap="$sm"
      paddingHorizontal="$xl"
      paddingBottom="$md"
      backgroundColor="$background"
    >
      {header}
      {children}
      {footer}
    </Stack>
  );
}

export interface LinkPreviewProps {
  title: string;
  site: string;
  description?: string | undefined;
  imageUri?: string | undefined;
  /** The site's icon, shown before its name. */
  faviconUri?: string | undefined;
  href: string;
}

export function LinkPreview({
  title,
  site,
  description,
  imageUri,
  faviconUri,
  href,
}: LinkPreviewProps) {
  return (
    <Anchor
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      textDecorationLine="none"
    >
      <Row
        alignItems="flex-start"
        gap="$sm"
        padding="$sm"
        borderRadius="$control"
        borderWidth={border.hairline}
        borderColor="$borderColor"
        backgroundColor="$surface"
      >
        {imageUri ? (
          <Image
            src={imageUri}
            width="$avatar"
            height="$avatar"
            borderRadius="$sm"
            objectFit="cover"
            aria-hidden
          />
        ) : null}
        <Stack flex={1} gap="$xxs">
          <Row gap="$xs">
            {faviconUri ? (
              <Image
                src={faviconUri}
                width="$iconSm"
                height="$iconSm"
                borderRadius="$sm"
                aria-hidden
              />
            ) : null}
            <Text
              variant="caption"
              color="$accentText"
              numberOfLines={1}
              flexShrink={1}
            >
              {site}
            </Text>
          </Row>
          <Text variant="label" numberOfLines={2}>
            {title}
          </Text>
          {description ? (
            <Text variant="caption" color="$colorMuted" numberOfLines={2}>
              {description}
            </Text>
          ) : null}
        </Stack>
      </Row>
    </Anchor>
  );
}

export function MessageLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Anchor
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      color="$infoText"
      textDecorationLine="underline"
      fontFamily="$body"
      {...textVariant("body")}
    >
      {children}
    </Anchor>
  );
}

export interface FileAttachmentProps {
  name: string;
  meta?: string | undefined;
  icon?: IconName | undefined;
  onPress?: (() => void) | undefined;
  loading?: boolean | undefined;
}

export function FileAttachment({
  name,
  meta,
  icon = "FileText",
  onPress,
  loading = false,
}: FileAttachmentProps) {
  return (
    <Pressable
      gap="$sm"
      padding="$sm"
      borderRadius="$control"
      backgroundColor="$surface"
      disabled={!onPress || loading}
      aria-busy={loading}
      onPress={onPress}
    >
      <View padding="$sm" borderRadius="$sm" backgroundColor="$accentSoft">
        <Icon name={icon} color="$accentText" />
      </View>
      <Stack flex={1} gap="$xxs">
        <Text variant="label" numberOfLines={1}>
          {name}
        </Text>
        {meta ? (
          <Text variant="caption" color="$colorMuted">
            {meta}
          </Text>
        ) : null}
      </Stack>
    </Pressable>
  );
}

export interface ImageAttachmentProps {
  uri: string;
  accessibilityLabel: string;
  errorLabel: string;
  aspectRatio?: number | undefined;
  onPress?: (() => void) | undefined;
}

export function ImageAttachment(props: ImageAttachmentProps) {
  return <ImageAttachmentContent key={props.uri} {...props} />;
}

function ImageAttachmentContent({
  uri,
  accessibilityLabel,
  errorLabel,
  aspectRatio = 4 / 3,
  onPress,
}: ImageAttachmentProps) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">(
    "loading",
  );
  return (
    <Pressable
      width="100%"
      aspectRatio={aspectRatio}
      justifyContent="center"
      overflow="hidden"
      borderRadius="$control"
      backgroundColor="$neutralSoft"
      aria-label={accessibilityLabel}
      aria-busy={state === "loading"}
      disabled={!onPress || state !== "loaded"}
      onPress={onPress}
    >
      {state === "failed" ? (
        <Stack alignItems="center" gap="$xs" padding="$lg">
          <Icon name="FileText" color="$colorMuted" />
          <Text variant="caption" color="$colorMuted">
            {errorLabel}
          </Text>
        </Stack>
      ) : (
        <Image
          src={uri}
          width="100%"
          height="100%"
          objectFit="cover"
          aria-hidden
          onLoad={() => setState("loaded")}
          onError={() => setState("failed")}
        />
      )}
    </Pressable>
  );
}

export interface AttachmentDraft {
  id: string;
  name: string;
  previewUri?: string | undefined;
}

export interface AttachmentTrayProps {
  accessibilityLabel: string;
  items: readonly AttachmentDraft[];
  removeLabel: (item: AttachmentDraft) => string;
  onRemove: (id: string) => void;
  /** Shows an add button; `label` is its accessibility label. */
  add?: LabeledAction | undefined;
  disabled?: boolean | undefined;
}

export function AttachmentTray({
  accessibilityLabel,
  items,
  removeLabel,
  onRemove,
  add,
  disabled,
}: AttachmentTrayProps) {
  return (
    <ScrollView
      horizontal
      role="group"
      aria-label={accessibilityLabel}
      contentContainerStyle={{ gap: space.sm }}
      flexGrow={0}
    >
      {items.map((item) => (
        <View
          key={item.id}
          position="relative"
          width="$row"
          height="$row"
          borderRadius="$control"
          overflow="hidden"
          backgroundColor="$neutralSoft"
          alignItems="center"
          justifyContent="center"
        >
          {item.previewUri ? (
            <Image
              src={item.previewUri}
              width="100%"
              height="100%"
              objectFit="cover"
              aria-label={item.name}
            />
          ) : (
            <Stack alignItems="center" gap="$xxs" paddingHorizontal="$xs">
              <Icon name="FileText" color="$colorMuted" />
              <Text variant="caption" color="$colorSubtle" numberOfLines={1}>
                {item.name}
              </Text>
            </Stack>
          )}
          <View position="absolute" top="$xxs" right="$xxs">
            <IconButton
              icon="X"
              accessibilityLabel={removeLabel(item)}
              size="sm"
              variant="secondary"
              disabled={disabled}
              onPress={() => onRemove(item.id)}
            />
          </View>
        </View>
      ))}
      {add ? (
        <Pressable
          width="$row"
          height="$row"
          justifyContent="center"
          borderRadius="$control"
          borderWidth={border.hairline}
          borderStyle="dashed"
          borderColor="$borderColorHover"
          aria-label={add.label}
          disabled={disabled}
          onPress={add.onPress}
        >
          <Icon name="Plus" color="$colorMuted" />
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

export interface EmojiPickerProps {
  accessibilityLabel: string;
  emojis: readonly string[];
  onSelect: (emoji: string) => void;
  /** Shows a plus button after the emojis, e.g. to reveal the full set; `label` is its accessibility label. */
  more?: LabeledAction | undefined;
}

export function EmojiPicker({
  accessibilityLabel,
  emojis,
  onSelect,
  more,
}: EmojiPickerProps) {
  return (
    <Row role="group" aria-label={accessibilityLabel} flexWrap="wrap" gap="$xs">
      {emojis.map((emoji) => (
        <Pressable
          key={emoji}
          aria-label={emoji}
          width="$control"
          height="$control"
          justifyContent="center"
          borderRadius="$pill"
          hoverStyle={{ backgroundColor: "$neutralSoft" }}
          onPress={() => onSelect(emoji)}
        >
          <Text variant="heading">{emoji}</Text>
        </Pressable>
      ))}
      {more ? (
        <Pressable
          aria-label={more.label}
          width="$control"
          height="$control"
          justifyContent="center"
          borderRadius="$pill"
          hoverStyle={{ backgroundColor: "$neutralSoft" }}
          onPress={more.onPress}
        >
          <Icon name="Plus" color="$colorMuted" />
        </Pressable>
      ) : null}
    </Row>
  );
}

export interface EmojiCatalogGroup {
  key: string;
  /** Tab name, read by assistive tech; the tab shows `icon`. */
  label: string;
  icon: IconName;
  emojis: readonly string[];
}

export interface EmojiCatalogProps {
  accessibilityLabel: string;
  groups: readonly EmojiCatalogGroup[];
  onSelect: (emoji: string) => void;
}

/** The full emoji set behind icon tabs, one group shown at a time; the grid scrolls within a fixed height. */
export function EmojiCatalog({
  accessibilityLabel,
  groups,
  onSelect,
}: EmojiCatalogProps) {
  const [activeKey, setActiveKey] = useState(groups[0]?.key ?? "");
  const active = groups.find((group) => group.key === activeKey) ?? groups[0];
  return (
    <Stack gap="$sm">
      <Row role="tablist" gap="$xxs" justifyContent="space-between">
        {groups.map((group) => (
          <IconButton
            key={group.key}
            icon={group.icon}
            accessibilityLabel={group.label}
            size="sm"
            variant={group.key === active?.key ? "secondary" : "ghost"}
            role="tab"
            aria-selected={group.key === active?.key}
            onPress={() => setActiveKey(group.key)}
          />
        ))}
      </Row>
      {active ? (
        // Remounting on a tab change starts the grid at its top.
        <ScrollView key={active.key} maxHeight="$qr" flexGrow={0}>
          <EmojiPicker
            accessibilityLabel={`${accessibilityLabel}: ${active.label}`}
            emojis={active.emojis}
            onSelect={onSelect}
          />
        </ScrollView>
      ) : null}
    </Stack>
  );
}
