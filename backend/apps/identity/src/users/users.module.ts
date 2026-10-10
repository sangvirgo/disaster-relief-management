import { Module } from '@nestjs/common';
import { AdminSecurityModule } from '../admin/admin-security.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({ imports: [AdminSecurityModule], controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
