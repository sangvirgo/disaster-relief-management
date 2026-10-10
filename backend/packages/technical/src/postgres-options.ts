import { DataSourceOptions } from 'typeorm';

export function postgresOptions(migrations: Function[]): DataSourceOptions {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }

  return {
    type: 'postgres',
    url,
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: 'typeorm_migrations',
    migrationsTransactionMode: 'all',
    migrations,
    extra: {
      connectionTimeoutMillis: 5000,
      max: Number(process.env.DB_POOL_MAX ?? 20),
    },
  };
}
