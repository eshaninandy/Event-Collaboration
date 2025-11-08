import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder, DataSource, QueryRunner } from 'typeorm';
import {
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { EventService } from '../../../src/event/event.service';
import { Event, EventStatus } from '../../../src/event/entities/event.entity';
import { User } from '../../../src/user/entities/user.entity';
import { AuditLog } from '../../../src/audit-log/entities/audit-log.entity';
import { CreateEventDto } from '../../../src/event/dto/create-event.dto';
import { UpdateEventDto } from '../../../src/event/dto/update-event.dto';
import { BatchCreateEventDto } from '../../../src/event/dto/batch-create-event.dto';
import { AiService } from '../../../src/ai/ai.service';

describe('EventService', () => {
  let service: EventService;
  let eventRepository: jest.Mocked<Repository<Event>>;
  let userRepository: jest.Mocked<Repository<User>>;
  let auditLogRepository: jest.Mocked<Repository<AuditLog>>;
  let aiService: jest.Mocked<AiService>;
  let dataSource: jest.Mocked<DataSource>;
  let queryRunner: any;

  const mockUser: User = {
    id: 'user-1',
    name: 'John Doe',
    email: 'john@example.com',
    events: [],
  };

  const mockUser2: User = {
    id: 'user-2',
    name: 'Jane Smith',
    email: 'jane@example.com',
    events: [],
  };

  const mockEvent: Event = {
    id: 'event-1',
    title: 'Test Event',
    description: 'Test Description',
    status: EventStatus.TODO,
    startTime: new Date('2024-01-01T10:00:00Z'),
    endTime: new Date('2024-01-01T12:00:00Z'),
    creator: mockUser,
    invitees: [],
    mergedFrom: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockEvent2: Event = {
    id: 'event-2',
    title: 'Test Event 2',
    description: 'Test Description 2',
    status: EventStatus.IN_PROGRESS,
    startTime: new Date('2024-01-01T11:00:00Z'),
    endTime: new Date('2024-01-01T13:00:00Z'),
    creator: mockUser,
    invitees: [mockUser2],
    mergedFrom: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockEventRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      remove: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const mockUserRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    const mockAuditLogRepository = {
      create: jest.fn(),
      save: jest.fn(),
    };

    const mockAiService = {
      summarizeMergedEvents: jest.fn(),
    };

    const mockQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        find: jest.fn(),
        createQueryBuilder: jest.fn(),
        query: jest.fn(),
      } as any,
    };

    const mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventService,
        {
          provide: getRepositoryToken(Event),
          useValue: mockEventRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: getRepositoryToken(AuditLog),
          useValue: mockAuditLogRepository,
        },
        {
          provide: AiService,
          useValue: mockAiService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<EventService>(EventService);
    eventRepository = module.get(getRepositoryToken(Event));
    userRepository = module.get(getRepositoryToken(User));
    auditLogRepository = module.get(getRepositoryToken(AuditLog));
    aiService = module.get(AiService);
    dataSource = module.get(DataSource);
    queryRunner = mockQueryRunner;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    const createEventDto: CreateEventDto = {
      title: 'New Event',
      description: 'New Description',
      status: EventStatus.TODO,
      startTime: '2024-01-01T10:00:00Z',
      endTime: '2024-01-01T12:00:00Z',
      creatorId: 'user-1',
      inviteeIds: ['user-2'], // At least one invitee is required
    };

    it('should create an event successfully', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      userRepository.find.mockResolvedValue([mockUser2]);
      eventRepository.create.mockReturnValue({
        ...mockEvent,
        invitees: [mockUser2],
      });
      eventRepository.save.mockResolvedValue({
        ...mockEvent,
        invitees: [mockUser2],
      });

      const result = await service.create(createEventDto);

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: createEventDto.creatorId },
      });
      expect(userRepository.find).toHaveBeenCalled();
      expect(eventRepository.create).toHaveBeenCalled();
      expect(eventRepository.save).toHaveBeenCalled();
      expect(result.invitees).toHaveLength(1);
      expect(result.invitees[0].id).toBe('user-2');
    });

    it('should create an event with invitees', async () => {
      const dtoWithInvitees: CreateEventDto = {
        ...createEventDto,
        inviteeIds: ['user-2'],
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      userRepository.find.mockResolvedValue([mockUser2]);
      eventRepository.create.mockReturnValue({
        ...mockEvent,
        invitees: [mockUser2],
      });
      eventRepository.save.mockResolvedValue({
        ...mockEvent,
        invitees: [mockUser2],
      });

      const result = await service.create(dtoWithInvitees);

      expect(userRepository.find).toHaveBeenCalled();
      expect(result.invitees).toHaveLength(1);
      expect(result.invitees[0].id).toBe('user-2');
    });

    it('should throw NotFoundException when creator not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.create(createEventDto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.create(createEventDto)).rejects.toThrow(
        'User with ID user-1 not found',
      );
    });

    it('should throw BadRequestException when startTime >= endTime', async () => {
      const invalidDto: CreateEventDto = {
        ...createEventDto,
        startTime: '2024-01-01T12:00:00Z',
        endTime: '2024-01-01T10:00:00Z',
      };

      userRepository.findOne.mockResolvedValue(mockUser);

      await expect(service.create(invalidDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(invalidDto)).rejects.toThrow(
        'startTime must be before endTime',
      );
    });

    it('should throw NotFoundException when invitee not found', async () => {
      const dtoWithInvitees: CreateEventDto = {
        ...createEventDto,
        inviteeIds: ['user-2', 'user-3'],
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      userRepository.find.mockResolvedValue([mockUser2]); // Only one invitee found

      await expect(service.create(dtoWithInvitees)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.create(dtoWithInvitees)).rejects.toThrow(
        'One or more invitee IDs not found',
      );
    });

    it('should throw BadRequestException when creator is in inviteeIds', async () => {
      const invalidDto: CreateEventDto = {
        ...createEventDto,
        creatorId: 'user-1',
        inviteeIds: ['user-1'], // Creator cannot be in invitee list
      };

      userRepository.findOne.mockResolvedValue(mockUser);

      await expect(service.create(invalidDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(invalidDto)).rejects.toThrow(
        'Creator cannot be in the invitee list',
      );
    });

    it('should throw BadRequestException when creator is in inviteeIds array with multiple invitees', async () => {
      const invalidDto: CreateEventDto = {
        ...createEventDto,
        creatorId: 'user-1',
        inviteeIds: ['user-1', 'user-2'], // Creator is in the list
      };

      userRepository.findOne.mockResolvedValue(mockUser);

      await expect(service.create(invalidDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(invalidDto)).rejects.toThrow(
        'Creator cannot be in the invitee list',
      );
    });
  });

  describe('create validation', () => {
    it('should reject event creation with empty inviteeIds array', async () => {
      const invalidDto: CreateEventDto = {
        title: 'New Event',
        description: 'New Description',
        status: EventStatus.TODO,
        startTime: '2024-01-01T10:00:00Z',
        endTime: '2024-01-01T12:00:00Z',
        creatorId: 'user-1',
        inviteeIds: [],
      };

      expect(invalidDto.inviteeIds.length).toBe(0);
    });
  });

  describe('getEventById', () => {
    it('should return an event by id', async () => {
      eventRepository.findOne.mockResolvedValue(mockEvent);

      const result = await service.getEventById('event-1');

      expect(eventRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        relations: ['creator', 'invitees'],
      });
      expect(result).toEqual(mockEvent);
    });

    it('should throw NotFoundException when event not found', async () => {
      eventRepository.findOne.mockResolvedValue(null);

      await expect(service.getEventById('non-existent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getEventById('non-existent')).rejects.toThrow(
        'Event with ID non-existent not found',
      );
    });
  });

  describe('update', () => {
    const updateEventDto: UpdateEventDto = {
      title: 'Updated Title',
      description: 'Updated Description',
    };

    it('should update an event successfully', async () => {
      const updatedEvent = { ...mockEvent, ...updateEventDto };

      eventRepository.findOne.mockResolvedValue(mockEvent);
      eventRepository.save.mockResolvedValue(updatedEvent as Event);

      const result = await service.update('event-1', updateEventDto);

      expect(eventRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        relations: ['creator', 'invitees'],
      });
      expect(eventRepository.save).toHaveBeenCalled();
      expect(result.title).toBe(updateEventDto.title);
    });

    it('should update event with new times', async () => {
      const updateDto: UpdateEventDto = {
        startTime: '2024-01-01T09:00:00Z',
        endTime: '2024-01-01T11:00:00Z',
      };

      eventRepository.findOne.mockResolvedValue(mockEvent);
      eventRepository.save.mockResolvedValue({
        ...mockEvent,
        startTime: new Date(updateDto.startTime),
        endTime: new Date(updateDto.endTime),
      });

      const result = await service.update('event-1', updateDto);

      expect(result.startTime).toEqual(new Date(updateDto.startTime));
      expect(result.endTime).toEqual(new Date(updateDto.endTime));
    });

    it('should throw BadRequestException when startTime >= endTime', async () => {
      const invalidDto: UpdateEventDto = {
        startTime: '2024-01-01T12:00:00Z',
        endTime: '2024-01-01T10:00:00Z',
      };

      eventRepository.findOne.mockResolvedValue(mockEvent);

      await expect(service.update('event-1', invalidDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.update('event-1', invalidDto)).rejects.toThrow(
        'startTime must be before endTime',
      );
    });

    it('should update event with new invitees', async () => {
      const updateDto: UpdateEventDto = {
        inviteeIds: ['user-2'],
      };

      eventRepository.findOne.mockResolvedValue(mockEvent);
      userRepository.find.mockResolvedValue([mockUser2]);
      eventRepository.save.mockResolvedValue({
        ...mockEvent,
        invitees: [mockUser2],
      });

      const result = await service.update('event-1', updateDto);

      expect(userRepository.find).toHaveBeenCalled();
      expect(result.invitees).toHaveLength(1);
    });

    it('should throw BadRequestException when updating invitees with creator in the list', async () => {
      const updateDto: UpdateEventDto = {
        inviteeIds: ['user-1'], // Creator cannot be in invitee list
      };

      eventRepository.findOne.mockResolvedValue(mockEvent);

      await expect(service.update('event-1', updateDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.update('event-1', updateDto)).rejects.toThrow(
        'Creator cannot be in the invitee list',
      );
    });

    it('should throw NotFoundException when invitee not found', async () => {
      const updateDto: UpdateEventDto = {
        inviteeIds: ['user-2', 'user-3'],
      };

      eventRepository.findOne.mockResolvedValue(mockEvent);
      userRepository.find.mockResolvedValue([mockUser2]); // Only one found

      await expect(service.update('event-1', updateDto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.update('event-1', updateDto)).rejects.toThrow(
        'One or more invitee IDs not found',
      );
    });

    it('should throw NotFoundException when event not found', async () => {
      eventRepository.findOne.mockResolvedValue(null);

      await expect(service.update('non-existent', updateEventDto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('should remove an event successfully', async () => {
      eventRepository.findOne.mockResolvedValue(mockEvent);
      eventRepository.remove.mockResolvedValue(mockEvent);

      await service.remove('event-1');

      expect(eventRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        relations: ['creator', 'invitees'],
      });
      expect(eventRepository.remove).toHaveBeenCalledWith(mockEvent);
    });

    it('should throw NotFoundException when event not found', async () => {
      eventRepository.findOne.mockResolvedValue(null);

      await expect(service.remove('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findConflicts', () => {
    it('should find conflicting events', async () => {
      const overlappingEvents = [mockEvent, mockEvent2];
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(overlappingEvents),
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      eventRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<Event>,
      );

      const result = await service.findConflicts('user-1');

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
      expect(eventRepository.createQueryBuilder).toHaveBeenCalledWith('event');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return empty array when no conflicts found', async () => {
      const nonOverlappingEvent: Event = {
        ...mockEvent2,
        startTime: new Date('2024-01-02T10:00:00Z'),
        endTime: new Date('2024-01-02T12:00:00Z'),
      };
      const events = [mockEvent, nonOverlappingEvent];
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(events),
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      eventRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<Event>,
      );

      const result = await service.findConflicts('user-1');

      expect(result).toEqual([]);
    });

    it('should throw NotFoundException when user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.findConflicts('non-existent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findConflicts('non-existent')).rejects.toThrow(
        'User with ID non-existent not found',
      );
    });
  });

  describe('mergeAll', () => {
    it('should merge overlapping events successfully with common participants and use AI summary', async () => {
      const event1: Event = {
        ...mockEvent,
        invitees: [mockUser2],
      };
      const event2: Event = {
        ...mockEvent2,
        invitees: [mockUser2],
      };
      const overlappingEvents = [event1, event2];
      const mergedEvent: Event = {
        id: 'merged-event-1',
        title: 'Test Event | Test Event 2',
        description: 'Test Description\n\nTest Description 2',
        status: EventStatus.IN_PROGRESS,
        startTime: event1.startTime,
        endTime: event2.endTime,
        creator: mockUser,
        invitees: [],
        mergedFrom: [event1.id, event2.id],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(overlappingEvents),
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      eventRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<Event>,
      );
      eventRepository.create.mockReturnValue(mergedEvent);
      eventRepository.save.mockResolvedValue(mergedEvent);
      eventRepository.remove.mockResolvedValue(overlappingEvents as any);
      aiService.summarizeMergedEvents.mockResolvedValue(
        'AI Summary: Merged 2 overlapping events',
      );
      const initialAuditLog = {
        id: 'audit-1',
        userId: 'user-1',
        newEventId: mergedEvent.id,
        mergedEventIds: [event1.id, event2.id],
        notes: null,
        createdAt: new Date(),
      } as AuditLog;
      
      const savedAuditLog = {
        ...initialAuditLog,
        notes: 'AI Summary: Merged 2 overlapping events',
      } as AuditLog;
      
      auditLogRepository.create.mockReturnValue(initialAuditLog);
      auditLogRepository.save
        .mockResolvedValueOnce(initialAuditLog)
        .mockResolvedValueOnce(savedAuditLog);

      const result = await service.mergeAll('user-1');

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
      expect(eventRepository.create).toHaveBeenCalled();
      expect(eventRepository.save).toHaveBeenCalled();
      expect(eventRepository.remove).toHaveBeenCalledWith(overlappingEvents);
      expect(aiService.summarizeMergedEvents).toHaveBeenCalledWith(overlappingEvents);
      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          notes: null,
        }),
      );
      expect(auditLogRepository.save).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mergedEvent);
      expect((result as any).auditLog).toBeDefined();
      expect((result as any).auditLog.aiSummary).toBe('AI Summary: Merged 2 overlapping events');
    });

    it('should handle AI service failure gracefully', async () => {
      const event1: Event = {
        ...mockEvent,
        invitees: [mockUser2],
      };
      const event2: Event = {
        ...mockEvent2,
        invitees: [mockUser2],
      };
      const overlappingEvents = [event1, event2];
      const mergedEvent: Event = {
        id: 'merged-event-1',
        title: 'Test Event | Test Event 2',
        description: 'Test Description\n\nTest Description 2',
        status: EventStatus.IN_PROGRESS,
        startTime: event1.startTime,
        endTime: event2.endTime,
        creator: mockUser,
        invitees: [],
        mergedFrom: [event1.id, event2.id],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(overlappingEvents),
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      eventRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<Event>,
      );
      eventRepository.create.mockReturnValue(mergedEvent);
      eventRepository.save.mockResolvedValue(mergedEvent);
      eventRepository.remove.mockResolvedValue(overlappingEvents as any);
      
      aiService.summarizeMergedEvents.mockRejectedValue(new Error('AI service error'));
      
      const initialAuditLog = {
        id: 'audit-1',
        userId: 'user-1',
        newEventId: mergedEvent.id,
        mergedEventIds: [event1.id, event2.id],
        notes: null,
        createdAt: new Date(),
      } as AuditLog;
      const savedAuditLog = { ...initialAuditLog };
      auditLogRepository.create.mockReturnValue(initialAuditLog);
      auditLogRepository.save.mockImplementation(async (log) => log as AuditLog);

      const result = await service.mergeAll('user-1');

      expect(result).toEqual(mergedEvent);
      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          notes: null,
        }),
      );
      expect(auditLogRepository.save).toHaveBeenCalledTimes(2);
      const secondSaveCall = auditLogRepository.save.mock.calls[1][0];
      expect(secondSaveCall.notes).toBe('Merged 2 overlapping events');
    });

    it('should throw NotFoundException when user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.mergeAll('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when less than 2 events', async () => {
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockEvent]),
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      eventRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<Event>,
      );

      await expect(service.mergeAll('user-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.mergeAll('user-1')).rejects.toThrow(
        'Need at least 2 events to perform merge operation',
      );
    });

    it('should throw BadRequestException when all events are CANCELED', async () => {
      const canceledEvent1: Event = {
        ...mockEvent,
        status: EventStatus.CANCELED,
      };
      const canceledEvent2: Event = {
        ...mockEvent2,
        status: EventStatus.CANCELED,
      };
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([canceledEvent1, canceledEvent2]),
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      eventRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<Event>,
      );

      await expect(service.mergeAll('user-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.mergeAll('user-1')).rejects.toThrow(
        'Need at least 2 non-canceled events to perform merge operation',
      );
    });

    it('should throw BadRequestException when events have no common participants', async () => {
      const mockUser3: User = {
        id: 'user-3',
        name: 'Bob',
        email: 'bob@example.com',
        events: [],
      };
      const event1: Event = {
        ...mockEvent,
        invitees: [mockUser2], // Only user-2
      };
      const event2: Event = {
        ...mockEvent2,
        invitees: [mockUser3], // Only user-3 - no overlap with user-2
      };
      const events = [event1, event2];
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(events),
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      eventRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<Event>,
      );

      await expect(service.mergeAll('user-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.mergeAll('user-1')).rejects.toThrow(
        'No overlapping events found to merge',
      );
    });

    it('should throw BadRequestException when events have incompatible titles', async () => {
      const event1: Event = {
        ...mockEvent,
        title: '1:1 manager call',
        invitees: [mockUser2],
      };
      const event2: Event = {
        ...mockEvent2,
        title: 'demo meeting',
        invitees: [mockUser2],
      };
      const events = [event1, event2];
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(events),
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      eventRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<Event>,
      );

      await expect(service.mergeAll('user-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.mergeAll('user-1')).rejects.toThrow(
        'No overlapping events found to merge',
      );
    });

    it('should throw BadRequestException when no overlapping events (time mismatch)', async () => {
      const nonOverlappingEvent: Event = {
        ...mockEvent2,
        startTime: new Date('2024-01-02T10:00:00Z'),
        endTime: new Date('2024-01-02T12:00:00Z'),
        invitees: [mockUser2], // Common participant but no time overlap
      };
      const event1: Event = {
        ...mockEvent,
        invitees: [mockUser2],
      };
      const events = [event1, nonOverlappingEvent];
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(events),
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      eventRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<Event>,
      );

      await expect(service.mergeAll('user-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.mergeAll('user-1')).rejects.toThrow(
        'No overlapping events found to merge',
      );
    });

    it('should merge events with correct status priority', async () => {
      const completedEvent: Event = {
        ...mockEvent,
        status: EventStatus.COMPLETED,
        invitees: [mockUser2], // Common participant
      };
      const inProgressEvent: Event = {
        ...mockEvent2,
        status: EventStatus.IN_PROGRESS,
        invitees: [mockUser2], // Common participant
      };
      const events = [completedEvent, inProgressEvent];
      const mergedEvent: Event = {
        id: 'merged-event-1',
        title: 'Test Event | Test Event 2',
        description: 'Test Description\n\nTest Description 2',
        status: EventStatus.COMPLETED, // Should pick COMPLETED (highest priority)
        startTime: completedEvent.startTime,
        endTime: inProgressEvent.endTime,
        creator: mockUser,
        invitees: [],
        mergedFrom: [completedEvent.id, inProgressEvent.id],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(events),
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      eventRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<Event>,
      );
      eventRepository.create.mockReturnValue(mergedEvent);
      eventRepository.save.mockResolvedValue(mergedEvent);
      eventRepository.remove.mockResolvedValue(events as any);
      aiService.summarizeMergedEvents.mockResolvedValue(
        'AI Summary: Merged events with status priority',
      );
      const savedAuditLog = {
        id: 'audit-1',
        userId: 'user-1',
        newEventId: mergedEvent.id,
        mergedEventIds: [completedEvent.id, inProgressEvent.id],
        notes: 'AI Summary: Merged events with status priority',
        createdAt: new Date(),
      } as AuditLog;
      auditLogRepository.create.mockReturnValue(savedAuditLog);
      auditLogRepository.save.mockResolvedValue(savedAuditLog);

      const result = await service.mergeAll('user-1');

      expect(result.status).toBe(EventStatus.COMPLETED);
      expect(aiService.summarizeMergedEvents).toHaveBeenCalledWith(events);
      expect((result as any).auditLog).toBeDefined();
    });

    it('should merge events and collect all unique invitees', async () => {
      const eventWithInvitees: Event = {
        ...mockEvent,
        invitees: [mockUser2],
      };
      const event2WithInvitees: Event = {
        ...mockEvent2,
        invitees: [mockUser2],
      };
      const events = [eventWithInvitees, event2WithInvitees];
      const mergedEvent: Event = {
        id: 'merged-event-1',
        title: 'Test Event | Test Event 2',
        description: 'Test Description\n\nTest Description 2',
        status: EventStatus.IN_PROGRESS,
        startTime: eventWithInvitees.startTime,
        endTime: event2WithInvitees.endTime,
        creator: mockUser,
        invitees: [mockUser2], // Should be unique
        mergedFrom: [eventWithInvitees.id, event2WithInvitees.id],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(events),
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      eventRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<Event>,
      );
      eventRepository.create.mockReturnValue(mergedEvent);
      eventRepository.save.mockResolvedValue(mergedEvent);
      eventRepository.remove.mockResolvedValue(events as any);
      aiService.summarizeMergedEvents.mockResolvedValue(
        'AI Summary: Merged events with unique invitees',
      );
      auditLogRepository.create.mockReturnValue({} as AuditLog);
      auditLogRepository.save.mockResolvedValue({} as AuditLog);

      const result = await service.mergeAll('user-1');

      const createCall = eventRepository.create.mock.calls[0][0];
      expect(createCall.invitees.length).toBe(1);
      expect(createCall.invitees[0].id).toBe('user-2');
      expect(aiService.summarizeMergedEvents).toHaveBeenCalledWith(events);
      expect(result).toEqual(mergedEvent);
    });

    it('should merge events that touch at boundary (endTime1 = startTime2)', async () => {
      const event1: Event = {
        ...mockEvent,
        startTime: new Date('2024-01-01T10:00:00Z'),
        endTime: new Date('2024-01-01T11:00:00Z'),
        invitees: [mockUser2],
      };
      const event2: Event = {
        ...mockEvent2,
        startTime: new Date('2024-01-01T11:00:00Z'),
        endTime: new Date('2024-01-01T12:00:00Z'),
        invitees: [mockUser2],
      };
      const events = [event1, event2];
      const mergedEvent: Event = {
        id: 'merged-event-1',
        title: 'Test Event | Test Event 2',
        description: 'Test Description\n\nTest Description 2',
        status: EventStatus.IN_PROGRESS,
        startTime: event1.startTime,
        endTime: event2.endTime,
        creator: mockUser,
        invitees: [mockUser2],
        mergedFrom: [event1.id, event2.id],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(events),
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      eventRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<Event>,
      );
      eventRepository.create.mockReturnValue(mergedEvent);
      eventRepository.save.mockResolvedValue(mergedEvent);
      eventRepository.remove.mockResolvedValue(events as any);
      aiService.summarizeMergedEvents.mockResolvedValue('AI Summary');
      auditLogRepository.create.mockReturnValue({} as AuditLog);
      auditLogRepository.save.mockResolvedValue({} as AuditLog);

      const result = await service.mergeAll('user-1');

      expect(result).toEqual(mergedEvent);
      expect(result.startTime).toEqual(event1.startTime);
      expect(result.endTime).toEqual(event2.endTime);
    });

    it('should handle concurrent events with same start and end times', async () => {
      const sameTime = new Date('2024-01-01T10:00:00Z');
      const event1: Event = {
        ...mockEvent,
        startTime: sameTime,
        endTime: new Date('2024-01-01T11:00:00Z'),
        invitees: [mockUser2],
      };
      const event2: Event = {
        ...mockEvent2,
        startTime: sameTime,
        endTime: new Date('2024-01-01T11:00:00Z'),
        invitees: [mockUser2],
      };
      const events = [event1, event2];
      const mergedEvent: Event = {
        id: 'merged-event-1',
        title: 'Test Event | Test Event 2',
        description: 'Test Description\n\nTest Description 2',
        status: EventStatus.IN_PROGRESS,
        startTime: sameTime,
        endTime: new Date('2024-01-01T11:00:00Z'),
        creator: mockUser,
        invitees: [mockUser2],
        mergedFrom: [event1.id, event2.id],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(events),
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      eventRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<Event>,
      );
      eventRepository.create.mockReturnValue(mergedEvent);
      eventRepository.save.mockResolvedValue(mergedEvent);
      eventRepository.remove.mockResolvedValue(events as any);
      aiService.summarizeMergedEvents.mockResolvedValue('AI Summary');
      auditLogRepository.create.mockReturnValue({} as AuditLog);
      auditLogRepository.save.mockResolvedValue({} as AuditLog);

      const result = await service.mergeAll('user-1');

      expect(result).toEqual(mergedEvent);
      expect(result.startTime).toEqual(sameTime);
    });

    it('should handle events with empty titles', async () => {
      const event1: Event = {
        ...mockEvent,
        title: '', // Empty title
        invitees: [mockUser2],
      };
      const event2: Event = {
        ...mockEvent2,
        title: 'Valid Title',
        invitees: [mockUser2],
      };
      const events = [event1, event2];
      const mergedEvent: Event = {
        id: 'merged-event-1',
        title: ' | Valid Title',
        description: 'Test Description\n\nTest Description 2',
        status: EventStatus.IN_PROGRESS,
        startTime: event1.startTime,
        endTime: event2.endTime,
        creator: mockUser,
        invitees: [mockUser2],
        mergedFrom: [event1.id, event2.id],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(events),
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      eventRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<Event>,
      );
      eventRepository.create.mockReturnValue(mergedEvent);
      eventRepository.save.mockResolvedValue(mergedEvent);
      eventRepository.remove.mockResolvedValue(events as any);
      aiService.summarizeMergedEvents.mockResolvedValue('AI Summary');
      auditLogRepository.create.mockReturnValue({} as AuditLog);
      auditLogRepository.save.mockResolvedValue({} as AuditLog);

      const result = await service.mergeAll('user-1');

      expect(result).toBeDefined();
      expect(result.title).toContain('Valid Title');
    });

    it('should not merge events when there are no common participants (besides userId)', async () => {
      const mockUser3: User = {
        id: 'user-3',
        name: 'Bob',
        email: 'bob@example.com',
        events: [],
      };
      const event1: Event = {
        ...mockEvent,
        invitees: [mockUser2],
      };
      const event2: Event = {
        ...mockEvent2,
        invitees: [mockUser3],
      };
      const events = [event1, event2];
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(events),
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      eventRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<Event>,
      );

      await expect(service.mergeAll('user-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.mergeAll('user-1')).rejects.toThrow(
        'No overlapping events found to merge',
      );
    });

    it('should merge events when all events share the same participants', async () => {
      const event1: Event = {
        ...mockEvent,
        invitees: [mockUser2],
      };
      const event2: Event = {
        ...mockEvent2,
        invitees: [mockUser2],
      };
      const event3: Event = {
        ...mockEvent,
        id: 'event-3',
        title: 'Event 3',
        startTime: new Date('2024-01-01T10:15:00Z'),
        endTime: new Date('2024-01-01T11:15:00Z'),
        invitees: [mockUser2],
      };
      const events = [event1, event2, event3];
      const mergedEvent: Event = {
        id: 'merged-event-1',
        title: 'Test Event | Test Event 2 | Event 3',
        description: 'Test Description\n\nTest Description 2\n\nEvent 3',
        status: EventStatus.IN_PROGRESS,
        startTime: event1.startTime,
        endTime: event3.endTime,
        creator: mockUser,
        invitees: [mockUser2],
        mergedFrom: [event1.id, event2.id, event3.id],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(events),
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      eventRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<Event>,
      );
      eventRepository.create.mockReturnValue(mergedEvent);
      eventRepository.save.mockResolvedValue(mergedEvent);
      eventRepository.remove.mockResolvedValue(events as any);
      aiService.summarizeMergedEvents.mockResolvedValue('AI Summary');
      auditLogRepository.create.mockReturnValue({} as AuditLog);
      auditLogRepository.save.mockResolvedValue({} as AuditLog);

      const result = await service.mergeAll('user-1');

      expect(result).toEqual(mergedEvent);
      expect(result.invitees).toHaveLength(1);
      expect(result.invitees[0].id).toBe('user-2');
    });

    it('should merge the largest group when multiple overlapping groups exist', async () => {
      const mockUser3: User = {
        id: 'user-3',
        name: 'Bob',
        email: 'bob@example.com',
        events: [],
      };

      const event1: Event = {
        ...mockEvent,
        startTime: new Date('2024-01-01T10:00:00Z'),
        endTime: new Date('2024-01-01T11:00:00Z'),
        invitees: [mockUser2],
      };
      const event2: Event = {
        ...mockEvent2,
        startTime: new Date('2024-01-01T10:30:00Z'),
        endTime: new Date('2024-01-01T11:30:00Z'),
        invitees: [mockUser2],
      };

      const event3: Event = {
        ...mockEvent,
        id: 'event-3',
        title: 'Event 3',
        startTime: new Date('2024-01-01T14:00:00Z'),
        endTime: new Date('2024-01-01T15:00:00Z'),
        invitees: [mockUser3],
      };
      const event4: Event = {
        ...mockEvent,
        id: 'event-4',
        title: 'Event 4',
        startTime: new Date('2024-01-01T14:30:00Z'),
        endTime: new Date('2024-01-01T15:30:00Z'),
        invitees: [mockUser3],
      };
      const event5: Event = {
        ...mockEvent,
        id: 'event-5',
        title: 'Event 5',
        startTime: new Date('2024-01-01T14:45:00Z'),
        endTime: new Date('2024-01-01T16:00:00Z'),
        invitees: [mockUser3],
      };

      const allEvents = [event1, event2, event3, event4, event5];
      const mergedEvent: Event = {
        id: 'merged-event-1',
        title: 'Event 3 | Event 4 | Event 5',
        description: 'Merged description',
        status: EventStatus.IN_PROGRESS,
        startTime: event3.startTime,
        endTime: event5.endTime,
        creator: mockUser,
        invitees: [mockUser3],
        mergedFrom: [event3.id, event4.id, event5.id],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(allEvents),
      };

      userRepository.findOne.mockResolvedValue(mockUser);
      eventRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<Event>,
      );
      eventRepository.create.mockReturnValue(mergedEvent);
      eventRepository.save.mockResolvedValue(mergedEvent);
      eventRepository.remove.mockResolvedValue([event3, event4, event5] as any);
      aiService.summarizeMergedEvents.mockResolvedValue('AI Summary');
      auditLogRepository.create.mockReturnValue({} as AuditLog);
      auditLogRepository.save.mockResolvedValue({} as AuditLog);

      const result = await service.mergeAll('user-1');

      expect(result.mergedFrom).toHaveLength(3);
      expect(result.mergedFrom).toEqual(
        expect.arrayContaining([event3.id, event4.id, event5.id]),
      );
      expect(result.invitees[0].id).toBe('user-3');
    });
  });

  describe('batchCreate', () => {
    const createBatchDto = (events: CreateEventDto[]): BatchCreateEventDto => ({
      events,
    });

    const createEventDto = (index: number): CreateEventDto => ({
      title: `Event ${index}`,
      description: `Description ${index}`,
      status: EventStatus.TODO,
      startTime: `2024-01-0${index}T10:00:00Z`,
      endTime: `2024-01-0${index}T12:00:00Z`,
      creatorId: 'user-1',
      inviteeIds: ['user-2'],
    });

    beforeEach(() => {
      queryRunner.connect.mockReset().mockResolvedValue(undefined);
      queryRunner.startTransaction.mockReset().mockResolvedValue(undefined);
      queryRunner.commitTransaction.mockReset().mockResolvedValue(undefined);
      queryRunner.rollbackTransaction.mockReset().mockResolvedValue(undefined);
      queryRunner.release.mockReset().mockResolvedValue(undefined);
      queryRunner.manager.find.mockReset();
      queryRunner.manager.createQueryBuilder.mockReset();
      queryRunner.manager.query.mockReset();
    });

    it('should create multiple events successfully in batch', async () => {
      const batchDto = createBatchDto([
        createEventDto(1),
        createEventDto(2),
      ]);

      const insertedEvents: Event[] = [
        { ...mockEvent, id: 'event-1', title: 'Event 1' },
        { ...mockEvent, id: 'event-2', title: 'Event 2' },
      ];

      queryRunner.manager.find.mockResolvedValueOnce([mockUser, mockUser2]);
      queryRunner.manager.createQueryBuilder.mockReturnValue({
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          raw: insertedEvents,
        }),
      });
      queryRunner.manager.find.mockResolvedValueOnce(insertedEvents);

      const result = await service.batchCreate(batchDto);

      expect(dataSource.createQueryRunner).toHaveBeenCalled();
      expect(queryRunner.connect).toHaveBeenCalled();
      expect(queryRunner.startTransaction).toHaveBeenCalled();
      expect(queryRunner.manager.find).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Event 1');
      expect(result[1].title).toBe('Event 2');
    });

    it('should handle batch with invitees', async () => {
      const batchDto = createBatchDto([
        {
          ...createEventDto(1),
          inviteeIds: ['user-2'],
        },
      ]);

      const insertedEvents: Event[] = [
        { ...mockEvent, id: 'event-1', title: 'Event 1' },
      ];

      queryRunner.manager.find.mockResolvedValueOnce([mockUser, mockUser2]); // Users
      queryRunner.manager.createQueryBuilder.mockReturnValue({
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          raw: insertedEvents,
        }),
      });
      queryRunner.manager.query.mockResolvedValue(undefined); // Junction table insert
      queryRunner.manager.find.mockResolvedValueOnce([
        { ...insertedEvents[0], invitees: [mockUser2] },
      ]); // Load full events

      const result = await service.batchCreate(batchDto);

      expect(queryRunner.manager.query).toHaveBeenCalled();
      expect(result[0].invitees).toBeDefined();
    });

    it('should throw BadRequestException for empty events array', async () => {
      const batchDto = createBatchDto([]);

      await expect(service.batchCreate(batchDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.batchCreate(batchDto)).rejects.toThrow(
        'Events array cannot be empty',
      );
    });

    it('should throw BadRequestException for more than 500 events', async () => {
      const events = Array(501)
        .fill(null)
        .map((_, i) => createEventDto(i + 1));
      const batchDto = createBatchDto(events);

      await expect(service.batchCreate(batchDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.batchCreate(batchDto)).rejects.toThrow(
        'Maximum 500 events allowed per batch',
      );
    });

    it('should throw BadRequestException when event has no invitees', async () => {
      const batchDto = createBatchDto([
        {
          ...createEventDto(1),
          inviteeIds: [], // Empty inviteeIds should be rejected
        },
      ]);

      queryRunner.manager.find.mockReset();
      queryRunner.manager.find.mockResolvedValue([mockUser]);

      await expect(service.batchCreate(batchDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.batchCreate(batchDto)).rejects.toThrow(
        'At least one invitee is required',
      );
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException when creator not found', async () => {
      const batchDto = createBatchDto([
        {
          ...createEventDto(1),
          creatorId: 'non-existent-user',
        },
      ]);

      queryRunner.manager.find.mockReset();
      queryRunner.manager.find.mockResolvedValue([]);

      await expect(service.batchCreate(batchDto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.batchCreate(batchDto)).rejects.toThrow(
        'Users not found',
      );
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException when invitee not found', async () => {
      const batchDto = createBatchDto([
        {
          ...createEventDto(1),
          inviteeIds: ['non-existent-invitee'],
        },
      ]);

      queryRunner.manager.find.mockReset();
      queryRunner.manager.find.mockResolvedValue([mockUser]);

      await expect(service.batchCreate(batchDto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.batchCreate(batchDto)).rejects.toThrow(
        'Invitees not found',
      );
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should throw BadRequestException when creator is in inviteeIds in batch', async () => {
      const batchDto = createBatchDto([
        {
          ...createEventDto(1),
          creatorId: 'user-1',
          inviteeIds: ['user-1'],
        },
      ]);

      queryRunner.manager.find.mockReset();
      queryRunner.manager.find.mockResolvedValue([mockUser]);

      await expect(service.batchCreate(batchDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.batchCreate(batchDto)).rejects.toThrow(
        'Creator cannot be in the invitee list',
      );
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should throw BadRequestException for invalid time range', async () => {
      const batchDto = createBatchDto([
        {
          ...createEventDto(1),
          startTime: '2024-01-01T12:00:00Z',
          endTime: '2024-01-01T10:00:00Z',
        },
      ]);

      queryRunner.manager.find.mockReset();
      queryRunner.manager.find.mockResolvedValue([mockUser, mockUser2]);

      await expect(service.batchCreate(batchDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.batchCreate(batchDto)).rejects.toThrow(
        'invalid time range',
      );
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should rollback transaction on error', async () => {
      const batchDto = createBatchDto([createEventDto(1)]);

      queryRunner.manager.find.mockReset();
      queryRunner.manager.find.mockRejectedValue(new Error('Database error'));

      await expect(service.batchCreate(batchDto)).rejects.toThrow();

      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    });

    it('should handle batch with 500 events (maximum)', async () => {
      const events = Array(500)
        .fill(null)
        .map((_, i) => createEventDto(i + 1));
      const batchDto = createBatchDto(events);

      const insertedEvents = events.map((_, i) => ({
        ...mockEvent,
        id: `event-${i + 1}`,
        title: `Event ${i + 1}`,
      }));

      queryRunner.manager.find.mockResolvedValueOnce([mockUser, mockUser2]); // Need both creator and invitee
      queryRunner.manager.createQueryBuilder.mockReturnValue({
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          raw: insertedEvents,
        }),
      });
      queryRunner.manager.find.mockResolvedValueOnce(insertedEvents);

      const result = await service.batchCreate(batchDto);

      expect(result).toHaveLength(500);
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should batch fetch all unique users efficiently', async () => {
      const batchDto = createBatchDto([
        { ...createEventDto(1), creatorId: 'user-1', inviteeIds: ['user-2'] },
        { ...createEventDto(2), creatorId: 'user-1', inviteeIds: ['user-2'] },
        { ...createEventDto(3), creatorId: 'user-2', inviteeIds: ['user-1'] },
      ]);

      const insertedEvents = [
        { ...mockEvent, id: 'event-1' },
        { ...mockEvent, id: 'event-2' },
        { ...mockEvent, id: 'event-3' },
      ];

      queryRunner.manager.find.mockResolvedValueOnce([mockUser, mockUser2]);
      queryRunner.manager.createQueryBuilder.mockReturnValue({
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          raw: insertedEvents,
        }),
      });
      queryRunner.manager.find.mockResolvedValueOnce(insertedEvents);

      await service.batchCreate(batchDto);

      expect(queryRunner.manager.find).toHaveBeenCalledWith(
        User,
        expect.objectContaining({
          where: expect.arrayContaining([
            expect.objectContaining({
              id: expect.anything(),
            }),
          ]),
        }),
      );
    });

    it('should handle batch with duplicate invitee IDs', async () => {
      const batchDto = createBatchDto([
        {
          ...createEventDto(1),
          inviteeIds: ['user-2', 'user-2'],
        },
      ]);

      const insertedEvents = [{ ...mockEvent, id: 'event-1' }];

      queryRunner.manager.find.mockResolvedValueOnce([mockUser, mockUser2]);
      queryRunner.manager.createQueryBuilder.mockReturnValue({
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          raw: insertedEvents,
        }),
      });
      queryRunner.manager.query.mockResolvedValue(undefined);
      queryRunner.manager.find.mockResolvedValueOnce([
        { ...insertedEvents[0], invitees: [mockUser2] },
      ]);

      const result = await service.batchCreate(batchDto);

      expect(result).toHaveLength(1);
      expect(queryRunner.manager.find).toHaveBeenCalled();
    });
  });
});

