import { Stack } from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { StageConfig } from '../config';
import { stackName } from '../config';

export interface TodoStackProps extends Omit<StackProps, 'env' | 'stackName'> {
  readonly config: StageConfig;
}

/**
 * Base class for every stack in the app. Applies the stage naming convention,
 * target environment and prod-only termination protection, and exposes the
 * stage config (incl. `removalPolicy`) to subclasses.
 */
export abstract class TodoStack extends Stack {
  readonly config: StageConfig;

  protected constructor(scope: Construct, logicalName: string, props: TodoStackProps) {
    const { config, ...stackProps } = props;
    super(scope, stackName(config, logicalName), {
      ...stackProps,
      stackName: stackName(config, logicalName),
      env: config.env,
      terminationProtection: stackProps.terminationProtection ?? config.isProd,
    });
    this.config = config;
  }
}
