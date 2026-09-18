import * as Evolu from "@evolu/common";

// Branded ids come from the synced storage package; this module keeps the
// import path lightweight hooks use without initializing the database.
export { ContactId, TransactionId } from "@linky-fit/linksync";

export const RecurringPaymentId = Evolu.id("RecurringPayment");
export type RecurringPaymentId = typeof RecurringPaymentId.Type;
