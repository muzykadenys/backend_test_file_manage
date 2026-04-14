import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { getSupabaseAuthFlow } from '../lib/supabase';
import { LoginDto, RegisterDto } from './dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  @Post('register')
  @ApiOperation({ summary: 'Register a new user (Supabase Auth admin)' })
  async register(@Body() body: RegisterDto) {
    const supabase = getSupabaseAuthFlow();
    const { data, error } = await supabase.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
    });
    if (error) {
      return { ok: false, message: error.message };
    }
    return {
      ok: true,
      user: { id: data.user?.id, email: data.user?.email },
    };
  }

  @Post('login')
  @ApiOperation({ summary: 'Login; returns Supabase access token for API calls' })
  async login(@Body() body: LoginDto) {
    const supabase = getSupabaseAuthFlow();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });
    if (error || !data.session) {
      return { ok: false, message: error?.message ?? 'Login failed' };
    }
    return {
      ok: true,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      user: { id: data.user.id, email: data.user.email },
    };
  }
}
