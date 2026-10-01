import { Option, Schema } from "effect";
import type { I18nKey } from "../i18n";

export const RECEIVE_METHODS = ["cashu", "universal", "lightning"] as const;

export type ReceiveMethod = (typeof RECEIVE_METHODS)[number];

export const DEFAULT_RECEIVE_METHOD: ReceiveMethod = "universal";

const ReceiveMethodSchema = Schema.Literals(RECEIVE_METHODS);

export const parseReceiveMethod = (
  value: string | null | undefined,
): ReceiveMethod | null =>
  Option.getOrNull(
    Schema.decodeUnknownOption(ReceiveMethodSchema)((value ?? "").trim()),
  );

export const RECEIVE_METHOD_LABEL_KEYS: Record<ReceiveMethod, I18nKey> = {
  cashu: "topupQrModeCashu",
  universal: "topupQrModeUniversal",
  lightning: "topupQrModeLightning",
};
