import dotenv from 'dotenv';
import { DataSourceOptions } from 'typeorm';
import { BackendService, validateEnvironment } from './environment';

dotenv.config({ quiet: true });

export function postgresOptions(migrations: Function[], service: BackendService): DataSourceOptions {
  const config = validateEnvironment(process.env, service);
  return {
    type: 'postgres',
    url: config.databaseUrl,
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: 'typeorm_migrations',
    migrationsTransactionMode: 'all',
    migrations,
    extra: {
      connectionTimeoutMillis: 5000,
      max: config.dbPoolMax,
      application_name: `c48_${service}`,
      options: `-c lock_timeout=${config.dbLockTimeoutMs} -c statement_timeout=${config.dbStatementTimeoutMs}`,
    },
  };
}
