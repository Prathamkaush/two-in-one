import { Global, Module } from '@nestjs/common';
import { Settings } from './config/settings.service';
import { AdminGuard } from './security/admin.guard';
@Global()
@Module({ providers: [Settings, AdminGuard], exports: [Settings, AdminGuard] })
export class CommonModule {}
