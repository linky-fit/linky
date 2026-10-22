import { Atom } from "effect/reactivity";
import type { OnchainTransferView } from "../../lib/onchainTransfers";

/**
 * The user's on-chain transfers while the feature shows, which needs
 * experimental features and a configured on-chain operator; null while hidden.
 */
export const onchainTransfersAtom = Atom.keepAlive(
  Atom.make<readonly OnchainTransferView[] | null>(null),
);
