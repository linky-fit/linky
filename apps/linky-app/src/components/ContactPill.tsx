import { Avatar, Icon, Pill, Row } from "@linky-fit/ui";
import { deriveDefaultProfile } from "../derivedProfile";
import type { NpubMessageContactInfo } from "./ChatMessage";

interface ContactPillProps {
  info: NpubMessageContactInfo;
  onOpen?: ((npub: string) => void) | undefined;
  /** Marks a contact that is not saved yet. */
  showAdd?: boolean;
  size?: "sm" | "md";
}

/** A contact mentioned in a message: avatar and name, optionally opening the contact. */
export function ContactPill({
  info,
  onOpen,
  showAdd = false,
  size = "md",
}: ContactPillProps) {
  return (
    <Pill
      label={info.displayName}
      size={size}
      accessibilityLabel={info.displayName}
      onPress={onOpen ? () => onOpen(info.npub) : undefined}
      leading={
        <Row gap="$xxs">
          {showAdd ? <Icon name="Plus" size="sm" color="$accentText" /> : null}
          <Avatar
            name={deriveDefaultProfile(info.npub).name}
            uri={info.pictureUrl ?? undefined}
            size="xs"
          />
        </Row>
      }
    />
  );
}
