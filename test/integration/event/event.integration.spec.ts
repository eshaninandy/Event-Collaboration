import { DataSource, Repository } from 'typeorm';
import { createPgMemDataSource } from '../utils/pgmem-datasource';
import { EventService } from '../../../src/event/event.service';
import { Event, EventStatus } from '../../../src/event/entities/event.entity';
import { User } from '../../../src/user/entities/user.entity';
import { AuditLog } from '../../../src/audit-log/entities/audit-log.entity';
import { AiService } from '../../../src/ai/ai.service';
import { BatchCreateEventDto } from '../../../src/event/dto/batch-create-event.dto';
import { CreateEventDto } from '../../../src/event/dto/create-event.dto';
import fc from 'fast-check';
import { v4 as uuidv4 } from 'uuid';

const USER_1_ID = '00000000-0000-0000-0000-000000000001';
const USER_2_ID = '00000000-0000-0000-0000-000000000002';

describe('User Integration (pg-mem)', () => {
  let dataSource: DataSource;
  let userRepo: Repository<User>;
  let eventRepo: Repository<Event>;
  let auditRepo: Repository<AuditLog>;
  beforeAll(async () => {
    dataSource = await createPgMemDataSource();
    userRepo = dataSource.getRepository(User);
    eventRepo = dataSource.getRepository(Event);
    auditRepo = dataSource.getRepository(AuditLog);
  });
  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    try {
      await dataSource.query('DELETE FROM audit_logs');
    } catch (e) {
    }
    try {
      await dataSource.query('DELETE FROM event_invitees');
    } catch (e) {
    }
    try {
      await dataSource.query('DELETE FROM events');
    } catch (e) {
    }
    try {
      await dataSource.query('DELETE FROM users');
    } catch (e) {
    }
  });
  it('should create a user and retrieve it by ID', async () => {
    const testUserId = uuidv4();
    const user = await userRepo.save({ id: testUserId, name: 'John Doe', email: 'john@example.com' });
    expect(user).toBeDefined();
    expect(user.id).toBe(testUserId);
    expect(user.name).toBe('John Doe');

    const users = await userRepo.find();
    expect(users.length).toBe(1);

    const fetched = await userRepo.findOne({ where: { id: testUserId } });
    expect(fetched).toBeDefined();
    expect(fetched!.email).toBe('john@example.com');
  });

  it('should create multiple users and get all users', async () => {
    await userRepo.save({ id: USER_1_ID, name: 'John', email: 'john@example.com' });
    await userRepo.save({ id: USER_2_ID, name: 'Jane', email: 'jane@example.com' });

    const users = await userRepo.find();
    expect(users.length).toBe(2);
    expect(users.map(u => u.name)).toEqual(expect.arrayContaining(['John', 'Jane']));
  });
});


describe('Event Integration (pg-mem)', () => {
  let dataSource: DataSource;
  let eventRepo: Repository<Event>;
  let userRepo: Repository<User>;
  let auditRepo: Repository<AuditLog>;
  let aiService: Partial<AiService>;
  let service: EventService;

  beforeAll(async () => {
    dataSource = await createPgMemDataSource();
    eventRepo = dataSource.getRepository(Event);
    userRepo = dataSource.getRepository(User);
    auditRepo = dataSource.getRepository(AuditLog);
    aiService = {
      summarizeMergedEvents: jest.fn(async (events: Event[]) => {
        const titles = events.map((e) => e.title).join(' + ');
        return `Merged ${events.length} overlapping events: ${titles}.`;
      }),
    };
    service = new EventService(
      eventRepo as any,
      userRepo as any,
      auditRepo as any,
      dataSource,
      aiService as AiService,
      undefined as any,
    );
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    try {
      await dataSource.query('DELETE FROM audit_logs');
    } catch (e) {
    }
    try {
      await dataSource.query('DELETE FROM event_invitees');
    } catch (e) {
    }
    try {
      await dataSource.query('DELETE FROM events');
    } catch (e) {
    }
    try {
      await dataSource.query('DELETE FROM users');
    } catch (e) {
    }

    await userRepo.save({ id: USER_1_ID, name: 'John', email: 'john@example.com' });
    await userRepo.save({ id: USER_2_ID, name: 'Jane', email: 'jane@example.com' });
  });

  /**
   * CREATE: should persist a new event with correct fields and relations
   */
  it('create: should persist a new event with correct fields and relations', async () => {
    const creator = await userRepo.findOneBy({ id: USER_1_ID });
    const invitee = await userRepo.findOneBy({ id: USER_2_ID });

    const dto: CreateEventDto = {
      title: 'Team Sync',
      description: 'Discuss weekly progress',
      status: EventStatus.TODO,
      startTime: new Date('2024-05-01T10:00:00Z').toISOString(),
      endTime: new Date('2024-05-01T11:00:00Z').toISOString(),
      creatorId: creator!.id,
      inviteeIds: [invitee!.id],
    };

    const created = await service.create(dto);

    const saved = await eventRepo.findOne({
      where: { id: created.id },
      relations: ['creator', 'invitees'],
    });

    expect(saved).toBeDefined();
    expect(saved!.title).toBe(dto.title);
    expect(saved!.creator.id).toBe(USER_1_ID);
    expect(saved!.invitees.length).toBe(1);
  });

  /**
   * READ: should return an event by ID with its relations
   */
  it('getEventById: should return an event with relations', async () => {
    const creator = await userRepo.findOneBy({ id: USER_1_ID });
    const invitee = await userRepo.findOneBy({ id: USER_2_ID });
    const event = await eventRepo.save({
      id: uuidv4(),
      title: 'Planning Meeting',
      description: 'Discuss roadmap',
      status: EventStatus.IN_PROGRESS,
      startTime: new Date('2024-05-01T10:00:00Z'),
      endTime: new Date('2024-05-01T11:00:00Z'),
      creator,
      invitees: [invitee!], // At least one invitee required
      mergedFrom: null,
    });

    const found = await service.getEventById(event.id);
    expect(found).toBeDefined();
    expect(found.title).toBe('Planning Meeting');
  });

  /**
   * UPDATE: should modify fields of an existing event
   */
  it('update: should modify title and status of an event', async () => {
    const creator = await userRepo.findOneBy({ id: USER_1_ID });
    const invitee = await userRepo.findOneBy({ id: USER_2_ID });
    const event = await eventRepo.save({
      id: uuidv4(),
      title: 'Review',
      description: 'Code review session',
      status: EventStatus.TODO,
      startTime: new Date('2024-05-02T09:00:00Z'),
      endTime: new Date('2024-05-02T10:00:00Z'),
      creator,
      invitees: [invitee!], // At least one invitee required
      mergedFrom: null,
    });

    await service.update(event.id, { title: 'Review Updated', status: EventStatus.COMPLETED });
    const updated = await eventRepo.findOneBy({ id: event.id });

    expect(updated!.title).toBe('Review Updated');
    expect(updated!.status).toBe(EventStatus.COMPLETED);
  });

  /**
   * DELETE: should remove an event by ID
   */
  it('delete: should remove event and no longer exist in DB', async () => {
    const creator = await userRepo.findOneBy({ id: USER_1_ID });
    const invitee = await userRepo.findOneBy({ id: USER_2_ID });
    const event = await eventRepo.save({
      id: uuidv4(),
      title: 'Temporary',
      description: 'This will be deleted',
      status: EventStatus.TODO,
      startTime: new Date('2024-05-03T10:00:00Z'),
      endTime: new Date('2024-05-03T11:00:00Z'),
      creator,
      invitees: [invitee!], // At least one invitee required
      mergedFrom: null,
    });

    await service.remove(event.id);
    const afterDelete = await eventRepo.findOneBy({ id: event.id });

    expect(afterDelete).toBeNull();
  });


  // should merge overlapping events with common participants and persist merged record with audit log
  it('mergeAll: merges overlapping events with common participants and writes audit log', async () => {
    const user1 = await userRepo.findOne({ where: { id: USER_1_ID } });
    const user2 = await userRepo.findOne({ where: { id: USER_2_ID } });
    
    await eventRepo.save({
      id: uuidv4(),
      title: 'Planning',
      description: 'Desc',
      status: EventStatus.TODO,
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T11:00:00Z'),
      creator: user1!,
      invitees: [user2!],
      mergedFrom: null,
    });
    await eventRepo.save({
      id: uuidv4(),
      title: 'Team Meeting',
      description: 'Desc',
      status: EventStatus.IN_PROGRESS,
      startTime: new Date('2024-01-01T10:30:00Z'),
      endTime: new Date('2024-01-01T11:30:00Z'),
      creator: user1!,
      invitees: [user2!],
      mergedFrom: null,
    });

    const merged = await service.mergeAll(USER_1_ID);
    const all = await eventRepo.find();
    const audits = await auditRepo.find();

    expect(merged).toBeDefined();
    expect(all.length).toBe(1);
    expect(audits.length).toBe(1);
    expect((aiService.summarizeMergedEvents as jest.Mock).mock.calls.length).toBe(1);
    expect((merged as any).auditLog).toBeDefined();
    expect((merged as any).auditLog.mergedEventIds.length).toBe(2);
  });

  // should exclude CANCELED events from merging
  it('mergeAll: excludes CANCELED events from merge', async () => {
    const user1 = await userRepo.findOne({ where: { id: USER_1_ID } });
    const user2 = await userRepo.findOne({ where: { id: USER_2_ID } });
    
    await eventRepo.save({
      id: uuidv4(),
      title: 'Planning',
      description: 'Desc',
      status: EventStatus.TODO,
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T11:00:00Z'),
      creator: user1!,
      invitees: [user2!],
      mergedFrom: null,
    });
    await eventRepo.save({
      id: uuidv4(),
      title: 'Cancelled Meeting',
      description: 'Desc',
      status: EventStatus.CANCELED,
      startTime: new Date('2024-01-01T10:30:00Z'),
      endTime: new Date('2024-01-01T11:30:00Z'),
      creator: user1!,
      invitees: [user2!],
      mergedFrom: null,
    });

    await expect(service.mergeAll(USER_1_ID)).rejects.toThrow(
      'Need at least 2 non-canceled events to perform merge operation',
    );
  });

  // should not merge events without common participants (besides userId)
  it('mergeAll: does not merge events without common participants', async () => {
    const user1 = await userRepo.findOne({ where: { id: USER_1_ID } });
    const user2 = await userRepo.findOne({ where: { id: USER_2_ID } });
    
    const USER_3_ID = '00000000-0000-0000-0000-000000000003';
    await userRepo.save({ id: USER_3_ID, name: 'Bob', email: 'bob@example.com' });
    const user3 = await userRepo.findOne({ where: { id: USER_3_ID } });
    
    await eventRepo.save({
      id: uuidv4(),
      title: 'Planning',
      description: 'Desc',
      status: EventStatus.TODO,
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T11:00:00Z'),
      creator: user1!,
      invitees: [user2!],
      mergedFrom: null,
    });
    await eventRepo.save({
      id: uuidv4(),
      title: 'Team Meeting',
      description: 'Desc',
      status: EventStatus.IN_PROGRESS,
      startTime: new Date('2024-01-01T10:30:00Z'),
      endTime: new Date('2024-01-01T11:30:00Z'),
      creator: user1!,
      invitees: [user3!],
      mergedFrom: null,
    });

    await expect(service.mergeAll(USER_1_ID)).rejects.toThrow(
      'No overlapping events found to merge',
    );
  });

  // should not merge events with incompatible titles
  it('mergeAll: does not merge events with incompatible titles', async () => {
    const user1 = await userRepo.findOne({ where: { id: USER_1_ID } });
    const user2 = await userRepo.findOne({ where: { id: USER_2_ID } });
    
    await eventRepo.save({
      id: uuidv4(),
      title: '1:1 manager call',
      description: 'Desc',
      status: EventStatus.TODO,
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T11:00:00Z'),
      creator: user1!,
      invitees: [user2!],
      mergedFrom: null,
    });
    await eventRepo.save({
      id: uuidv4(),
      title: 'demo meeting',
      description: 'Desc',
      status: EventStatus.IN_PROGRESS,
      startTime: new Date('2024-01-01T10:45:00Z'),
      endTime: new Date('2024-01-01T12:00:00Z'),
      creator: user1!,
      invitees: [user2!],
      mergedFrom: null,
    });

    await expect(service.mergeAll(USER_1_ID)).rejects.toThrow(
      'No overlapping events found to merge',
    );
  });

  // should successfully merge events with compatible titles and common participants
  it('mergeAll: successfully merges events with compatible titles', async () => {
    const user1 = await userRepo.findOne({ where: { id: USER_1_ID } });
    const user2 = await userRepo.findOne({ where: { id: USER_2_ID } });
    
    await eventRepo.save({
      id: uuidv4(),
      title: 'Team Standup',
      description: 'Daily sync',
      status: EventStatus.TODO,
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T11:00:00Z'),
      creator: user1!,
      invitees: [user2!],
      mergedFrom: null,
    });
    await eventRepo.save({
      id: uuidv4(),
      title: 'Team Review',
      description: 'Code review',
      status: EventStatus.IN_PROGRESS,
      startTime: new Date('2024-01-01T10:30:00Z'),
      endTime: new Date('2024-01-01T11:30:00Z'),
      creator: user1!,
      invitees: [user2!],
      mergedFrom: null,
    });

    const merged = await service.mergeAll(USER_1_ID);
    const all = await eventRepo.find();

    expect(merged).toBeDefined();
    expect(all.length).toBe(1);
    expect(merged.title).toContain('Team Standup');
    expect(merged.title).toContain('Team Review');
    expect((merged as any).auditLog).toBeDefined();
  });

  // Functional test: verifies correctness and relation handling
  it('batchCreate: correctly inserts multiple events and maintains creator/invitee relations', async () => {
    const dto: BatchCreateEventDto = {
      events: [
        {
          title: 'A',
          description: 'x',
          status: EventStatus.TODO,
          startTime: new Date('2024-02-01T10:00:00Z').toISOString(),
          endTime: new Date('2024-02-01T11:00:00Z').toISOString(),
      creatorId: USER_1_ID,
      inviteeIds: [USER_2_ID],
        } as CreateEventDto,
        {
          title: 'B',
          description: 'y',
          status: EventStatus.COMPLETED,
          startTime: new Date('2024-02-01T12:00:00Z').toISOString(),
          endTime: new Date('2024-02-01T13:00:00Z').toISOString(),
          creatorId: USER_1_ID,
          inviteeIds: [USER_2_ID], // At least one invitee is required
        } as CreateEventDto,
      ],
    };

    const result = await service.batchCreate(dto);
    expect(result.length).toBe(2);
    const withInvitee = result.find((e) => e.title === 'A')!;
    expect(withInvitee.invitees?.length).toBe(1);
  });

  // Performance test: verifies scalability and bulk efficiency
  it('batchCreate: efficiently inserts up to 500 events within performance limits', async () => {
    const events = Array.from({ length: 500 }, (_, i) => ({
      title: `Event-${i}`,
      description: `desc-${i}`,
      status: EventStatus.TODO,
      startTime: new Date(`2024-02-01T${10 + (i % 5)}:00:00Z`).toISOString(),
      endTime: new Date(`2024-02-01T${11 + (i % 5)}:00:00Z`).toISOString(),
      creatorId: USER_1_ID,
      inviteeIds: [USER_2_ID],
    }));

    const dto: BatchCreateEventDto = { events };

    const start = performance.now();
    const result = await service.batchCreate(dto);
    const end = performance.now();

    const duration = end - start;

    expect(result.length).toBe(500);

    const titles = new Set(result.map((e) => e.title));
    expect(titles.size).toBe(500);

    console.log(`\n batchCreate(500 events) took: ${duration.toFixed(2)}ms (${(duration / 1000).toFixed(2)}s)`);

    expect(duration).toBeLessThan(2000);
  });
  

  // property-based: randomly generated overlapping events merge to single with correct bounds
  it('property: mergeAll produces start=min(startTimes), end=max(endTimes)', async () => {
    const user1 = await userRepo.findOne({ where: { id: USER_1_ID } });
    const user2 = await userRepo.findOne({ where: { id: USER_2_ID } });

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            startOffset: fc.integer({ min: 0, max: 120 }),
            duration: fc.integer({ min: 1, max: 60 }),
          }),
          { minLength: 2, maxLength: 6 },
        ),
        async (arr) => {
          try {
            await dataSource.query('DELETE FROM audit_logs');
          } catch (e) {
          }
          try {
            await dataSource.query('DELETE FROM event_invitees');
          } catch (e) {
          }
          try {
            await dataSource.query('DELETE FROM events');
          } catch (e) {
          }
          try {
            await dataSource.query('DELETE FROM users');
          } catch (e) {
          }
          
          await userRepo.save({ id: USER_1_ID, name: 'John', email: 'john@example.com' });
          await userRepo.save({ id: USER_2_ID, name: 'Jane', email: 'jane@example.com' });
          const u1 = await userRepo.findOne({ where: { id: USER_1_ID } });
          const u2 = await userRepo.findOne({ where: { id: USER_2_ID } });

          const base = new Date('2024-03-01T10:00:00Z').getTime();

          const sortedArr = [...arr].sort((a, b) => a.startOffset - b.startOffset);
          
          const actualStarts: number[] = [];
          const actualEnds: number[] = [];
          
          for (let i = 0; i < sortedArr.length; i++) {
            const { startOffset, duration } = sortedArr[i];
            let adjustedStartOffset = startOffset;
            if (i > 0) {
              const prevAdjustedStartMinutes = (actualStarts[i - 1] - base) / 60_000;
              const prevDuration = sortedArr[i - 1].duration;
              const prevEndMinutes = prevAdjustedStartMinutes + prevDuration;
              adjustedStartOffset = Math.max(prevAdjustedStartMinutes, Math.min(startOffset, prevEndMinutes - 1));
            }
            
            const s = new Date(base + adjustedStartOffset * 60_000);
            const e = new Date(s.getTime() + duration * 60_000);
            actualStarts.push(s.getTime());
            actualEnds.push(e.getTime());
            await eventRepo.save({
              id: uuidv4(),
              title: `E-${adjustedStartOffset}`,
              description: 'pbt',
              status: EventStatus.TODO,
              startTime: s,
              endTime: e,
              creator: u1!,
              invitees: [u2!],
              mergedFrom: null,
            });
          }

          const merged = await service.mergeAll(USER_1_ID);
          expect(merged.startTime.getTime()).toBe(Math.min(...actualStarts));
          expect(merged.endTime.getTime()).toBe(Math.max(...actualEnds));
        },
      ),
      { numRuns: 25 },
    );
  });

    /**
   * GET /events/conflicts/:userId
   * 
   * Should return all overlapping events (conflicts) for a user.
   * This verifies:
   * 1. Only events involving the given user (as creator or invitee) are considered.
   * 2. All overlapping events are detected and returned (with new conditions: common participants, compatible titles).
   * 3. Non-overlapping events are excluded.
   */
  it('findConflicts: returns all overlapping events for a user', async () => {
    const user1 = await userRepo.findOneBy({ id: USER_1_ID });
    const user2 = await userRepo.findOneBy({ id: USER_2_ID });

    const eventA = await eventRepo.save({
      id: uuidv4(),
      title: 'Event A',
      description: 'First meeting',
      status: EventStatus.TODO,
      startTime: new Date('2024-07-01T10:00:00Z'),
      endTime: new Date('2024-07-01T11:00:00Z'),
      creator: user1!,
      invitees: [user2!],
      mergedFrom: null,
    });

    const eventB = await eventRepo.save({
      id: uuidv4(),
      title: 'Event B',
      description: 'Overlapping meeting',
      status: EventStatus.TODO,
      startTime: new Date('2024-07-01T10:30:00Z'),
      endTime: new Date('2024-07-01T11:30:00Z'),
      creator: user1!,
      invitees: [user2!],
      mergedFrom: null,
    });

    await eventRepo.save({
      id: uuidv4(),
      title: 'Event C',
      description: 'Non-overlapping meeting',
      status: EventStatus.TODO,
      startTime: new Date('2024-07-01T12:00:00Z'),
      endTime: new Date('2024-07-01T13:00:00Z'),
      creator: user1!,
      invitees: [user2!],
      mergedFrom: null,
    });

    const conflicts = await service.findConflicts(USER_1_ID);

    expect(conflicts.length).toBe(2);
    const titles = conflicts.map((e) => e.title);
    expect(titles).toEqual(expect.arrayContaining(['Event A', 'Event B']));
    expect(titles).not.toContain('Event C');
  });

  it('mergeAll: merges events that touch at boundary (endTime1 = startTime2)', async () => {
    const user1 = await userRepo.findOneBy({ id: USER_1_ID });
    const user2 = await userRepo.findOneBy({ id: USER_2_ID });

    await eventRepo.save({
      id: uuidv4(),
      title: 'Event 1',
      description: 'First event',
      status: EventStatus.TODO,
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T11:00:00Z'),
      creator: user1!,
      invitees: [user2!],
      mergedFrom: null,
    });

    await eventRepo.save({
      id: uuidv4(),
      title: 'Event 2',
      description: 'Second event',
      status: EventStatus.TODO,
      startTime: new Date('2024-01-01T11:00:00Z'),
      endTime: new Date('2024-01-01T12:00:00Z'),
      creator: user1!,
      invitees: [user2!],
      mergedFrom: null,
    });

    const merged = await service.mergeAll(USER_1_ID);
    const all = await eventRepo.find();

    expect(merged).toBeDefined();
    expect(all.length).toBe(1);
    expect(merged.startTime.getTime()).toBe(new Date('2024-01-01T10:00:00Z').getTime());
    expect(merged.endTime.getTime()).toBe(new Date('2024-01-01T12:00:00Z').getTime());
  });

  it('mergeAll: does not merge when there are no common participants (besides userId)', async () => {
    const user1 = await userRepo.findOneBy({ id: USER_1_ID });
    const user2 = await userRepo.findOneBy({ id: USER_2_ID });
    
    const USER_3_ID = '00000000-0000-0000-0000-000000000003';
    await userRepo.save({ id: USER_3_ID, name: 'Charlie', email: 'charlie@example.com' });
    const user3 = await userRepo.findOneBy({ id: USER_3_ID });

    await eventRepo.save({
      id: uuidv4(),
      title: 'Event with User 2',
      description: 'Event with user2 as invitee',
      status: EventStatus.TODO,
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T11:00:00Z'),
      creator: user1!,
      invitees: [user2!],
      mergedFrom: null,
    });

    await eventRepo.save({
      id: uuidv4(),
      title: 'Event with User 3',
      description: 'Event with user3 as invitee',
      status: EventStatus.TODO,
      startTime: new Date('2024-01-01T10:30:00Z'),
      endTime: new Date('2024-01-01T11:30:00Z'),
      creator: user1!,
      invitees: [user3!],
      mergedFrom: null,
    });

    await expect(service.mergeAll(USER_1_ID)).rejects.toThrow(
      'No overlapping events found to merge',
    );
  });

  it('mergeAll: merges the largest group when multiple overlapping groups exist', async () => {
    const user1 = await userRepo.findOneBy({ id: USER_1_ID });
    const user2 = await userRepo.findOneBy({ id: USER_2_ID });
    
    const USER_3_ID = '00000000-0000-0000-0000-000000000003';
    await userRepo.save({ id: USER_3_ID, name: 'Bob', email: 'bob@example.com' });
    const user3 = await userRepo.findOneBy({ id: USER_3_ID });

    await eventRepo.save({
      id: uuidv4(),
      title: 'Group1 Event 1',
      description: 'First event in group 1',
      status: EventStatus.TODO,
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T11:00:00Z'),
      creator: user1!,
      invitees: [user2!],
      mergedFrom: null,
    });
    await eventRepo.save({
      id: uuidv4(),
      title: 'Group1 Event 2',
      description: 'Second event in group 1',
      status: EventStatus.TODO,
      startTime: new Date('2024-01-01T10:30:00Z'),
      endTime: new Date('2024-01-01T11:30:00Z'),
      creator: user1!,
      invitees: [user2!],
      mergedFrom: null,
    });

    await eventRepo.save({
      id: uuidv4(),
      title: 'Group2 Event 1',
      description: 'First event in group 2',
      status: EventStatus.TODO,
      startTime: new Date('2024-01-01T14:00:00Z'),
      endTime: new Date('2024-01-01T15:00:00Z'),
      creator: user1!,
      invitees: [user3!],
      mergedFrom: null,
    });
    await eventRepo.save({
      id: uuidv4(),
      title: 'Group2 Event 2',
      description: 'Second event in group 2',
      status: EventStatus.TODO,
      startTime: new Date('2024-01-01T14:30:00Z'),
      endTime: new Date('2024-01-01T15:30:00Z'),
      creator: user1!,
      invitees: [user3!],
      mergedFrom: null,
    });
    await eventRepo.save({
      id: uuidv4(),
      title: 'Group2 Event 3',
      description: 'Third event in group 2',
      status: EventStatus.TODO,
      startTime: new Date('2024-01-01T14:45:00Z'),
      endTime: new Date('2024-01-01T16:00:00Z'),
      creator: user1!,
      invitees: [user3!],
      mergedFrom: null,
    });

    const merged = await service.mergeAll(USER_1_ID);
    const all = await eventRepo.find();

    expect(merged).toBeDefined();
    expect(all.length).toBe(3);
    expect((merged as any).auditLog.mergedEventIds.length).toBe(3);
    expect(merged.invitees[0].id).toBe(USER_3_ID);
  });

  it('mergeAll: handles concurrent events with same start and end times', async () => {
    const user1 = await userRepo.findOneBy({ id: USER_1_ID });
    const user2 = await userRepo.findOneBy({ id: USER_2_ID });

    const sameStart = new Date('2024-01-01T10:00:00Z');
    const sameEnd = new Date('2024-01-01T11:00:00Z');

    await eventRepo.save({
      id: uuidv4(),
      title: 'Concurrent Event 1',
      description: 'First concurrent event',
      status: EventStatus.TODO,
      startTime: sameStart,
      endTime: sameEnd,
      creator: user1!,
      invitees: [user2!],
      mergedFrom: null,
    });

    await eventRepo.save({
      id: uuidv4(),
      title: 'Concurrent Event 2',
      description: 'Second concurrent event',
      status: EventStatus.IN_PROGRESS,
      startTime: sameStart, // Same start time
      endTime: sameEnd, // Same end time
      creator: user1!,
      invitees: [user2!],
      mergedFrom: null,
    });

    const merged = await service.mergeAll(USER_1_ID);
    const all = await eventRepo.find();

    expect(merged).toBeDefined();
    expect(all.length).toBe(1);
    expect(merged.startTime.getTime()).toBe(sameStart.getTime());
    expect(merged.endTime.getTime()).toBe(sameEnd.getTime());
  });
});