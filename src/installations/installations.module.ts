import { Global, Module } from '@nestjs/common';
import { AdminTokenGuard } from './admin-token.guard';
import { InstallationsController } from './installations.controller';
import { InstallationsService } from './installations.service';

@Global()
@Module({
  controllers: [InstallationsController],
  providers: [InstallationsService, AdminTokenGuard],
  exports: [InstallationsService],
})
export class InstallationsModule {}
