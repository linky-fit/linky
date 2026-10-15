// Human names for the nostr kinds the dev inspector surfaces.

const NOSTR_KIND_NAMES: Record<number, string> = {
  0: "profile",
  1: "note",
  5: "delete",
  7: "reaction",
  14: "chat message",
  15: "chat media",
  1059: "gift wrap",
  10000: "mute list",
  10002: "relay list",
  10050: "DM inbox relays",
  30315: "status",
};

export const nostrKindLabel = (kind: number): string => {
  const name = NOSTR_KIND_NAMES[kind];
  return name === undefined ? `kind ${kind}` : `${name} (${kind})`;
};
