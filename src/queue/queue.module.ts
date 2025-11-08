import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiSummaryProcessor } from './ai-summary.processor';
import { AiModule } from '../ai/ai.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { Event } from '../event/entities/event.entity';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const redisConfig: any = {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
        };
        
        const password = configService.get<string>('REDIS_PASSWORD');
        if (password) {
          redisConfig.password = password;
        }
        
        return {
          connection: redisConfig,
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: 'ai-summary',
    }),
    AiModule,
    AuditLogModule,
  ],
  providers: [AiSummaryProcessor],
  exports: [BullModule],
})
export class QueueModule {}

