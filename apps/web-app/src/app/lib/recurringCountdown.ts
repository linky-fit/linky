/** `m:ss` until `targetSec`, never negative. */
export const formatCountdown = (targetSec: number, nowSec: number): string => {
  const remaining = Math.max(0, Math.ceil(targetSec - nowSec));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};
