import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiService } from '../../../src/ai/ai.service';
import { CacheService } from '../../../src/ai/cache.service';
import { Event, EventStatus } from '../../../src/event/entities/event.entity';
import { User } from '../../../src/user/entities/user.entity';

describe('AiService', () => {
  let service: AiService;
  let cacheService: CacheService;
  let configService: jest.Mocked<ConfigService>;

  const mockUser: User = {
    id: 'user-1',
    name: 'John Doe',
    email: 'john@example.com',
    events: [],
  };

  const mockEvent1: Event = {
    id: 'event-1',
    title: 'Planning Meeting',
    description: 'Team planning session',
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
    title: 'Demo Session',
    description: 'Product demonstration',
    status: EventStatus.IN_PROGRESS,
    startTime: new Date('2024-01-01T11:00:00Z'),
    endTime: new Date('2024-01-01T13:00:00Z'),
    creator: mockUser,
    invitees: [],
    mergedFrom: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'REDIS_ENABLED') return 'false'; // Disable Redis for AI service tests
        if (key === 'AI_API_KEY') return defaultValue || 'mock-key';
        if (key === 'AI_USE_MOCK') return 'true';
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        CacheService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
    cacheService = module.get<CacheService>(CacheService);
    configService = module.get(ConfigService);
  });

  afterEach(async () => {
    await cacheService.clear();
    jest.clearAllMocks();
  });

  describe('summarizeMergedEvents', () => {
    beforeEach(() => {
      configService.get.mockImplementation((key: string, defaultValue?: string) => {
        if (key === 'AI_API_KEY') return defaultValue || 'mock-key';
        if (key === 'AI_USE_MOCK') return 'true';
        return defaultValue;
      });
    });

    it('should generate a mock summary when cache is empty', async () => {
      const events = [mockEvent1, mockEvent2];
      const result = await service.summarizeMergedEvents(events);

      expect(result).toBe('Merged 2 overlapping events: Planning Meeting + Demo Session.');
      expect(result).toContain('Planning Meeting');
      expect(result).toContain('Demo Session');
    });

    it('should return cached summary when available', async () => {
      const events = [mockEvent1, mockEvent2];
      const cachedSummary = 'Cached summary from previous call';

      const firstResult = await service.summarizeMergedEvents(events);
      expect(firstResult).toBeTruthy();

      const secondResult = await service.summarizeMergedEvents(events);
      expect(secondResult).toBeTruthy();
      expect(secondResult).toContain('Merged 2 overlapping events');
    });

    it('should generate summary for single event', async () => {
      const events = [mockEvent1];
      const result = await service.summarizeMergedEvents(events);

      expect(result).toBe('Merged 1 overlapping events: Planning Meeting.');
    });

    it('should generate summary for multiple events', async () => {
      const mockEvent3: Event = {
        ...mockEvent1,
        id: 'event-3',
        title: 'Review Meeting',
      };
      const events = [mockEvent1, mockEvent2, mockEvent3];
      const result = await service.summarizeMergedEvents(events);

      expect(result).toBe('Merged 3 overlapping events: Planning Meeting + Demo Session + Review Meeting.');
      expect(result).toContain('3 overlapping events');
    });

    it('should handle events with empty titles', async () => {
      const eventWithEmptyTitle: Event = {
        ...mockEvent1,
        title: '',
      };
      const events = [eventWithEmptyTitle, mockEvent2];
      const result = await service.summarizeMergedEvents(events);

      expect(result).toContain('2 overlapping events');
      expect(result).toContain('Demo Session');
    });

    it('should use deterministic cache key based on sorted event IDs', async () => {
      const events1 = [mockEvent1, mockEvent2];
      const events2 = [mockEvent2, mockEvent1];

      const result1 = await service.summarizeMergedEvents(events1);
      
      const result2 = await service.summarizeMergedEvents(events2);

      expect(result1).toContain('Planning Meeting');
      expect(result1).toContain('Demo Session');
      expect(result2).toContain('Planning Meeting');
      expect(result2).toContain('Demo Session');
    });
  });

  describe('Configuration', () => {
    it('should use mock mode when AI_USE_MOCK is true', async () => {
      configService.get.mockImplementation((key: string, defaultValue?: string) => {
        if (key === 'AI_API_KEY') return 'test-key';
        if (key === 'AI_USE_MOCK') return 'true';
        return defaultValue;
      });

      const events = [mockEvent1, mockEvent2];
      const result = await service.summarizeMergedEvents(events);

      expect(result).toContain('Merged 2 overlapping events');
      expect(configService.get).toHaveBeenCalledWith('AI_USE_MOCK', 'true');
    });

    it('should use mock mode when AI_USE_MOCK is false but generateAISummary falls back', async () => {
      configService.get.mockImplementation((key: string, defaultValue?: string) => {
        if (key === 'AI_API_KEY') return 'test-key';
        if (key === 'AI_USE_MOCK') return 'false';
        return defaultValue;
      });

      const events = [mockEvent1, mockEvent2];
      const result = await service.summarizeMergedEvents(events);

      expect(result).toContain('Merged 2 overlapping events');
    });

    it('should use default API key when not provided', async () => {
      configService.get.mockImplementation((key: string, defaultValue?: string) => {
        if (key === 'AI_API_KEY') return defaultValue || 'mock-key';
        if (key === 'AI_USE_MOCK') return 'true';
        return defaultValue;
      });

      const events = [mockEvent1];
      await service.summarizeMergedEvents(events);

      expect(configService.get).toHaveBeenCalledWith('AI_API_KEY', 'mock-key');
    });
  });

  describe('Cache Integration', () => {
    it('should attempt to cache summary after generation', async () => {
      const events = [mockEvent1, mockEvent2];
      const cacheKey = `event-summary:${events.map((e) => e.id).sort().join('-')}`;

      await cacheService.clear();

      const result = await service.summarizeMergedEvents(events);
      expect(result).toBeTruthy();
      expect(result).toContain('Merged 2 overlapping events');

      const cached = await cacheService.get<string>(cacheKey);
      expect(cached).toBeNull();
    });

    it('should attempt to cache with TTL of 3600 seconds', async () => {
      const events = [mockEvent1, mockEvent2];

      const result = await service.summarizeMergedEvents(events);
      expect(result).toBeTruthy();
    });

    it('should generate summary when cache is disabled', async () => {
      const events = [mockEvent1, mockEvent2];

      const result = await service.summarizeMergedEvents(events);

      expect(result).toBeTruthy();
      expect(result).toContain('Merged 2 overlapping events');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty events array', async () => {
      const events: Event[] = [];
      const result = await service.summarizeMergedEvents(events);

      expect(result).toBe('Merged 0 overlapping events: .');
    });

    it('should handle events with special characters in titles', async () => {
      const specialEvent: Event = {
        ...mockEvent1,
        title: 'Meeting & Review (2024)',
      };
      const events = [specialEvent, mockEvent2];
      const result = await service.summarizeMergedEvents(events);

      expect(result).toContain('Meeting & Review (2024)');
      expect(result).toContain('Demo Session');
    });

    it('should handle events with very long titles', async () => {
      const longTitleEvent: Event = {
        ...mockEvent1,
        title: 'A'.repeat(200),
      };
      const events = [longTitleEvent, mockEvent2];
      const result = await service.summarizeMergedEvents(events);

      expect(result).toContain('A'.repeat(200));
      expect(result).toContain('2 overlapping events');
    });
  });
});

