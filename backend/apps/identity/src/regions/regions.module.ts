import { Module } from '@nestjs/common';
import { AdminSecurityModule } from '../admin/admin-security.module';
import { RegionsController } from './regions.controller';
import { RegionsService } from './regions.service';

@Module({ imports: [AdminSecurityModule], controllers: [RegionsController], providers: [RegionsService] })
export class RegionsModule {}
