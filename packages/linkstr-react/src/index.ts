// Re-export the atom surface so app code consumes the atoms below via
// useAtomSet/useAtomValue without depending on the unstable atom modules.
export * from "@effect/atom-react/Hooks";
export * from "@effect/atom-react/ReactHydration";
export * from "@effect/atom-react/RegistryContext";
// Namespaced: the package barrel flattens ScopedAtom's `make` into the root.
export * as ScopedAtom from "@effect/atom-react/ScopedAtom";
export * from "effect/reactivity";

export * from "./bankOffers";
export * from "./config";
export * from "./errors";
export * from "./inbox";
export * from "./inspector";
export * from "./muteList";
export * from "./outbox";
export * from "./paymentNotices";
export * from "./paymentTelemetry";
export * from "./profiles";
export * from "./reactions";
export * from "./relayHealth";
export * from "./relayLists";
export * from "./seenReceipts";
export * from "./runtime";
