import React from "react";

interface UseArmedDeleteTimeoutsParams<TPendingCashuDelete> {
  pendingCashuDeleteId: TPendingCashuDelete | null;
  pendingEvoluServerDeleteUrl: string | null;
  pendingMintDeleteUrl: string | null;
  setPendingCashuDeleteId: React.Dispatch<
    React.SetStateAction<TPendingCashuDelete | null>
  >;
  setPendingEvoluServerDeleteUrl: React.Dispatch<
    React.SetStateAction<string | null>
  >;
  setPendingMintDeleteUrl: React.Dispatch<React.SetStateAction<string | null>>;
}

const useResetAfterDelay = <TValue>({
  delayMs,
  setValue,
  value,
}: {
  delayMs: number;
  setValue: React.Dispatch<React.SetStateAction<TValue | null>>;
  value: TValue | null;
}) => {
  React.useEffect(() => {
    if (value === null) return;
    const timeoutId = window.setTimeout(() => {
      setValue(null);
    }, delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [delayMs, setValue, value]);
};

export const useArmedDeleteTimeouts = <TPendingCashuDelete>({
  pendingCashuDeleteId,
  pendingEvoluServerDeleteUrl,
  pendingMintDeleteUrl,
  setPendingCashuDeleteId,
  setPendingEvoluServerDeleteUrl,
  setPendingMintDeleteUrl,
}: UseArmedDeleteTimeoutsParams<TPendingCashuDelete>): void => {
  useResetAfterDelay({
    delayMs: 5000,
    setValue: setPendingCashuDeleteId,
    value: pendingCashuDeleteId,
  });
  useResetAfterDelay({
    delayMs: 5000,
    setValue: setPendingMintDeleteUrl,
    value: pendingMintDeleteUrl,
  });
  useResetAfterDelay({
    delayMs: 5000,
    setValue: setPendingEvoluServerDeleteUrl,
    value: pendingEvoluServerDeleteUrl,
  });
};
