import { MISSIONS_CONFIG } from '../src/missions/missions.config';
import { MissionsModule } from '../src/missions/missions.module';
import { ReportsModule } from '../src/reports/reports.module';

describe('ReportsModule configuration ownership', () => {
  it('uses the missions module configuration provider', () => {
    expect(Reflect.getMetadata('exports', MissionsModule)).toContain(MISSIONS_CONFIG);
    expect(Reflect.getMetadata('imports', ReportsModule)).toContain(MissionsModule);
    expect(Reflect.getMetadata('providers', ReportsModule)).not.toContainEqual(
      expect.objectContaining({ provide: MISSIONS_CONFIG }),
    );
  });
});
