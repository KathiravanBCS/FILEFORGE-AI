import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import {
  getOptionsToken,
  getStorageToken,
  ThrottlerGuard,
  ThrottlerModule,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { AccountController, WorkspaceController } from './modules/controller.js';
import { HealthController } from './modules/health.js';
import { SessionGuard, WorkspaceGuard } from './guards/auth.js';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
  controllers: [HealthController, AccountController, WorkspaceController],
  providers: [
    SessionGuard,
    WorkspaceGuard,
    {
      provide: APP_GUARD,
      inject: [getOptionsToken(), getStorageToken(), Reflector],
      // Resolve Reflector from this application's Nest context. Package-manager peer
      // contexts can give a dependency's emitted metadata a different class identity.
      useFactory: (
        options: ThrottlerModuleOptions,
        storage: ThrottlerStorage,
        reflector: Reflector,
      ) => new ThrottlerGuard(options, storage, reflector),
    },
  ],
})
export class AppModule {}
