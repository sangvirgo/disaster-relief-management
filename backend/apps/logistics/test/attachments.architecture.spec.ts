import { AttachmentsModule } from '../src/attachments/attachments.module';
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
  it('keeps the shared module independent from the donation feature', () => {
    expect(moduleNames(AttachmentsModule)).not.toContain(DrivesModule.name);
    expect(providerNames(AttachmentsModule)).toContain('AttachmentLifecycleService');
    expect(providerNames(AttachmentsModule)).not.toContain('LogisticsAttachmentsService');
  });

  it('keeps the donation workflow in its owning feature module', () => {
    expect(providerNames(DrivesModule)).toContain('DonationAttachmentsService');
  });

  it('composes the shared download route above the donation feature', () => {
    expect(moduleNames(EvidenceModule)).toEqual(expect.arrayContaining([
      AttachmentsModule.name, DrivesModule.name,
    ]));
    const controllers = Reflect.getMetadata('controllers', EvidenceModule) as ModuleType[];
    expect(controllers.map((controller) => controller.name)).toContain(EvidenceController.name);
  });
});
