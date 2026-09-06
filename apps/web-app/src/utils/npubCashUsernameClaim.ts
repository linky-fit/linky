import type { JsonValue } from "../types/json";
import type { LightningInvoicePreview } from "@linky/linkshu";
import { getLightningInvoicePreview } from "@linky/linkshu";
import { getUnknownErrorMessage } from "./unknown";
import { asNonEmptyString, asRecord } from "./validation";
import { sleep } from "./time";

const OWN_LIGHTNING_ADDRESS_DOMAIN = "linky.fit";
const OWN_LIGHTNING_USERNAME_MIN_LENGTH = 3;

const OWN_LIGHTNING_USERNAME_RE = /^(?!npub1)[a-z0-9]+$/i;
const USERNAME_TAKEN_MESSAGE = "This username is already taken";
const USERNAME_ALREADY_SET_MESSAGE = "Username already set";
const USERNAME_INVALID_MESSAGE = "Invalid username";
const PAYMENT_REQUIRED_MESSAGE = "Payment required";
const INVOICE_UNPAID_MESSAGE = "Invoice unpaid...";

type OwnLightningUsernameValidationIssue =
  | "empty"
  | "invalid_format"
  | "too_short";

export interface OwnLightningClaimAvailableResult {
  invoice: LightningInvoicePreview;
  kind: "available";
  lightningAddress: string;
  paymentToken: string;
  username: string;
}

export interface OwnLightningAddressInputCandidate {
  issue: OwnLightningUsernameValidationIssue | null;
  lightningAddress: string;
  username: string;
}

type OwnLightningClaimPreviewResult =
  | OwnLightningClaimAvailableResult
  | { kind: "already_set"; message: string }
  | { kind: "error"; message: string }
  | { kind: "invalid"; issue: OwnLightningUsernameValidationIssue }
  | { kind: "taken"; message: string };

type OwnLightningClaimFinalizeResult =
  | { kind: "already_set" }
  | { kind: "error"; message: string }
  | { kind: "success" }
  | { kind: "unpaid"; message: string };

export interface Nip98AuthHeaderFactory {
  (
    url: string,
    method: string,
    payload?: Record<string, string>,
  ): Promise<string>;
}

const buildFallbackInvoicePreview = (
  invoice: string,
): LightningInvoicePreview => ({
  amountSat: null,
  description: null,
  expiresAtSec: null,
  invoice,
});

const parseResponseJson = async (response: Response): Promise<JsonValue> => {
  try {
    const json: JsonValue = await response.json();
    return json;
  } catch {
    return null;
  }
};

const getResponseMessage = (json: JsonValue, fallback: string): string => {
  const root = asRecord(json);
  return asNonEmptyString(root?.message) ?? fallback;
};

export const normalizeOwnLightningUsername = (value: string): string => {
  return value.trim().toLowerCase();
};

export const getOwnLightningUsernameValidationIssue = (
  value: string,
): OwnLightningUsernameValidationIssue | null => {
  const username = normalizeOwnLightningUsername(value);
  if (!username) return "empty";
  if (username.length < OWN_LIGHTNING_USERNAME_MIN_LENGTH) return "too_short";
  if (!OWN_LIGHTNING_USERNAME_RE.test(username)) return "invalid_format";
  return null;
};

export const getOwnLightningAddressFromUsername = (value: string): string => {
  const username = normalizeOwnLightningUsername(value);
  return username ? `${username}@${OWN_LIGHTNING_ADDRESS_DOMAIN}` : "";
};

export const getOwnLightningAddressInputCandidate = (
  value: string,
): OwnLightningAddressInputCandidate | null => {
  const input = value.trim();
  if (!input) return null;

  const atIndex = input.indexOf("@");
  if (atIndex < 0) {
    const username = normalizeOwnLightningUsername(input);
    return {
      issue: getOwnLightningUsernameValidationIssue(username),
      lightningAddress: getOwnLightningAddressFromUsername(username),
      username,
    };
  }

  if (atIndex !== input.lastIndexOf("@")) return null;

  const domain = input
    .slice(atIndex + 1)
    .trim()
    .toLowerCase();
  if (domain !== OWN_LIGHTNING_ADDRESS_DOMAIN) return null;

  const username = normalizeOwnLightningUsername(input.slice(0, atIndex));
  return {
    issue: getOwnLightningUsernameValidationIssue(username),
    lightningAddress: getOwnLightningAddressFromUsername(username),
    username,
  };
};

export const requestOwnLightningAddressClaimPreview = async (args: {
  makeNip98AuthHeader: Nip98AuthHeaderFactory;
  serverBaseUrl: string;
  signal?: AbortSignal;
  username: string;
}): Promise<OwnLightningClaimPreviewResult> => {
  const username = normalizeOwnLightningUsername(args.username);
  const issue = getOwnLightningUsernameValidationIssue(username);
  if (issue) return { kind: "invalid", issue };

  const url = `${args.serverBaseUrl.replace(/\/+$/, "")}/api/v1/info/username`;
  const payload = { username };

  try {
    const auth = await args.makeNip98AuthHeader(url, "PUT", payload);
    const requestInit: RequestInit = {
      body: JSON.stringify(payload),
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      method: "PUT",
    };
    if (args.signal) {
      requestInit.signal = args.signal;
    }
    const response = await fetch(url, {
      ...requestInit,
    });
    const json = await parseResponseJson(response);
    const message = getResponseMessage(json, `HTTP ${response.status}`);

    if (response.status === 402 || message === PAYMENT_REQUIRED_MESSAGE) {
      const root = asRecord(json);
      const data = asRecord(root?.data);
      const paymentToken = asNonEmptyString(data?.paymentToken);
      const paymentRequest = asNonEmptyString(data?.paymentRequest);
      if (!paymentToken || !paymentRequest) {
        return { kind: "error", message };
      }

      return {
        invoice:
          getLightningInvoicePreview(paymentRequest) ??
          buildFallbackInvoicePreview(paymentRequest),
        kind: "available",
        lightningAddress: getOwnLightningAddressFromUsername(username),
        paymentToken,
        username,
      };
    }

    if (message === USERNAME_TAKEN_MESSAGE) {
      return { kind: "taken", message };
    }

    if (message === USERNAME_ALREADY_SET_MESSAGE) {
      return { kind: "already_set", message };
    }

    if (message === USERNAME_INVALID_MESSAGE) {
      return { kind: "invalid", issue: "invalid_format" };
    }

    return { kind: "error", message };
  } catch (error) {
    return {
      kind: "error",
      message: getUnknownErrorMessage(error, "Username check failed"),
    };
  }
};

export const finalizeOwnLightningAddressClaim = async (args: {
  makeNip98AuthHeader: Nip98AuthHeaderFactory;
  paymentToken: string;
  serverBaseUrl: string;
  username: string;
}): Promise<OwnLightningClaimFinalizeResult> => {
  const username = normalizeOwnLightningUsername(args.username);
  const paymentToken = args.paymentToken.trim();
  const issue = getOwnLightningUsernameValidationIssue(username);
  if (issue || !paymentToken) {
    return { kind: "error", message: "Missing claim data" };
  }

  const url = `${args.serverBaseUrl.replace(/\/+$/, "")}/api/v1/info/username`;
  const payload = { paymentToken, username };

  try {
    const auth = await args.makeNip98AuthHeader(url, "PUT", payload);
    const response = await fetch(url, {
      body: JSON.stringify(payload),
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      method: "PUT",
    });
    const json = await parseResponseJson(response);
    const root = asRecord(json);
    const message = getResponseMessage(json, `HTTP ${response.status}`);

    if (response.ok && root?.error !== true) {
      return { kind: "success" };
    }

    if (message === USERNAME_ALREADY_SET_MESSAGE) {
      return { kind: "already_set" };
    }

    if (response.status === 402 || message === INVOICE_UNPAID_MESSAGE) {
      return { kind: "unpaid", message };
    }

    return { kind: "error", message };
  } catch (error) {
    return {
      kind: "error",
      message: getUnknownErrorMessage(error, "Username claim failed"),
    };
  }
};

const CLAIM_CONFIRM_RETRY_DELAY_MS = 1_000;
const CLAIM_CONFIRM_RETRY_LIMIT = 5;

export const purchaseOwnLightningAddressClaim = async (args: {
  makeNip98AuthHeader: Nip98AuthHeaderFactory;
  payLightningInvoiceWithCashu: (invoice: string) => Promise<boolean>;
  preview: OwnLightningClaimAvailableResult;
  saveClaimedLightningAddress: (lightningAddress: string) => Promise<boolean>;
  serverBaseUrl: string;
}): Promise<
  { kind: "cancelled" | "success" } | { kind: "error"; message: string }
> => {
  const paid = await args.payLightningInvoiceWithCashu(
    args.preview.invoice.invoice,
  );
  if (!paid) return { kind: "cancelled" };

  for (let attempt = 0; attempt < CLAIM_CONFIRM_RETRY_LIMIT; attempt += 1) {
    const result = await finalizeOwnLightningAddressClaim({
      makeNip98AuthHeader: args.makeNip98AuthHeader,
      paymentToken: args.preview.paymentToken,
      serverBaseUrl: args.serverBaseUrl,
      username: args.preview.username,
    });

    if (result.kind === "success" || result.kind === "already_set") {
      const saved = await args.saveClaimedLightningAddress(
        args.preview.lightningAddress,
      );
      return saved ? { kind: "success" } : { kind: "cancelled" };
    }

    if (result.kind === "unpaid" && attempt + 1 < CLAIM_CONFIRM_RETRY_LIMIT) {
      await sleep(CLAIM_CONFIRM_RETRY_DELAY_MS);
      continue;
    }

    return { kind: "error", message: result.message };
  }

  return { kind: "error", message: INVOICE_UNPAID_MESSAGE };
};
