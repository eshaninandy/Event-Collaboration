import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Event, EventStatus } from './entities/event.entity';
import { User } from '../user/entities/user.entity';
import { AuditLog } from '../audit-log/entities/audit-log.entity';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { BatchCreateEventDto } from './dto/batch-create-event.dto';
import { AiService } from '../ai/ai.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);

  constructor(
    @InjectRepository(Event)
    private eventRepository: Repository<Event>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
    private dataSource: DataSource,
    @Optional() private aiService?: AiService,
    @Optional() @InjectQueue('ai-summary') private aiSummaryQueue?: Queue,
  ) {}

  // Creates a new event
  async create(createEventDto: CreateEventDto): Promise<Event> {
    const creator = await this.userRepository.findOne({
      where: { id: createEventDto.creatorId },
    });

    if (!creator) {
      throw new NotFoundException(
        `User with ID ${createEventDto.creatorId} not found`,
      );
    }

    const startTime = new Date(createEventDto.startTime);
    const endTime = new Date(createEventDto.endTime);

    if (startTime >= endTime) {
      throw new BadRequestException('startTime must be before endTime');
    }

    if (!createEventDto.inviteeIds || createEventDto.inviteeIds.length === 0) {
      throw new BadRequestException('At least one invitee is required');
    }

    if (createEventDto.inviteeIds.includes(createEventDto.creatorId)) {
      throw new BadRequestException(
        'Creator cannot be in the invitee list. Invitees must be different from the creator.',
      );
    }

    const foundInvitees = await this.userRepository.find({
      where: { id: In(createEventDto.inviteeIds) },
    });

    if (foundInvitees.length !== createEventDto.inviteeIds.length) {
      throw new NotFoundException('One or more invitee IDs not found');
    }

    const invitees = foundInvitees;

    const event = this.eventRepository.create({
      title: createEventDto.title,
      description: createEventDto.description,
      status: createEventDto.status,
      startTime,
      endTime,
      creator,
      invitees,
    });

    return await this.eventRepository.save(event);
  }

  /**
   * Batch creates up to 500 events using efficient bulk inserts with transactions.
   * Must complete in under 2 seconds for optimal performance.
   * 
   * @param batchDto - Batch of events to create (max 500)
   * @returns Array of created events
   */
  async batchCreate(batchDto: BatchCreateEventDto): Promise<Event[]> {
    const startTime = Date.now();
    this.logger.log(`Starting batch create for ${batchDto.events.length} events`);

    if (batchDto.events.length === 0) {
      throw new BadRequestException('Events array cannot be empty');
    }

    if (batchDto.events.length > 500) {
      throw new BadRequestException('Maximum 500 events allowed per batch');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const creatorIds = [
        ...new Set(batchDto.events.map((e) => e.creatorId)),
      ];
      const allInviteeIds = batchDto.events
        .flatMap((e) => e.inviteeIds || [])
        .filter((id, index, arr) => arr.indexOf(id) === index);

      const users = await queryRunner.manager.find(User, {
        where: [
          { id: In(creatorIds) },
          ...(allInviteeIds.length > 0 ? [{ id: In(allInviteeIds) }] : []),
        ],
      });

      const userMap = new Map<string, User>();
      users.forEach((user) => userMap.set(user.id, user));

      const missingCreators = creatorIds.filter((id) => !userMap.has(id));
      if (missingCreators.length > 0) {
        throw new NotFoundException(
          `Users not found: ${missingCreators.join(', ')}`,
        );
      }

      for (const dto of batchDto.events) {
        if (!dto.inviteeIds || dto.inviteeIds.length === 0) {
          throw new BadRequestException(
            `Event "${dto.title}": At least one invitee is required`,
          );
        }
      }

      const missingInvitees = allInviteeIds.filter((id) => !userMap.has(id));
      if (missingInvitees.length > 0) {
        throw new NotFoundException(
          `Invitees not found: ${missingInvitees.join(', ')}`,
        );
      }

      for (const dto of batchDto.events) {
        if (dto.inviteeIds.includes(dto.creatorId)) {
          throw new BadRequestException(
            `Event "${dto.title}": Creator cannot be in the invitee list. Invitees must be different from the creator.`,
          );
        }
      }

      for (const dto of batchDto.events) {
        const startTime = new Date(dto.startTime);
        const endTime = new Date(dto.endTime);
        if (startTime >= endTime) {
          throw new BadRequestException(
            `Event "${dto.title}" has invalid time range: startTime must be before endTime`,
          );
        }
      }

      const eventsToInsert: Partial<Event>[] = [];
      const inviteeMap = new Map<number, string[]>();

      batchDto.events.forEach((dto, index) => {
        const creator = userMap.get(dto.creatorId)!;
        const invitees = (dto.inviteeIds || []).map((id) => userMap.get(id)!);

        eventsToInsert.push({
          id: uuidv4(),
          title: dto.title,
          description: dto.description,
          status: dto.status,
          startTime: new Date(dto.startTime),
          endTime: new Date(dto.endTime),
          creator,
          invitees: [],
        });

        if (invitees.length > 0) {
          inviteeMap.set(index, dto.inviteeIds!);
        }
      });

      const createdEvents = await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(Event)
        .values(eventsToInsert)
        .returning('*')
        .execute();

      const insertedEvents = createdEvents.raw as Event[];

      if (inviteeMap.size > 0) {
        const inviteeRelations: Array<{
          event_id: string;
          user_id: string;
        }> = [];

        inviteeMap.forEach((inviteeIds, eventIndex) => {
          const event = insertedEvents[eventIndex];
          inviteeIds.forEach((inviteeId) => {
            inviteeRelations.push({
              event_id: event.id,
              user_id: inviteeId,
            });
          });
        });

        if (inviteeRelations.length > 0) {
          const values = inviteeRelations
            .map((rel) => `('${rel.event_id}', '${rel.user_id}')`)
            .join(', ');
          
          await queryRunner.manager.query(
            `INSERT INTO event_invitees (event_id, user_id) VALUES ${values} ON CONFLICT DO NOTHING`,
          );
        }
      }

      const eventIds = insertedEvents.map((e) => e.id);
      const fullEvents = await queryRunner.manager.find(Event, {
        where: { id: In(eventIds) },
        relations: ['creator', 'invitees'],
      });

      await queryRunner.commitTransaction();

      const duration = Date.now() - startTime;
      this.logger.log(
        `Batch create completed: ${fullEvents.length} events in ${duration}ms`,
      );

      if (duration > 2000) {
        this.logger.warn(
          `Batch create took ${duration}ms, exceeding 2 second target`,
        );
      }

      return fullEvents;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Batch create failed, transaction rolled back', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // Gets an event by its ID
  async getEventById(id: string): Promise<Event> {
    const event = await this.eventRepository.findOne({
      where: { id },
      relations: ['creator', 'invitees'],
    });

    if (!event) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }

    return event;
  }

  // Updates an event - change start or end time, invitees, title, description, status
  async update(id: string, updateEventDto: UpdateEventDto): Promise<Event> {
    const event = await this.getEventById(id);

    if (updateEventDto.startTime || updateEventDto.endTime) {
      const startTime = updateEventDto.startTime
        ? new Date(updateEventDto.startTime)
        : event.startTime;
      const endTime = updateEventDto.endTime
        ? new Date(updateEventDto.endTime)
        : event.endTime;

      if (startTime >= endTime) {
        throw new BadRequestException('startTime must be before endTime');
      }
    }

    if (updateEventDto.inviteeIds) {
      if (updateEventDto.inviteeIds.includes(event.creator.id)) {
        throw new BadRequestException(
          'Creator cannot be in the invitee list. Invitees must be different from the creator.',
        );
      }

      const invitees = await this.userRepository.find({
        where: { id: In(updateEventDto.inviteeIds) },
      });

      if (invitees.length !== updateEventDto.inviteeIds.length) {
        throw new NotFoundException('One or more invitee IDs not found');
      }

      event.invitees = invitees;
    }

    Object.assign(event, {
      ...updateEventDto,
      startTime: updateEventDto.startTime
        ? new Date(updateEventDto.startTime)
        : event.startTime,
      endTime: updateEventDto.endTime
        ? new Date(updateEventDto.endTime)
        : event.endTime,
    });

    return await this.eventRepository.save(event);
  }


  // Removes an event from the database
  async remove(id: string): Promise<void> {
    const event = await this.getEventById(id);
    await this.eventRepository.remove(event);
  }

  // Finds all conflicting events for a user
  async findConflicts(userId: string): Promise<Event[]> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const events = await this.eventRepository
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.creator', 'creator')
      .leftJoinAndSelect('event.invitees', 'invitees')
      .where('creator.id = :userId', { userId })
      .orWhere('invitees.id = :userId', { userId })
      .getMany();

    const conflicts: Event[] = [];

    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const event1 = events[i];
        const event2 = events[j];

        if (this.isOverlapping(event1, event2, userId)) {
          if (!conflicts.includes(event1)) {
            conflicts.push(event1);
          }
          if (!conflicts.includes(event2)) {
            conflicts.push(event2);
          }
        }
      }
    }

    return conflicts;
  }

  // Merges all overlapping events for a user
  async mergeAll(userId: string): Promise<Event> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const events = await this.eventRepository
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.creator', 'creator')
      .leftJoinAndSelect('event.invitees', 'invitees')
      .where('creator.id = :userId', { userId })
      .orWhere('invitees.id = :userId', { userId })
      .getMany();

    if (events.length < 2) {
      throw new BadRequestException(
        'Need at least 2 events to perform merge operation',
      );
    }

    const mergeableEvents = events.filter(
      (e) => e.status !== EventStatus.CANCELED,
    );

    if (mergeableEvents.length < 2) {
      throw new BadRequestException(
        'Need at least 2 non-canceled events to perform merge operation',
      );
    }

    const groups = this.groupOverlappingEvents(mergeableEvents, userId);

    if (groups.length === 0) {
      throw new BadRequestException('No overlapping events found to merge');
    }

    const largestGroup = groups.reduce((prev, current) =>
      current.length > prev.length ? current : prev,
    );

    const eventIds = largestGroup.map((e) => e.id);
    const eventDataForAI = largestGroup.map((event) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      status: event.status,
      startTime: event.startTime.toISOString(),
      endTime: event.endTime.toISOString(),
      creator: event.creator
        ? {
            id: event.creator.id,
            name: event.creator.name,
            email: event.creator.email,
          }
        : null,
      invitees: event.invitees
        ? event.invitees.map((inv) => ({
            id: inv.id,
            name: inv.name,
            email: inv.email,
          }))
        : [],
    }));

    const mergedEvent = await this.mergeEvents(largestGroup, userId);

    const auditLog = this.auditLogRepository.create({
      userId,
      newEventId: mergedEvent.id,
      mergedEventIds: eventIds,
      notes: null,
    });

    const savedAuditLog = await this.auditLogRepository.save(auditLog);

    if (this.aiSummaryQueue && this.aiService) {
      try {
        await this.aiSummaryQueue.add(
          'summarize',
          {
            eventData: eventDataForAI,
            userId,
            mergedEventId: mergedEvent.id,
            mergedEventIds: eventIds,
            auditLogId: savedAuditLog.id,
          },
          {
            removeOnComplete: true,
            removeOnFail: false,
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
          },
        );
        this.logger.log(
          `Queued AI summary job for merged event ${mergedEvent.id}`,
        );
      } catch (error) {
        this.logger.error('Failed to queue AI summary job', error);
        savedAuditLog.notes = `Merged ${largestGroup.length} overlapping events`;
        await this.auditLogRepository.save(savedAuditLog);
      }
    } else if (this.aiService) {
      try {
        const aiSummary = await this.aiService.summarizeMergedEvents(
          largestGroup,
        );
        savedAuditLog.notes = aiSummary;
        await this.auditLogRepository.save(savedAuditLog);
        this.logger.log(`AI summary generated synchronously: ${aiSummary}`);
      } catch (error) {
        this.logger.warn('AI service failed, using fallback', error);
        savedAuditLog.notes = `Merged ${largestGroup.length} overlapping events`;
        await this.auditLogRepository.save(savedAuditLog);
      }
    } else {
      savedAuditLog.notes = `Merged ${largestGroup.length} overlapping events`;
      await this.auditLogRepository.save(savedAuditLog);
    }

    (mergedEvent as any).auditLog = {
      id: savedAuditLog.id,
      aiSummary: savedAuditLog.notes,
      mergedEventIds: savedAuditLog.mergedEventIds,
      createdAt: savedAuditLog.createdAt,
    };

    return mergedEvent;
  }

  private isOverlapping(event1: Event, event2: Event, userId: string): boolean {
    const timeOverlaps =
      event1.startTime <= event2.endTime && event1.endTime >= event2.startTime;

    if (!timeOverlaps) {
      return false;
    }

    const event1Participants = new Set<string>();
    if (event1.creator) {
      event1Participants.add(event1.creator.id);
    }
    event1.invitees?.forEach((inv) => event1Participants.add(inv.id));

    const event2Participants = new Set<string>();
    if (event2.creator) {
      event2Participants.add(event2.creator.id);
    }
    event2.invitees?.forEach((inv) => event2Participants.add(inv.id));

    event1Participants.delete(userId);
    event2Participants.delete(userId);

    const hasCommonParticipant = Array.from(event1Participants).some((id) =>
      event2Participants.has(id),
    );

    if (!hasCommonParticipant) {
      return false;
    }

    if (!this.areTitlesCompatible(event1.title, event2.title)) {
      return false;
    }

    return true;
  }

  private areTitlesCompatible(title1: string, title2: string): boolean {
    const t1 = title1.toLowerCase().trim();
    const t2 = title2.toLowerCase().trim();

    const incompatiblePatterns = [
      {
        pattern: /\b(1:1|one[- ]on[- ]one|one[- ]to[- ]one|individual)\b/,
        incompatibleWith: [
          /\b(demo|demonstration|presentation|standup|sync|review|team|group)\b/,
        ],
      },
      {
        pattern: /\b(manager|executive|director|vp|ceo|cto|cfo)\s+(call|meeting|1:1|one[- ]on[- ]one)\b/,
        incompatibleWith: [
          /\b(demo|demonstration|presentation|client|customer)\b/,
        ],
      },
      {
        pattern: /\b(personal|private|confidential)\b/,
        incompatibleWith: [
          /\b(team|group|public|all[- ]hands|company)\b/,
        ],
      },
      {
        pattern: /\b(client|customer|external|vendor|partner)\b/,
        incompatibleWith: [
          /\b(internal|team|standup|sync|1:1|one[- ]on[- ]one)\b/,
        ],
      },
      {
        pattern: /\b(demo|demonstration|presentation)\b/,
        incompatibleWith: [
          /\b(1:1|one[- ]on[- ]one|manager|executive|personal|private)\b/,
        ],
      },
    ];

    for (const rule of incompatiblePatterns) {
      const matches1 = rule.pattern.test(t1);
      const matches2 = rule.pattern.test(t2);

      if (matches1 || matches2) {
        const otherTitle = matches1 ? t2 : t1;
        for (const incompatiblePattern of rule.incompatibleWith) {
          if (incompatiblePattern.test(otherTitle)) {
            this.logger.debug(
              `Titles incompatible: "${title1}" vs "${title2}"`,
            );
            return false;
          }
        }
      }
    }

    return true;
  }

  private groupOverlappingEvents(events: Event[], userId: string): Event[][] {
    const groups: Event[][] = [];
    const processed = new Set<string>();

    for (const event of events) {
      if (processed.has(event.id)) {
        continue;
      }

      const group: Event[] = [event];
      processed.add(event.id);

      let foundOverlap = true;
      while (foundOverlap) {
        foundOverlap = false;
        for (const otherEvent of events) {
          if (processed.has(otherEvent.id)) {
            continue;
          }

          const overlapsWithGroup = group.some((e) =>
            this.isOverlapping(e, otherEvent, userId),
          );

          if (overlapsWithGroup) {
            group.push(otherEvent);
            processed.add(otherEvent.id);
            foundOverlap = true;
          }
        }
      }

      if (group.length > 1) {
        groups.push(group);
      }
    }

    return groups;
  }

  private async mergeEvents(events: Event[], userId: string): Promise<Event> {
    const sortedEvents = [...events].sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime(),
    );

    const titles = sortedEvents.map((e) => e.title);
    const mergedTitle = titles.join(' | ');

    const mergedStartTime: Date = sortedEvents[0].startTime;
    const mergedEndTime: Date = sortedEvents.reduce((latest, event) =>
      event.endTime > latest ? event.endTime : latest,
      sortedEvents[0].endTime,
    );

    const statusPriority = {
      [EventStatus.COMPLETED]: 4,
      [EventStatus.IN_PROGRESS]: 3,
      [EventStatus.TODO]: 2,
      [EventStatus.CANCELED]: 1,
    };

    const mergedStatus = sortedEvents.reduce((highest, event) =>
      statusPriority[event.status] > statusPriority[highest.status]
        ? event
        :         highest,
    ).status;

    const descriptions = sortedEvents
      .map((e) => e.description)
      .filter((d) => d && d.trim() !== '');
    const mergedDescription =
      descriptions.length > 0 ? descriptions.join('\n\n') : null;

    const allInvitees = new Map<string, User>();
    sortedEvents.forEach((event) => {
      if (event.creator) {
        allInvitees.set(event.creator.id, event.creator);
      }
      event.invitees?.forEach((invitee) => {
        allInvitees.set(invitee.id, invitee);
      });
    });

    const creator = sortedEvents[0].creator;
    allInvitees.delete(creator.id);

    const mergedFrom = sortedEvents.map((e) => e.id);

    const eventData: Partial<Event> = {
      title: mergedTitle,
      description: mergedDescription,
      status: mergedStatus,
      startTime: mergedStartTime,
      endTime: mergedEndTime,
      creator,
      invitees: Array.from(allInvitees.values()),
      mergedFrom,
    };
    const mergedEvent = this.eventRepository.create(eventData);

    const savedEvent = await this.eventRepository.save(mergedEvent);

    await this.eventRepository.remove(sortedEvents);

    return savedEvent as Event;
  }
}
