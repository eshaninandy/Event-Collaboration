import { DataSource, Repository } from 'typeorm';
import { createPgMemDataSource } from '../../integration/utils/pgmem-datasource';
import { User } from '../../../src/user/entities/user.entity';
import { Event } from '../../../src/event/entities/event.entity';
import { v4 as uuidv4 } from 'uuid';

describe('User Repository (Database Unit Tests)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let eventRepository: Repository<Event>;

  beforeAll(async () => {
    dataSource = await createPgMemDataSource();
    userRepository = dataSource.getRepository(User);
    eventRepository = dataSource.getRepository(Event);
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
    it('should create a user', async () => {
      const userId = uuidv4();
      const userData = {
        id: userId,
        name: 'John Doe',
        email: 'john@example.com',
      };

      const user = userRepository.create(userData);
      const savedUser = await userRepository.save(user);

      expect(savedUser).toBeDefined();
      expect(savedUser.id).toBeDefined();
      expect(savedUser.name).toBe('John Doe');
      expect(savedUser.email).toBe('john@example.com');
    });

    it('should find a user by ID', async () => {
      const userId = uuidv4();
      const user = userRepository.create({
        id: userId,
        name: 'Jane Smith',
        email: 'jane@example.com',
      });
      const savedUser = await userRepository.save(user);

      const foundUser = await userRepository.findOne({
        where: { id: savedUser.id },
      });

      expect(foundUser).toBeDefined();
      expect(foundUser!.id).toBe(savedUser.id);
      expect(foundUser!.name).toBe('Jane Smith');
    });

    it('should find a user by email', async () => {
      const userId = uuidv4();
      const user = userRepository.create({
        id: userId,
        name: 'Bob Wilson',
        email: 'bob@example.com',
      });
      await userRepository.save(user);

      const foundUser = await userRepository.findOne({
        where: { email: 'bob@example.com' },
      });

      expect(foundUser).toBeDefined();
      expect(foundUser!.email).toBe('bob@example.com');
    });

    it('should find all users', async () => {
      await userRepository.save(
        userRepository.create({ id: uuidv4(), name: 'User 1', email: 'user1@example.com' }),
      );
      await userRepository.save(
        userRepository.create({ id: uuidv4(), name: 'User 2', email: 'user2@example.com' }),
      );
      await userRepository.save(
        userRepository.create({ id: uuidv4(), name: 'User 3', email: 'user3@example.com' }),
      );

      const users = await userRepository.find();

      expect(users.length).toBe(3);
    });

    it('should update a user', async () => {
      const userId = uuidv4();
      const user = userRepository.create({
        id: userId,
        name: 'Original Name',
        email: 'original@example.com',
      });
      const savedUser = await userRepository.save(user);

      savedUser.name = 'Updated Name';
      const updatedUser = await userRepository.save(savedUser);

      expect(updatedUser.name).toBe('Updated Name');
      expect(updatedUser.email).toBe('original@example.com');
    });

    it('should delete a user', async () => {
      const userId = uuidv4();
      const user = userRepository.create({
        id: userId,
        name: 'To Delete',
        email: 'delete@example.com',
      });
      const savedUser = await userRepository.save(user);

      await userRepository.remove(savedUser);

      const foundUser = await userRepository.findOne({
        where: { id: savedUser.id },
      });

      expect(foundUser).toBeNull();
    });
  });

  describe('Relationships', () => {
    it('should load user with events relation', async () => {
      const userId = uuidv4();
      const eventId = uuidv4();
      const user = userRepository.create({
        id: userId,
        name: 'Event Creator',
        email: 'creator@example.com',
      });
      const savedUser = await userRepository.save(user);

      const event = eventRepository.create({
        id: eventId,
        title: 'Test Event',
        description: 'Test Description',
        status: 'TODO' as any,
        startTime: new Date('2024-01-01T10:00:00Z'),
        endTime: new Date('2024-01-01T12:00:00Z'),
        creator: savedUser,
        invitees: [],
      });
      await eventRepository.save(event);

      const userWithEvents = await userRepository.findOne({
        where: { id: savedUser.id },
        relations: ['events'],
      });

      expect(userWithEvents).toBeDefined();
      expect(userWithEvents!.events).toBeDefined();
      expect(userWithEvents!.events.length).toBe(1);
      expect(userWithEvents!.events[0].title).toBe('Test Event');
    });

    it('should handle one-to-many relationship correctly', async () => {
      const userId = uuidv4();
      const user = userRepository.create({
        id: userId,
        name: 'Multi Event User',
        email: 'multi@example.com',
      });
      const savedUser = await userRepository.save(user);

      for (let i = 1; i <= 3; i++) {
        const event = eventRepository.create({
          id: uuidv4(),
          title: `Event ${i}`,
          description: `Description ${i}`,
          status: 'TODO' as any,
          startTime: new Date(`2024-01-0${i}T10:00:00Z`),
          endTime: new Date(`2024-01-0${i}T12:00:00Z`),
          creator: savedUser,
          invitees: [],
        });
        await eventRepository.save(event);
      }

      const userWithEvents = await userRepository.findOne({
        where: { id: savedUser.id },
        relations: ['events'],
      });

      expect(userWithEvents!.events.length).toBe(3);
    });
  });

  describe('Query Builder', () => {
    it('should use query builder to find users', async () => {
      await userRepository.save(
        userRepository.create({ id: uuidv4(), name: 'Query User 1', email: 'query1@example.com' }),
      );
      await userRepository.save(
        userRepository.create({ id: uuidv4(), name: 'Query User 2', email: 'query2@example.com' }),
      );

      const users = await userRepository
        .createQueryBuilder('user')
        .where('user.email LIKE :pattern', { pattern: '%query%' })
        .getMany();

      expect(users.length).toBe(2);
    });

    it('should use query builder with ordering', async () => {
      await userRepository.save(
        userRepository.create({ id: uuidv4(), name: 'Alpha', email: 'alpha@example.com' }),
      );
      await userRepository.save(
        userRepository.create({ id: uuidv4(), name: 'Beta', email: 'beta@example.com' }),
      );
      await userRepository.save(
        userRepository.create({ id: uuidv4(), name: 'Gamma', email: 'gamma@example.com' }),
      );

      const users = await userRepository
        .createQueryBuilder('user')
        .orderBy('user.name', 'ASC')
        .getMany();

      expect(users.length).toBe(3);
      expect(users[0].name).toBe('Alpha');
      expect(users[1].name).toBe('Beta');
      expect(users[2].name).toBe('Gamma');
    });
  });

  describe('Constraints', () => {
    it('should enforce unique email constraint', async () => {
      await userRepository.save(
        userRepository.create({ id: uuidv4(), name: 'User 1', email: 'unique@example.com' }),
      );

      const duplicateUser = userRepository.create({
        id: uuidv4(),
        name: 'User 2',
        email: 'unique@example.com',
      });

      await expect(userRepository.save(duplicateUser)).rejects.toThrow();
    });
  });
});

