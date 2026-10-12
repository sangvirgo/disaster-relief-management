import { AppModule } from '../src/app.module';
import { NeedsController } from '../src/needs/needs.controller';
import { NeedsModule } from '../src/needs/needs.module';

describe('NeedsModule registration', () => {
  it('is part of the Logistics application and owns the needs controller', async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:5432/c48_test';
    process.env.NODE_ENV = 'test';
    const { AppModule } = await import('../src/app.module');
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;

    expect(Reflect.getMetadata('imports', AppModule)).toContain(NeedsModule);
    expect(Reflect.getMetadata('controllers', NeedsModule)).toContain(NeedsController);
  });
});
