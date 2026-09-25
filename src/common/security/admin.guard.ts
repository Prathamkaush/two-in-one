import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { Settings } from '../config/settings.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly settings: Settings) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const actual = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${this.settings.get('ADMIN_API_KEY')}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new UnauthorizedException();
    return true;
  }
}
