/**
 * `@gandlaf21/bc-ur` ships no types; only the surface the animated QR uses is
 * declared, typed as the bytes it actually takes rather than the Buffer its
 * JSDoc claims. Why this package and this build path: `utils/animatedQr.ts`.
 */
declare module "@gandlaf21/bc-ur/dist/lib/es6/index.js" {
  export class UR {
    static fromBuffer(bytes: Uint8Array): UR;
    decodeCBOR(): Uint8Array;
    readonly type: string;
  }

  export class UREncoder {
    constructor(ur: UR, maxFragmentLength: number, firstSeqNum: number);
    readonly fragmentsLength: number;
    nextPart(): string;
  }

  export class URDecoder {
    receivePart(part: string): boolean;
    isComplete(): boolean;
    isError(): boolean;
    expectedPartCount(): number;
    receivedPartIndexes(): number[];
    resultUR(): UR;
  }
}
