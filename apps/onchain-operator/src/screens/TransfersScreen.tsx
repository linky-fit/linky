import { EmptyState, LoadingState, Section } from "@linky-fit/ui";
import { copy } from "../copy/en";
import { sortTransfers } from "../domain/transfer";
import { useTransfers } from "../services/react";
import { Page } from "./Page";
import { TransferRow } from "./TransferParts";

/** Open transfers first, the longest waiting on top, then the history. */
export function TransfersScreen() {
  const transfers = useTransfers();
  if (transfers === null) return <LoadingState label={copy.loading} />;
  const { open, closed } = sortTransfers(transfers);
  return (
    <Page title={copy.sections.transfers} testID="transfers-screen">
      {transfers.length === 0 ? (
        <EmptyState
          icon="Repeat"
          title={copy.transfers.emptyTitle}
          description={copy.transfers.emptyDescription}
        />
      ) : null}
      {open.length > 0 ? (
        <Section title={copy.transfers.open}>
          {open.map((transfer) => (
            <TransferRow key={transfer.id} transfer={transfer} />
          ))}
        </Section>
      ) : null}
      {closed.length > 0 ? (
        <Section title={copy.transfers.history}>
          {closed.map((transfer) => (
            <TransferRow key={transfer.id} transfer={transfer} />
          ))}
        </Section>
      ) : null}
    </Page>
  );
}
