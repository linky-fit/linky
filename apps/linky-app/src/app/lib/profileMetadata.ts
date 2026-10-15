import { ProfileMetadata } from "@linky-fit/linkstr";
import { Struct } from "effect";
import { isNpubDefaultNip05 } from "../../utils/nostrNip05";

export const dropNpubNip05 = (
  metadata: ProfileMetadata,
): ProfileMetadata | null =>
  metadata.nip05 && isNpubDefaultNip05(metadata.nip05)
    ? new ProfileMetadata(Struct.omit(metadata, ["nip05"]))
    : null;
