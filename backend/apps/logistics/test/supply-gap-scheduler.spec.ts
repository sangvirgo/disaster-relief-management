import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { JobRunner } from '@c48/technical/persistence/jobs';
import {
  loadSupplyGapJobConfig, SUPPLY_GAP_JOB_INTERVAL_MS, SUPPLY_GAP_JOB_NAME, SupplyGapScheduler,
} from '../src/supply-gaps/supply-gap-scheduler.service';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('loadSupplyGapJobConfig', () => {
  it('runs the job when C48_SUPPLY_GAP_JOB_ENABLED is unset', () => {
    expect(loadSupplyGapJobConfig({})).toEqual({ enabled: true, intervalMs: 15 * 60_000 });
  });

  it('runs the job when the variable is true', () => {
    expect(loadSupplyGapJobConfig({ C48_SUPPLY_GAP_JOB_ENABLED: 'true' }).enabled).toBe(true);
  });

  it('disables the job when the variable is false', () => {
    expect(loadSupplyGapJobConfig({ C48_SUPPLY_GAP_JOB_ENABLED: 'false' })).toMatchObject({ enabled: false });
  });

  it('fails startup on any other value so a typo cannot silently turn the job off or on', () => {
    expect(() => loadSupplyGapJobConfig({ C48_SUPPLY_GAP_JOB_ENABLED: 'no' })).toThrow('C48_SUPPLY_GAP_JOB_ENABLED');
    expect(() => loadSupplyGapJobConfig({ C48_SUPPLY_GAP_JOB_ENABLED: '' })).toThrow('C48_SUPPLY_GAP_JOB_ENABLED');
    expect(() => loadSupplyGapJobConfig({ C48_SUPPLY_GAP_JOB_ENABLED: 'FALSE' })).toThrow('C48_SUPPLY_GAP_JOB_ENABLED');
  });
});

describe('SupplyGapScheduler', () => {
  const dataSource = {} as never;
  const gaps = { recompute: jest.fn(async () => ({ warehouses: 0, failed: 0 })) } as never;

  it('schedules nothing when the job is disabled by environment', () => {
    const schedule = jest.spyOn(JobRunner.prototype, 'schedule');
    const scheduler = new SupplyGapScheduler({ enabled: false, intervalMs: SUPPLY_GAP_JOB_INTERVAL_MS }, gaps, dataSource);
    scheduler.onModuleInit();
    expect(schedule).not.toHaveBeenCalled();
    expect(() => scheduler.onModuleDestroy()).not.toThrow();
  });

  it('schedules the 15-minute recomputation under its job name when enabled, and stops it on shutdown', () => {
    const stop = jest.fn();
    const schedule = jest.spyOn(JobRunner.prototype, 'schedule').mockReturnValue(stop);
    const scheduler = new SupplyGapScheduler({ enabled: true, intervalMs: SUPPLY_GAP_JOB_INTERVAL_MS }, gaps, dataSource);
    scheduler.onModuleInit();
    expect(schedule).toHaveBeenCalledWith(SUPPLY_GAP_JOB_NAME, 15 * 60_000, expect.any(Function), true);
    scheduler.onModuleDestroy();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('runs the recomputation as the scheduled work', async () => {
    const recompute = jest.fn(async () => ({ warehouses: 1, failed: 0 }));
    jest.spyOn(JobRunner.prototype, 'schedule').mockImplementation((_name, _interval, work) => {
      void work({} as never);
      return () => undefined;
    });
    const scheduler = new SupplyGapScheduler({ enabled: true, intervalMs: SUPPLY_GAP_JOB_INTERVAL_MS }, { recompute } as never, dataSource);
    scheduler.onModuleInit();
    await Promise.resolve();
    expect(recompute).toHaveBeenCalledTimes(1);
  });
});
