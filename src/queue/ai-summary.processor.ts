import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { AiService } from '../ai/ai.service';
import { Event, EventStatus } from '../event/entities/event.entity';
import { AuditLog } from '../audit-log/entities/audit-log.entity';
import { User } from '../user/entities/user.entity';

export interface EventDataForAI {
  id: string;
  title: string;
  description: string | null;
  status: string;
  startTime: string;
  endTime: string;
  creator: {
    id: string;
    name: string;
    email: string;
  } | null;
  invitees: Array<{
    id: string;
    name: string;
    email: string;
  }>;
}

export interface AiSummaryJobData {
  eventData: EventDataForAI[];
  userId: string;
  mergedEventId: string;
  mergedEventIds: string[];
  auditLogId: string;
}

@Processor('ai-summary')
export class AiSummaryProcessor extends WorkerHost {
  private readonly logger = new Logger(AiSummaryProcessor.name);

  constructor(
    private readonly aiService: AiService,
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {
    super();
  }

  private convertEventDataToEvent(eventData: EventDataForAI): Event {
    const event = new Event();
    event.id = eventData.id;
    event.title = eventData.title;
    event.description = eventData.description;
    event.status = eventData.status as EventStatus;
    event.startTime = new Date(eventData.startTime);
    event.endTime = new Date(eventData.endTime);
    
    if (eventData.creator) {
      const creator = new User();
      creator.id = eventData.creator.id;
      creator.name = eventData.creator.name;
      creator.email = eventData.creator.email;
      event.creator = creator;
    }
    
    if (eventData.invitees && eventData.invitees.length > 0) {
      event.invitees = eventData.invitees.map((inv) => {
        const user = new User();
        user.id = inv.id;
        user.name = inv.name;
        user.email = inv.email;
        return user;
      });
    } else {
      event.invitees = [];
    }
    
    return event;
  }

  async process(job: Job<AiSummaryJobData>): Promise<string> {
    const { eventData, auditLogId } = job.data;
    
    if (!eventData || eventData.length === 0) {
      this.logger.warn(`No event data provided in job ${job.id}`);
      throw new Error('Event data not found in job');
    }

    const events = eventData.map((ed) => this.convertEventDataToEvent(ed));

    this.logger.log(
      `Processing AI summary job ${job.id} for events: ${events.map((e) => e.id).join(', ')}`,
    );

    try {
      const summary = await this.aiService.summarizeMergedEvents(events);

      const auditLog = await this.auditLogRepository.findOne({
        where: { id: auditLogId },
      });

      if (auditLog) {
        auditLog.notes = summary;
        await this.auditLogRepository.save(auditLog);
        this.logger.log(
          `Updated audit log ${auditLogId} with AI summary: ${summary}`,
        );
      } else {
        this.logger.warn(
          `Audit log ${auditLogId} not found, cannot update summary`,
        );
      }

      return summary;
    } catch (error) {
      this.logger.error(`Error processing AI summary job ${job.id}`, error);

      try {
        const auditLog = await this.auditLogRepository.findOne({
          where: { id: auditLogId },
        });
        if (auditLog) {
          const eventCount = eventData ? eventData.length : 0;
          auditLog.notes = `Merged ${eventCount} overlapping events`;
          await this.auditLogRepository.save(auditLog);
          this.logger.log(
            `Updated audit log ${auditLogId} with fallback summary`,
          );
        }
      } catch (updateError) {
        this.logger.error(
          `Failed to update audit log ${auditLogId} with fallback summary`,
          updateError,
        );
      }

      throw error;
    }
  }
}

