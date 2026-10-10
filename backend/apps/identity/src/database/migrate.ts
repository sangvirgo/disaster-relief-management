import 'reflect-metadata';
import dataSource from './data-source';

async function main(): Promise<void> {
  try {
    await dataSource.initialize();
    if (process.argv[2] === 'down') {
      await dataSource.undoLastMigration({ transaction: 'all' });
      process.stdout.write('Identity schema migration reverted.\n');
    } else {
      const migrations = await dataSource.runMigrations({ transaction: 'all' });
      process.stdout.write('Identity migrations applied: ' + migrations.length + '.\n');
    }
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write('Identity migration failed: ' + (error instanceof Error ? error.message : 'unknown error') + '\n');
  process.exitCode = 1;
});
