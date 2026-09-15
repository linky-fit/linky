import type { LinkyDbSchema } from "../model/schema";
import type { LinkyStore } from "../model/store";
import { tableRepository, type TableRepository } from "./tableRepository";

export type ContactsRepository = TableRepository<LinkyDbSchema["contact"]>;

/** Profiles and the user's overrides. Chat state lives in `conversations`. */
export const makeContactsRepository = (store: LinkyStore): ContactsRepository =>
  tableRepository(store, "contacts", "contact");
