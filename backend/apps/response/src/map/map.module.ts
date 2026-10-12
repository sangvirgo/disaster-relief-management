import { Module } from '@nestjs/common';
import { RequestIntakeModule } from '../requests/request-intake.module';
import { MapController } from './map.controller';
import { MapService } from './map.service';

@Module({
  imports: [RequestIntakeModule],
  controllers: [MapController],
  providers: [MapService],
})
export class MapModule {}
