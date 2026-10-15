import React from "react";

interface BootCommitSignalProps {
  onCommit: () => void;
}

export const BootCommitSignal = ({ onCommit }: BootCommitSignalProps) => {
  React.useLayoutEffect(() => {
    onCommit();
  }, [onCommit]);

  return null;
};
