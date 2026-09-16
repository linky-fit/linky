import { parsePubkey } from "@linky/linkstr";
import { Schema } from "effect";
import { UnknownRecord } from "../../utils/schema";
import { safeLocalStorageGetJson } from "../../utils/storage";
import { trimString } from "../../utils/validation";
import type { LocalPendingPayment } from "../types/appTypes";

export const readPendingPayments = (key: string): LocalPendingPayment[] =>
  safeLocalStorageGetJson(key, Schema.Array(UnknownRecord), [])
    .map((payment) => {
      const recipientPubkey = parsePubkey(trimString(payment.recipientPubkey));
      const messageId = trimString(payment.messageId);
      return {
        id: trimString(payment.id),
        contactId: trimString(payment.contactId),
        amountSat: Math.max(0, Math.trunc(Number(payment.amountSat ?? 0) || 0)),
        createdAtSec: Math.max(
          0,
          Math.trunc(Number(payment.createdAtSec ?? 0) || 0),
        ),
        ...(recipientPubkey ? { recipientPubkey } : {}),
        ...(messageId ? { messageId } : {}),
      };
    })
    .filter(
      (payment) => payment.id && payment.contactId && payment.amountSat > 0,
    );
