import { DataSource, Repository } from 'typeorm';
import { createPgMemDataSource } from '../../integration/utils/pgmem-datasource';
import { Event, EventStatus } from '../../../src/event/entities/event.entity';
import { User } from '../../../src/user/entities/user.entity';
import { v4 as uuidv4 } from 'uuid';

describe('Event Repository (Database Unit Tests)', () => {
  let dataSource: DataSource;
  let eventRepository: Repository<Event>;
  let userRepository: Repository<User>;

  beforeAll(async () => {
    dataSource = await createPgMemDataSource();
    eventRepository = dataSource.getRepository(Event);
    userRepository = dataSource.getRepository(User);
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

  describe('Basic CRUD Operations', () => {
    it('should create an event', async () => {
      const creatorId = uuidv4();
      const eventId = uuidv4();
      const creator = await userRepository.save(
        userRepository.create({ id: creatorId, name: 'Creator', email: 'crud-create@example.com' }),
      );

      const eventData = {
        id: eventId,
        title: 'Test Event',
        description: 'Test Description',
        status: EventStatus.TODO,
        startTime: new Date('2024-01-01T10:00:00Z'),
        endTime: new Date('2024-01-01T12:00:00Z'),
        creator: creator,
        invitees: [],
      };

      const event = eventRepository.create(eventData);
      const savedEvent = await eventRepository.save(event);

      expect(savedEvent).toBeDefined();
      expect(savedEvent.id).toBeDefined();
      expect(savedEvent.title).toBe('Test Event');
      expect(savedEvent.status).toBe(EventStatus.TODO);
      expect(savedEvent.creator.id).toBe(creator.id);
    });

    it('should find an event by ID', async () => {
      const creatorId = uuidv4();
      const eventId = uuidv4();
      const creator = await userRepository.save(
        userRepository.create({ id: creatorId, name: 'Creator', email: 'crud-find@example.com' }),
      );

      const event = eventRepository.create({
        id: eventId,
        title: 'Find Me',
        description: 'Description',
        status: EventStatus.TODO,
        startTime: new Date('2024-01-01T10:00:00Z'),
        endTime: new Date('2024-01-01T12:00:00Z'),
        creator: creator,
        invitees: [],
      });
      const savedEvent = await eventRepository.save(event);

      const foundEvent = await eventRepository.findOne({
        where: { id: savedEvent.id },
      });

      expect(foundEvent).toBeDefined();
      expect(foundEvent!.id).toBe(savedEvent.id);
      expect(foundEvent!.title).toBe('Find Me');
    });

    it('should update an event', async () => {
      const creatorId = uuidv4();
      const eventId = uuidv4();
      const creator = await userRepository.save(
        userRepository.create({ id: creatorId, name: 'Creator', email: 'crud-update@example.com' }),
      );

      const event = eventRepository.create({
        id: eventId,
        title: 'Original Title',
        description: 'Original Description',
        status: EventStatus.TODO,
        startTime: new Date('2024-01-01T10:00:00Z'),
        endTime: new Date('2024-01-01T12:00:00Z'),
        creator: creator,
        invitees: [],
      });
      const savedEvent = await eventRepository.save(event);

      savedEvent.title = 'Updated Title';
      savedEvent.status = EventStatus.IN_PROGRESS;
      const updatedEvent = await eventRepository.save(savedEvent);

      expect(updatedEvent.title).toBe('Updated Title');
      expect(updatedEvent.status).toBe(EventStatus.IN_PROGRESS);
    });

    it('should delete an event', async () => {
      const creatorId = uuidv4();
      const eventId = uuidv4();
      const creator = await userRepository.save(
        userRepository.create({ id: creatorId, name: 'Creator', email: 'crud-delete@example.com' }),
      );

      const event = eventRepository.create({
        id: eventId,
        title: 'To Delete',
        description: 'Description',
        status: EventStatus.TODO,
        startTime: new Date('2024-01-01T10:00:00Z'),
        endTime: new Date('2024-01-01T12:00:00Z'),
        creator: creator,
        invitees: [],
      });
      const savedEvent = await eventRepository.save(event);

      await eventRepository.remove(savedEvent);

      const foundEvent = await eventRepository.findOne({
        where: { id: savedEvent.id },
      });

      expect(foundEvent).toBeNull();
    });
  });

  describe('Relationships', () => {
    it('should load event with creator relation', async () => {
      const creatorId = uuidv4();
      const eventId = uuidv4();
      const creator = await userRepository.save(
        userRepository.create({ id: creatorId, name: 'Creator', email: 'rel-creator@example.com' }),
      );

      const event = eventRepository.create({
        id: eventId,
        title: 'Event with Creator',
        description: 'Description',
        status: EventStatus.TODO,
        startTime: new Date('2024-01-01T10:00:00Z'),
        endTime: new Date('2024-01-01T12:00:00Z'),
        creator: creator,
        invitees: [],
      });
      await eventRepository.save(event);

      const eventWithCreator = await eventRepository.findOne({
        where: { id: event.id },
        relations: ['creator'],
      });

      expect(eventWithCreator).toBeDefined();
      expect(eventWithCreator!.creator).toBeDefined();
      expect(eventWithCreator!.creator.id).toBe(creator.id);
      expect(eventWithCreator!.creator.name).toBe('Creator');
    });

    it('should handle many-to-many relationship with invitees', async () => {
      const creatorId = uuidv4();
      const invitee1Id = uuidv4();
      const invitee2Id = uuidv4();
      const eventId = uuidv4();
      const creator = await userRepository.save(
        userRepository.create({ id: creatorId, name: 'Creator', email: 'rel-m2m-creator@example.com' }),
      );
      const invitee1 = await userRepository.save(
        userRepository.create({ id: invitee1Id, name: 'Invitee 1', email: 'rel-m2m-invitee1@example.com' }),
      );
      const invitee2 = await userRepository.save(
        userRepository.create({ id: invitee2Id, name: 'Invitee 2', email: 'rel-m2m-invitee2@example.com' }),
      );

      const event = eventRepository.create({
        id: eventId,
        title: 'Event with Invitees',
        description: 'Description',
        status: EventStatus.TODO,
        startTime: new Date('2024-01-01T10:00:00Z'),
        endTime: new Date('2024-01-01T12:00:00Z'),
        creator: creator,
        invitees: [invitee1, invitee2],
      });
      await eventRepository.save(event);

      const eventWithInvitees = await eventRepository.findOne({
        where: { id: event.id },
        relations: ['invitees'],
      });

      expect(eventWithInvitees).toBeDefined();
      expect(eventWithInvitees!.invitees.length).toBe(2);
      expect(eventWithInvitees!.invitees.map((i) => i.id)).toContain(invitee1.id);
      expect(eventWithInvitees!.invitees.map((i) => i.id)).toContain(invitee2.id);
    });
  });

  describe('Query Builder', () => {
    it('should use query builder with joins', async () => {
      const creatorId = uuidv4();
      const inviteeId = uuidv4();
      const eventId = uuidv4();
      const creator = await userRepository.save(
        userRepository.create({ id: creatorId, name: 'Creator', email: 'qb-joins-creator@example.com' }),
      );
      const invitee = await userRepository.save(
        userRepository.create({ id: inviteeId, name: 'Invitee', email: 'qb-joins-invitee@example.com' }),
      );

      const event = eventRepository.create({
        id: eventId,
        title: 'Query Builder Event',
        description: 'Description',
        status: EventStatus.TODO,
        startTime: new Date('2024-01-01T10:00:00Z'),
        endTime: new Date('2024-01-01T12:00:00Z'),
        creator: creator,
        invitees: [invitee],
      });
      await eventRepository.save(event);

      const events = await eventRepository
        .createQueryBuilder('event')
        .leftJoinAndSelect('event.creator', 'creator')
        .leftJoinAndSelect('event.invitees', 'invitees')
        .where('creator.id = :userId', { userId: creator.id })
        .getMany();

      expect(events.length).toBe(1);
      expect(events[0].creator.id).toBe(creator.id);
      expect(events[0].invitees.length).toBe(1);
    });

    it('should use query builder with date filtering', async () => {
      const creatorId = uuidv4();
      const event1Id = uuidv4();
      const event2Id = uuidv4();
      const creator = await userRepository.save(
        userRepository.create({ id: creatorId, name: 'Date Filter Creator', email: 'datefilter@example.com' }),
      );

      const event1 = eventRepository.create({
        id: event1Id,
        title: 'Event 1',
        description: 'Description',
        status: EventStatus.TODO,
        startTime: new Date('2024-01-01T10:00:00Z'),
        endTime: new Date('2024-01-01T12:00:00Z'),
        creator: creator,
        invitees: [],
      });
      await eventRepository.save(event1);

      const event2 = eventRepository.create({
        id: event2Id,
        title: 'Event 2',
        description: 'Description',
        status: EventStatus.TODO,
        startTime: new Date('2024-02-01T10:00:00Z'),
        endTime: new Date('2024-02-01T12:00:00Z'),
        creator: creator,
        invitees: [],
      });
      await eventRepository.save(event2);

      const events = await eventRepository
        .createQueryBuilder('event')
        .where('event.startTime >= :date', { date: new Date('2024-02-01T00:00:00Z') })
        .getMany();

      expect(events.length).toBe(1);
      expect(events[0].title).toBe('Event 2');
    });

    it('should use query builder with status filtering', async () => {
      const creatorId = uuidv4();
      const event1Id = uuidv4();
      const event2Id = uuidv4();
      const creator = await userRepository.save(
        userRepository.create({ id: creatorId, name: 'Status Filter Creator', email: 'statusfilter@example.com' }),
      );

      await eventRepository.save(
        eventRepository.create({
          id: event1Id,
          title: 'TODO Event',
          description: 'Description',
          status: EventStatus.TODO,
          startTime: new Date('2024-01-01T10:00:00Z'),
          endTime: new Date('2024-01-01T12:00:00Z'),
          creator: creator,
          invitees: [],
        }),
      );

      await eventRepository.save(
        eventRepository.create({
          id: event2Id,
          title: 'In Progress Event',
          description: 'Description',
          status: EventStatus.IN_PROGRESS,
          startTime: new Date('2024-01-02T10:00:00Z'),
          endTime: new Date('2024-01-02T12:00:00Z'),
          creator: creator,
          invitees: [],
        }),
      );

      const todoEvents = await eventRepository
        .createQueryBuilder('event')
        .where('event.status = :status', { status: EventStatus.TODO })
        .getMany();

      expect(todoEvents.length).toBe(1);
      expect(todoEvents[0].status).toBe(EventStatus.TODO);
    });
  });

  describe('JSONB Column', () => {
    it('should store and retrieve mergedFrom JSONB field', async () => {
      const creatorId = uuidv4();
      const eventId = uuidv4();
      const creator = await userRepository.save(
        userRepository.create({ id: creatorId, name: 'Creator', email: 'jsonb-creator@example.com' }),
      );

      const mergedFromIds = ['event-id-1', 'event-id-2', 'event-id-3'];

      const event = eventRepository.create({
        id: eventId,
        title: 'Merged Event',
        description: 'Description',
        status: EventStatus.TODO,
        startTime: new Date('2024-01-01T10:00:00Z'),
        endTime: new Date('2024-01-01T12:00:00Z'),
        creator: creator,
        invitees: [],
        mergedFrom: mergedFromIds,
      });
      const savedEvent = await eventRepository.save(event);

      const foundEvent = await eventRepository.findOne({
        where: { id: savedEvent.id },
      });

      expect(foundEvent).toBeDefined();
      expect(foundEvent!.mergedFrom).toBeDefined();
      expect(Array.isArray(foundEvent!.mergedFrom)).toBe(true);
      expect(foundEvent!.mergedFrom!.length).toBe(3);
      expect(foundEvent!.mergedFrom).toEqual(mergedFromIds);
    });
  });
});

