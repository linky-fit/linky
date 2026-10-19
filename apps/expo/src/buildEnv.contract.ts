import type * as viteBuildEnv from "@linky-fit/linky-app/src/platform/buildEnv";
import * as expoBuildEnv from "./buildEnv";

// Fails to typecheck when the two modules export different names or types.
export const buildEnvContract: typeof viteBuildEnv = expoBuildEnv;
