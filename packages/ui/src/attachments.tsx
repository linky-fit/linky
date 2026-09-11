import { Image, ScrollView } from "tamagui";
import { Button, IconButton } from "./controls";
import { Icon } from "./icons";
import { Row, Stack, Text } from "./layout";

export interface AttachmentCardProps {
  name: string;
  description?: string;
  previewUri?: string;
  onPress: () => void;
  label: string;
}
export function AttachmentCard({
  name,
  description,
  previewUri,
  onPress,
  label,
}: AttachmentCardProps) {
  return (
    <Button
      variant="ghost"
      onPress={onPress}
      aria-label={label}
      padding={0}
      justifyContent="flex-start"
    >
      <Stack gap="$sm" flex={1}>
        {previewUri ? (
          <Image
            src={previewUri}
            width="100%"
            height={180}
            objectFit="cover"
            borderRadius="$sm"
            alt={name}
          />
        ) : null}
        <Row>
          <Icon name={previewUri ? "Download" : "FileText"} color="$muted" />
          <Stack gap="$xs" flex={1}>
            <Text variant="label" numberOfLines={2}>
              {name}
            </Text>
            {description ? (
              <Text variant="caption" muted>
                {description}
              </Text>
            ) : null}
          </Stack>
        </Row>
      </Stack>
    </Button>
  );
}
export interface AttachmentDraft {
  id: string;
  name: string;
  previewUri?: string;
  removeLabel: string;
}
export interface AttachmentTrayProps {
  items: readonly AttachmentDraft[];
  onRemove: (id: string) => void;
}
export function AttachmentTray({ items, onRemove }: AttachmentTrayProps) {
  if (!items.length) return null;
  return (
    <ScrollView horizontal>
      <Row gap="$sm">
        {items.map((item) => (
          <Row
            key={item.id}
            maxWidth={230}
            backgroundColor="$surface"
            borderRadius="$sm"
            paddingLeft="$sm"
            gap="$xs"
          >
            {item.previewUri ? (
              <Image
                src={item.previewUri}
                width={30}
                height={30}
                objectFit="cover"
                borderRadius="$sm"
                alt=""
              />
            ) : (
              <Icon name="FileText" size={16} color="$muted" />
            )}
            <Text variant="caption" flexShrink={1} numberOfLines={1}>
              {item.name}
            </Text>
            <IconButton
              label={item.removeLabel}
              icon="X"
              onPress={() => onRemove(item.id)}
            />
          </Row>
        ))}
      </Row>
    </ScrollView>
  );
}
