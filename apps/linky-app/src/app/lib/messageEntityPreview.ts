const MESSAGE_ENTITY_PATTERN =
  /(?:nostr:)?npub1[023456789acdefghjklmnpqrstuvwxyz]+(?:@npub\.cash)?|cashu[0-9A-Za-z_-]+={0,2}/i;

export const hasMessageEntityPreview = (content: string): boolean =>
  MESSAGE_ENTITY_PATTERN.test(content);
