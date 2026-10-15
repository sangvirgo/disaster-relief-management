import 'reflect-metadata';
import dataSource from './data-source';

async function main(): Promise<void> {
  try {
    await dataSource.initialize();
    if (process.argv[2] === 'down') {
      await dataSource.undoLastMigration({ transaction: 'all' });
      process.stdout.write('Response schema migration reverted.\n');
    } else {
      const migrations = await dataSource.runMigrations({ transaction: 'all' });
      process.stdout.write('Response migrations applied: ' + migrations.length + '.\n');
    }
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

main().catch(() => {
  process.stderr.write('Response migration failed: MIGRATION_FAILED\n');
  process.exitCode = 1;
});
