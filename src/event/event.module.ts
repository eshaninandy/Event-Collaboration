import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventService } from './event.service';
import { EventController } from './event.controller';
import { Event } from './entities/event.entity';
import { User } from '../user/entities/user.entity';
import { AuditLog } from '../audit-log/entities/audit-log.entity';
import { AiModule } from '../ai/ai.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Event, User, AuditLog]),
    AiModule,
    QueueModule,
  ],
  controllers: [EventController],
  providers: [EventService],
  exports: [EventService],
})
export class EventModule {}
