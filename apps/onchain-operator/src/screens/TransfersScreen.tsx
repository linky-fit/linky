import { Button, EmptyState, LoadingState, Section } from "@linky-fit/ui";
import { useState } from "react";
import { copy } from "../copy/en";
import { sortTransfers } from "../domain/transfer";
import { useTransfers } from "../services/react";
import { Page } from "./Page";
import { TransferRow } from "./TransferParts";

/** Open transfers first, the longest waiting on top, then the history; test transfers only on request. */
export function TransfersScreen() {
  const transfers = useTransfers();
  const [showTests, setShowTests] = useState(false);
  if (transfers === null) return <LoadingState label={copy.loading} />;
  const { open, closed, tests } = sortTransfers(transfers);
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
      {tests.length > 0 ? (
        <Button
          variant="secondary"
          size="sm"
          alignSelf="flex-start"
          icon={showTests ? "EyeOff" : "Eye"}
          onPress={() => setShowTests((shown) => !shown)}
        >
          {showTests
            ? copy.transfers.hideTests
            : copy.transfers.showTests(tests.length)}
        </Button>
      ) : null}
      {showTests && tests.length > 0 ? (
        <Section title={copy.transfers.tests}>
          {tests.map((transfer) => (
            <TransferRow key={transfer.id} transfer={transfer} />
          ))}
        </Section>
      ) : null}
    </Page>
  );
}
