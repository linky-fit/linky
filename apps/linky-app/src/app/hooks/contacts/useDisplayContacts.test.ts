import { expect, it } from "vitest";
import { mentionContacts } from "./useDisplayContacts";

it("offers only named, undeleted contacts with an npub for mentions", () => {
  const npub =
    "npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m";
  const mentions = mentionContacts(
    [
      { name: "Alice", npub },
      { name: "Deleted", npub, archivedAtSec: 1 },
      { name: "", npub },
      { name: "No npub", npub: null },
    ],
    {},
  );

  expect(mentions.map(({ name }) => name)).toEqual(["Alice"]);
});
