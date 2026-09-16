import type { Knex } from 'knex';
import type { AppConfig } from './config';
import type { Logger } from './logger';

/** Dependencies injected into createApp and every router factory. */
export interface AppDeps {
  config: AppConfig;
  db: Knex;
  logger: Logger;
  /** Epoch ms; injectable for tests. */
  now(): number;
}
