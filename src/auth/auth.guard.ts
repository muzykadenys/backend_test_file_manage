import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { getSupabaseAuthVerifier } from '../lib/supabase';

export type AuthedRequest = Request & { userId: string; userEmail?: string };

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const auth = req.headers['authorization'];
    if (!auth || typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    const token = auth.slice('Bearer '.length).trim();
    const demo = process.env.DEMO_BEARER_TOKEN;
    if (!demo) {
      throw new UnauthorizedException('DEMO_BEARER_TOKEN is not configured');
    }
    if (token === demo) {
      const uid = req.headers['x-user-id'];
      if (!uid || typeof uid !== 'string') {
        throw new BadRequestException('X-User-Id header is required when using demo bearer token');
      }
      req.userId = uid;
      const xe = req.headers['x-user-email'];
      req.userEmail = typeof xe === 'string' && xe.trim() ? xe.trim() : undefined;
      return true;
    }
    const supabase = getSupabaseAuthVerifier();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.id) {
      throw new UnauthorizedException('Invalid session');
    }
    req.userId = data.user.id;
    req.userEmail = data.user.email ?? undefined;
    return true;
  }
}
