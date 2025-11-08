import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiService } from './ai.service';
import { CacheService } from './cache.service';

@Module({
  imports: [ConfigModule],
  providers: [AiService, CacheService],
  exports: [AiService, CacheService],
})
export class AiModule {}

