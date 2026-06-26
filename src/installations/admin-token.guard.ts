import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { AppConfigService } from '../config/app-config.service';

// Protects the installation-settings API. The endpoints are disabled entirely unless
// ADMIN_API_TOKEN is configured, so the management surface is never accidentally open.
@Injectable()
export class AdminTokenGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.adminApiToken;
    if (!expected) {
      throw new UnauthorizedException('Admin API is disabled (ADMIN_API_TOKEN not set)');
    }
    const provided = context.switchToHttp().getRequest<Request>().header('x-admin-token') ?? '';
    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided);
    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      throw new UnauthorizedException('Invalid admin token');
    }
    return true;
  }
}
