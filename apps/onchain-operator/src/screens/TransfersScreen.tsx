import { Button, EmptyState, LoadingState, Section } from "@linky-fit/ui";
import { useState } from "react";
import { copy } from "../copy/en";
import { sortTransfers, type OperatorTransfer } from "../domain/transfer";
import { useTransfers } from "../services/react";
import { Page } from "./Page";
import { TransferRow } from "./TransferParts";

/** A toggle and the transfers it shows, e.g. the cancelled or the test transfers. */
function HiddenTransfers({
  title,
  showLabel,
  hideLabel,
  transfers,
}: {
  readonly title: string;
  readonly showLabel: (count: number) => string;
  readonly hideLabel: string;
  readonly transfers: readonly OperatorTransfer[];
}) {
  const [shown, setShown] = useState(false);
  if (transfers.length === 0) return null;
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        alignSelf="flex-start"
        icon={shown ? "EyeOff" : "Eye"}
        onPress={() => setShown((current) => !current)}
      >
        {shown ? hideLabel : showLabel(transfers.length)}
      </Button>
      {shown ? (
        <Section title={title}>
          {transfers.map((transfer) => (
            <TransferRow key={transfer.id} transfer={transfer} />
          ))}
        </Section>
      ) : null}
    </>
  );
}

/** Open transfers first, the longest waiting on top, then the history; cancelled and test transfers only on request. */
export function TransfersScreen() {
  const transfers = useTransfers();
  if (transfers === null) return <LoadingState label={copy.loading} />;
  const { open, closed, cancelled, tests } = sortTransfers(transfers);
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
      <HiddenTransfers
        title={copy.transfers.cancelled}
        showLabel={copy.transfers.showCancelled}
        hideLabel={copy.transfers.hideCancelled}
        transfers={cancelled}
      />
      <HiddenTransfers
        title={copy.transfers.tests}
        showLabel={copy.transfers.showTests}
        hideLabel={copy.transfers.hideTests}
        transfers={tests}
      />
    </Page>
  );
}
