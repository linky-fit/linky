# @linky/domain

The branded ids every Linky package and the app share: `ContactId`, `ConversationId`, `MessageId`, `ReactionId`, `CashuProofId`, `CashuOperationId`, `TransactionId`, `RecurringPaymentId`, `NostrIdentityId`, `ShardPointerId`, `SettingId`, their deterministic derivations (`cashuProofIdFor`, `cashuOperationIdFor`, `directConversationIdFor`, `settingIdFor`, `activeNostrIdentityId`) and `createId` for a fresh one.

They are Evolu `id()` brands because the rows they name live in `@linky/linksync`; this package exists so a domain package (`@linky/recurring-payment`, ...) can type its model with the same brands without depending on the storage package. A brand travels with its type across the whole stack: a package never widens an id to `string` at its boundary.
