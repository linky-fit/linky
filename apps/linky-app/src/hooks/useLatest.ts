import React from "react";

/** Ref that always holds the latest value (updated during render). */
export const useLatest = <T>(value: T): React.RefObject<T> => {
  const ref = React.useRef(value);
  // eslint-disable-next-line react-hooks/refs -- deliberate latest-value mirror
  ref.current = value;
  return ref;
};
