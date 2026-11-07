import { RemovalPolicy } from 'aws-cdk-lib';
import type { Environment } from 'aws-cdk-lib';
import type { Node } from 'constructs';

/** Short application name. Used for stack names and the `app` tag. */
export const APP_NAME = 'todo';

/** The stage that gets production safeguards (RETAIN, termination protection). */
export const PROD_STAGE = 'prod';

/** Stage used when no `-c stage=...` context is supplied. */
export const DEFAULT_STAGE = 'dev';

/**
 * Lowercase alphanumeric, starting with a letter, 2-12 chars. Stage names end up
 * in resource names (e.g. Cognito domain prefixes, S3 bucket names) that
 * have tight character rules, so keep this strict.
 */
const STAGE_PATTERN = /^[a-z][a-z0-9]{1,11}$/;

export interface StageConfig {
  /** Application name (`todo`). */
  readonly appName: string;
  /** Deployment stage, e.g. `dev` or `prod`. From the `stage` CDK context param. */
  readonly stage: string;
  /** True for the production stage. */
  readonly isProd: boolean;
  /** RETAIN in prod so data survives a stack delete; DESTROY elsewhere. */
  readonly removalPolicy: RemovalPolicy;
  /** Whether S3 buckets may be emptied on stack delete (never in prod). */
  readonly autoDeleteObjects: boolean;
  /**
   * Target account/region. Taken from the CLI's resolved credentials when present,
   * otherwise undefined (environment-agnostic synth, e.g. in CI without AWS creds).
   */
  readonly env: Environment;
  /**
   * Reserved concurrency for each API Lambda, from `-c reservedConcurrency=N`.
   * Unset means unreserved, which is the default because a reservation can fail
   * in accounts with a low concurrency quota.
   */
  readonly reservedConcurrency?: number;
}

/** Reads and validates the `stage` context param and derives per-stage settings. */
export function resolveStageConfig(
  node: Node,
  processEnv: NodeJS.ProcessEnv = process.env,
): StageConfig {
  const raw: unknown = node.tryGetContext('stage') ?? DEFAULT_STAGE;
  if (typeof raw !== 'string' || !STAGE_PATTERN.test(raw)) {
    throw new Error(
      `Invalid stage context ${JSON.stringify(raw)}: expected ${STAGE_PATTERN.source} (e.g. -c stage=dev).`,
    );
  }
  const stage = raw;
  const isProd = stage === PROD_STAGE;

  const account = processEnv.CDK_DEFAULT_ACCOUNT;
  const region = processEnv.CDK_DEFAULT_REGION;
  const env: Environment = {
    ...(account ? { account } : {}),
    ...(region ? { region } : {}),
  };

  const reservedConcurrency = parseReservedConcurrency(node.tryGetContext('reservedConcurrency'));

  return {
    appName: APP_NAME,
    stage,
    isProd,
    removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    autoDeleteObjects: !isProd,
    env,
    ...(reservedConcurrency !== undefined ? { reservedConcurrency } : {}),
  };
}

/** Context values from `-c` arrive as strings, so accept a numeric string or number. */
function parseReservedConcurrency(raw: unknown): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const value = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `Invalid reservedConcurrency context ${JSON.stringify(raw)}: expected a positive integer.`,
    );
  }
  return value;
}

/** Stack name for a logical stack, e.g. `Todo-dev-Auth`. */
export function stackName(config: StageConfig, logicalName: string): string {
  const app = config.appName.charAt(0).toUpperCase() + config.appName.slice(1);
  return `${app}-${config.stage}-${logicalName}`;
}
