import { AttachmentsModule } from '../src/attachments/attachments.module';
import { DistributionsModule } from '../src/distributions/distributions.module';
import { DrivesModule } from '../src/drives/drives.module';
import { EvidenceController } from '../src/evidence/evidence.controller';
import { EvidenceModule } from '../src/evidence/evidence.module';

type ModuleType = { name: string };
type Provider = Function | { provide?: unknown };

function moduleNames(moduleType: ModuleType): string[] {
  const imports = Reflect.getMetadata('imports', moduleType) as ModuleType[] | undefined;
  return (imports ?? []).map((imported) => imported.name);
}

function providerNames(moduleType: ModuleType): string[] {
  const providers = Reflect.getMetadata('providers', moduleType) as Provider[] | undefined;
  return (providers ?? []).map((provider) => typeof provider === 'function'
    ? provider.name
    : String(provider.provide));
}

describe('Logistics attachment module boundaries', () => {
  it('keeps the shared module independent from donation and distribution features', () => {
    expect(moduleNames(AttachmentsModule)).not.toContain(DrivesModule.name);
    expect(moduleNames(AttachmentsModule)).not.toContain(DistributionsModule.name);
    expect(providerNames(AttachmentsModule)).toContain('AttachmentLifecycleService');
    expect(providerNames(AttachmentsModule)).not.toContain('LogisticsAttachmentsService');
  });

  it('keeps donation and handoff workflows in their owning feature modules', () => {
    expect(providerNames(DrivesModule)).toContain('DonationAttachmentsService');
    expect(providerNames(DistributionsModule)).toContain('HandoffAttachmentsService');
  });

  it('composes the shared download route above both feature modules', () => {
    expect(moduleNames(EvidenceModule)).toEqual(expect.arrayContaining([
      AttachmentsModule.name, DrivesModule.name, DistributionsModule.name,
    ]));
    const controllers = Reflect.getMetadata('controllers', EvidenceModule) as ModuleType[];
    expect(controllers.map((controller) => controller.name)).toContain(EvidenceController.name);
  });
});
