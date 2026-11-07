#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { buildTodoApp } from '../lib/app';

// Stage is a context param: `cdk synth -c stage=prod` (defaults to `dev`).
buildTodoApp(new App());
