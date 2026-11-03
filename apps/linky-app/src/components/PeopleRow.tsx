import { AvatarGroup, Row, Stack, Text } from "@linky-fit/ui";
import React from "react";

export interface PersonLike {
  readonly name: string;
  readonly pictureUrl: string | null;
}

/** Overlapping avatars followed by the names, with an optional leading element such as a Pill. */
export function PeopleRow({
  leading,
  people,
}: {
  leading?: React.ReactNode;
  people: ReadonlyArray<PersonLike>;
}): React.ReactElement {
  const avatars = people.map(({ name, pictureUrl }) => ({
    name: name.trim(),
    uri: pictureUrl ?? undefined,
  }));
  return (
    <Row>
      {/* A Pill aligns itself to the top; its own box lets the row center it. */}
      {leading ? <Stack>{leading}</Stack> : null}
      <AvatarGroup people={avatars} />
      <Text
        variant="label"
        color="$colorMuted"
        numberOfLines={1}
        flexShrink={1}
      >
        {avatars.map(({ name }) => name).join(", ")}
      </Text>
    </Row>
  );
}
