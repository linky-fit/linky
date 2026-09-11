import { writeContact } from "../lib/writeContact";
import { toContactTextFields } from "../lib/contactFields";
import { Option, Schema, Struct } from "effect";
import type * as Evolu from "@evolu/common";
import { ImportProofDraft, LegacyTokenRow, NewOperation } from "@linky/linkshu";
import type { StoredOperation, StoredProof } from "@linky/linkshu";
import React from "react";
import type { CashuTokenRow } from "../../evolu";
import { JsonValue } from "../../types/json";
import { nowSeconds } from "../../utils/time";
import { asRecord } from "../../utils/validation";
import { createCashuTokenId } from "../lib/cashuTokenIdentity";
import {
  CASHU_TOKEN_STATE_ACCEPTED,
  normalizeCashuTokenState,
} from "../lib/cashuTokenState";
import type { ContactRowLike } from "../types/appTypes";
import type { CashuTransferLifecycle } from "./composition/useLinkshuComposition";
import type { Translate } from "../../i18n";

type EvoluMutations = ReturnType<typeof import("../../evolu").useEvolu>;

const decodeImportProofDrafts = Schema.decodeUnknownOption(
  Schema.Array(ImportProofDraft),
);
const decodeNewOperation = Schema.decodeUnknownOption(NewOperation);
const decodeLegacyTokenRow = Schema.decodeUnknownOption(LegacyTokenRow);

interface UseAppDataTransferParams<TContact extends ContactRowLike> {
  appOwnerId: Evolu.OwnerId | null;
  cashuOperations: readonly StoredOperation[];
  cashuProofs: readonly StoredProof[];
  /** Legacy rows, exported so a backup imports into older releases too. */
  cashuTokens: readonly CashuTokenRow[];
  contacts: readonly TContact[];
  /** Null until the wallet runtime is ready to restore wallet rows. */
  importCashuLegacyRows: CashuTransferLifecycle["importLegacyRows"] | null;
  importCashuOperation: CashuTransferLifecycle["importOperation"] | null;
  importCashuProofs: CashuTransferLifecycle["importProofs"] | null;
  importDataFileInputRef: React.RefObject<HTMLInputElement | null>;
  insert: EvoluMutations["insert"];
  pushToast: (message: string) => void;
  t: Translate;
  update: EvoluMutations["update"];
}

export const useAppDataTransfer = <TContact extends ContactRowLike>({
  appOwnerId,
  cashuOperations,
  cashuProofs,
  cashuTokens,
  contacts,
  importCashuLegacyRows,
  importCashuOperation,
  importCashuProofs,
  importDataFileInputRef,
  insert,
  pushToast,
  t,
  update,
}: UseAppDataTransferParams<TContact>) => {
  const exportAppData = React.useCallback(() => {
    try {
      const now = new Date();
      const filenameDate = now.toISOString().slice(0, 10);

      const payload = {
        app: "linky",
        version: 2,
        exportedAt: now.toISOString(),
        contacts: contacts.map((contact) => ({
          name: (contact.name ?? "").trim() || null,
          npub: (contact.npub ?? "").trim() || null,
          lnAddress: (contact.lnAddress ?? "").trim() || null,
          groupName: (contact.groupName ?? "").trim() || null,
          groupNamesJson: (contact.groupNamesJson ?? "").trim() || null,
        })),
        cashuTokens: cashuTokens.map((token) => {
          const tokenText = (token.token ?? "").trim();
          const rawToken =
            (token.originalTokenText ?? "").trim() ||
            (token.rawToken ?? "").trim();
          return {
            token: tokenText,
            rawToken: rawToken && rawToken !== tokenText ? rawToken : null,
            state: (token.state ?? "").trim() || null,
            error: (token.error ?? "").trim() || null,
          };
        }),
        cashuProofs: cashuProofs.map((proof) => ({
          mint: proof.mint,
          unit: proof.unit,
          keysetId: proof.keysetId,
          amount: proof.amount,
          secret: proof.secret,
          C: proof.C,
          dleq: proof.dleq,
          state: proof.state,
          operationId: proof.operationId,
        })),
        cashuOperations: cashuOperations.map((operation) =>
          Struct.omit(operation, "id"),
        ),
      };

      const text = JSON.stringify(payload, null, 2);
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `linky-export-${filenameDate}.txt`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }, 1000);

      pushToast(t("exportDone"));
    } catch {
      pushToast(t("exportFailed"));
    }
  }, [cashuOperations, cashuProofs, cashuTokens, contacts, pushToast, t]);

  const requestImportAppData = React.useCallback(() => {
    const element = importDataFileInputRef.current;
    if (!element) return;
    try {
      element.click();
    } catch {
      // ignore
    }
  }, [importDataFileInputRef]);

  const importAppDataFromText = React.useCallback(
    async (text: string) => {
      const sanitizeText = (value: unknown, maxLen: number): string | null => {
        const raw = String(value ?? "").trim();
        if (!raw) return null;
        return raw.length > maxLen ? raw.slice(0, maxLen) : raw;
      };

      let parsed: JsonValue;
      try {
        parsed = Schema.decodeUnknownSync(Schema.parseJson(JsonValue))(text);
      } catch {
        pushToast(t("importInvalid"));
        return;
      }

      const root = asRecord(parsed);
      if (!root) {
        pushToast(t("importInvalid"));
        return;
      }

      const importedContacts = Array.isArray(root.contacts)
        ? root.contacts
        : [];
      const importedProofs = Array.isArray(root.cashuProofs)
        ? root.cashuProofs
        : [];
      const importedOperations = Array.isArray(root.cashuOperations)
        ? root.cashuOperations
        : [];
      // Version 1 backups carry token rows of the previous storage model;
      // they are ingested like the legacy table is on load.
      const importedTokens = Array.isArray(root.cashuTokens)
        ? root.cashuTokens
        : [];
      const hasWalletRows =
        importedProofs.length > 0 ||
        importedOperations.length > 0 ||
        importedTokens.length > 0;

      if (
        hasWalletRows &&
        (importCashuProofs === null ||
          importCashuOperation === null ||
          importCashuLegacyRows === null)
      ) {
        pushToast(t("importWalletNotReady"));
        return;
      }

      const existingByNpub = new Map<string, TContact>();
      const existingByLn = new Map<string, TContact>();
      for (const contact of contacts) {
        const npub = (contact.npub ?? "").trim();
        const ln = (contact.lnAddress ?? "").trim().toLowerCase();
        if (npub) existingByNpub.set(npub, contact);
        if (ln) existingByLn.set(ln, contact);
      }
      const insertedNpubs = new Set<string>();
      const insertedLnAddresses = new Set<string>();

      let addedContacts = 0;
      let updatedContacts = 0;
      let addedTokens = 0;

      for (const item of importedContacts) {
        const rec = asRecord(item);
        if (!rec) continue;

        const name = sanitizeText(rec.name, 1000);
        const npub = sanitizeText(rec.npub, 1000);
        const lnAddressRaw = sanitizeText(rec.lnAddress, 1000);
        const lnAddress = lnAddressRaw ? lnAddressRaw : null;
        const groupName = sanitizeText(rec.groupName, 1000);
        const groupNamesJson = sanitizeText(rec.groupNamesJson, 1000);

        if (!name && !npub && !lnAddress) continue;

        const existing =
          (npub ? existingByNpub.get(npub) : undefined) ??
          (lnAddress ? existingByLn.get(lnAddress.toLowerCase()) : undefined);
        const normalizedLnAddress = lnAddress?.toLowerCase() ?? null;
        if (
          !existing &&
          ((npub && insertedNpubs.has(npub)) ||
            (normalizedLnAddress &&
              insertedLnAddresses.has(normalizedLnAddress)))
        ) {
          continue;
        }

        const payload = toContactTextFields({
          name,
          npub,
          lnAddress,
          groupName,
          groupNamesJson,
        });

        if (existing && existing.id) {
          const id = existing.id;
          const previous = toContactTextFields(existing);
          const merged = {
            id,
            name: payload.name ?? previous.name,
            npub: payload.npub ?? previous.npub,
            lnAddress: payload.lnAddress ?? previous.lnAddress,
            groupName: payload.groupName ?? previous.groupName,
            groupNamesJson: payload.groupNamesJson ?? previous.groupNamesJson,
          };

          const result = writeContact(update, merged, appOwnerId);
          if (result.ok) updatedContacts += 1;
        } else {
          const result = writeContact(insert, payload, appOwnerId);
          if (result.ok) {
            addedContacts += 1;
            if (npub) insertedNpubs.add(npub);
            if (normalizedLnAddress) {
              insertedLnAddresses.add(normalizedLnAddress);
            }
          }
        }
      }

      if (
        importCashuProofs !== null &&
        importCashuOperation !== null &&
        importCashuLegacyRows !== null
      ) {
        // Operations first, so imported proofs can point at them.
        for (const item of importedOperations) {
          const draft = decodeNewOperation(item);
          if (Option.isNone(draft)) continue;
          await importCashuOperation(draft.value);
        }
        const drafts = decodeImportProofDrafts(importedProofs);
        if (Option.isSome(drafts) && drafts.value.length > 0) {
          addedTokens += await importCashuProofs(drafts.value);
        }
        const legacyRows = importedTokens.flatMap((item) => {
          const rec = asRecord(item);
          const token = String(rec?.token ?? "").trim();
          if (!rec || !token) return [];
          const row = decodeLegacyTokenRow({
            id: createCashuTokenId(token),
            originalTokenText: sanitizeText(rec.rawToken, 100000) ?? token,
            tokenText: token,
            state:
              normalizeCashuTokenState(rec.state) ?? CASHU_TOKEN_STATE_ACCEPTED,
            error: sanitizeText(rec.error, 1000),
            createdAt: nowSeconds(),
          });
          return Option.isSome(row) ? [row.value] : [];
        });
        if (legacyRows.length > 0) {
          const report = await importCashuLegacyRows(legacyRows);
          addedTokens += report.proofs;
        }
      }

      if (addedContacts === 0 && updatedContacts === 0 && addedTokens === 0) {
        pushToast(t("importNothing"));
        return;
      }

      pushToast(
        `${t("importDone")} (${addedContacts}/${updatedContacts}/${addedTokens})`,
      );
    },
    [
      appOwnerId,
      contacts,
      importCashuLegacyRows,
      importCashuOperation,
      importCashuProofs,
      insert,
      pushToast,
      t,
      update,
    ],
  );

  const handleImportAppDataFilePicked = React.useCallback(
    async (file: File | null) => {
      if (!file) return;
      try {
        const text = await file.text();
        await importAppDataFromText(text);
      } catch {
        pushToast(t("importFailed"));
      }
    },
    [importAppDataFromText, pushToast, t],
  );

  return {
    exportAppData,
    handleImportAppDataFilePicked,
    requestImportAppData,
  };
};
