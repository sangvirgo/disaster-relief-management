import { Module } from '@nestjs/common';
import { RequestIntakeModule } from '../requests/request-intake.module';
import { loadMapConfig, MAP_CONFIG } from './map.config';
import { MapController } from './map.controller';
import { MapService } from './map.service';

@Module({
  imports: [RequestIntakeModule],
  controllers: [MapController],
  providers: [
    { provide: MAP_CONFIG, useFactory: () => loadMapConfig() },
    MapService,
  ],
})
export class MapModule {}
