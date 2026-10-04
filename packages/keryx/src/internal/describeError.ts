import type { KeryxError } from "../errors";

export const describeError = (error: KeryxError): string => {
  switch (error._tag) {
    case "KeryxFetchFailed":
      return `${error.url}: ${error.reason}`;
    case "KeryxMetadataInvalid":
      return `${error.role}: ${error.reason}`;
    case "KeryxRollbackDetected":
      return `${error.role}: version ${error.receivedVersion} is older than the trusted ${error.trustedVersion}`;
    case "KeryxMetadataExpired":
      return `${error.role}: expired at ${error.expires}`;
    case "KeryxLiteModeUnsupported":
      return "lite mode is not supported";
  }
};
