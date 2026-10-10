import { Module } from '@nestjs/common';
import { AdminSecurityModule } from '../admin/admin-security.module';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({ imports: [AdminSecurityModule], controllers: [OrganizationsController], providers: [OrganizationsService] })
export class OrganizationsModule {}
