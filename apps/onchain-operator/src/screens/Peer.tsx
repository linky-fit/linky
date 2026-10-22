import type { Pubkey } from "@linky-fit/linkstr";
import { Avatar, Row, Stack, Text, type AvatarSize } from "@linky-fit/ui";
import { shortNpub } from "../format";
import { usePeerProfile } from "../services/react";

export function PeerAvatar({
  pubkey,
  size,
}: {
  readonly pubkey: Pubkey;
  readonly size?: AvatarSize;
}) {
  const { name, picture } = usePeerProfile(pubkey);
  return <Avatar name={name} uri={picture} size={size} />;
}

/** A user's picture and profile name over their short npub. */
export function PeerSummary({ pubkey }: { readonly pubkey: Pubkey }) {
  const { name } = usePeerProfile(pubkey);
  return (
    <Row gap="$sm" alignItems="center" flex={1} minWidth={0}>
      <PeerAvatar pubkey={pubkey} size="sm" />
      <Stack minWidth={0} flexShrink={1}>
        <Text bold numberOfLines={1}>
          {name}
        </Text>
        <Text variant="caption" color="$colorMuted" mono numberOfLines={1}>
          {shortNpub(pubkey)}
        </Text>
      </Stack>
    </Row>
  );
}
