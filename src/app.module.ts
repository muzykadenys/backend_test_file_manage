import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { ItemsModule } from './items/items.module';
import { PublicModule } from './public/public.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
    AuthModule,
    ItemsModule,
    PublicModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
