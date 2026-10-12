import type * as viteBuildEnv from "@linky-fit/linky-app/src/platform/buildEnv.ts";
import * as expoBuildEnv from "./buildEnv.ts";

// Fails to typecheck when the two modules export different names or types.
export const buildEnvContract: typeof viteBuildEnv = expoBuildEnv;
