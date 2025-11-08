import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { UserService } from '../../../src/user/user.service';
import { User } from '../../../src/user/entities/user.entity';
import { CreateUserDto } from '../../../src/user/dto/create-user.dto';

describe('UserService', () => {
  let service: UserService;
  let userRepository: jest.Mocked<Repository<User>>;

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

  beforeEach(async () => {
    const mockUserRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    userRepository = module.get(getRepositoryToken(User));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    const createUserDto: CreateUserDto = {
      name: 'John Doe',
      email: 'john@example.com',
    };

    it('should create a user successfully with all required fields', async () => {
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);

      const result = await service.create(createUserDto);

      expect(userRepository.create).toHaveBeenCalledWith(createUserDto);
      expect(userRepository.save).toHaveBeenCalledWith(mockUser);
      expect(result).toEqual(mockUser);
      expect(result.name).toBe('John Doe');
      expect(result.email).toBe('john@example.com');
    });

    it('should throw error when creating a user with duplicate email', async () => {
      const duplicateEmail = 'john@example.com';
      const createUserDto: CreateUserDto = {
        name: 'John Duplicate',
        email: duplicateEmail,
      };

      const duplicateUser = {
        ...mockUser,
        name: 'John Duplicate',
      };
      userRepository.create.mockReturnValue(duplicateUser);

      const uniqueConstraintError = new QueryFailedError(
        'INSERT INTO "users"',
        [],
        {
          code: '23505',
          detail: `Key (email)=(${duplicateEmail}) already exists.`,
          message: 'duplicate key value violates unique constraint "UQ_users_email"',
        } as any,
      );
      userRepository.save.mockRejectedValue(uniqueConstraintError);

      await expect(service.create(createUserDto)).rejects.toThrow(
        QueryFailedError,
      );
      expect(userRepository.create).toHaveBeenCalledWith(createUserDto);
      expect(userRepository.save).toHaveBeenCalledWith(duplicateUser);
    });
  });

  describe('findOne', () => {
    it('should return a user by id', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.findOne('user-1');

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        relations: ['events'],
      });
      expect(result).toEqual(mockUser);
    });

    it('should return a user with relations loaded', async () => {
      const userWithEvents: User = {
        ...mockUser,
        events: [],
      };

      userRepository.findOne.mockResolvedValue(userWithEvents);

      const result = await service.findOne('user-1');

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        relations: ['events'],
      });
      expect(result).toEqual(userWithEvents);
      expect(result.events).toBeDefined();
    });

    it('should throw NotFoundException when user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne('non-existent')).rejects.toThrow(
        'User with ID non-existent not found',
      );
    });
  });

  describe('findByEmail', () => {
    it('should return a user by email', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.findByEmail('john@example.com');

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { email: 'john@example.com' },
      });
      expect(result).toEqual(mockUser);
      expect(result?.email).toBe('john@example.com');
    });

    it('should return null when user not found by email', async () => {
      userRepository.findOne.mockResolvedValue(null);

      const result = await service.findByEmail('nonexistent@example.com');

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { email: 'nonexistent@example.com' },
      });
      expect(result).toBeNull();
    });

    it('should handle different email formats', async () => {
      const userWithDifferentEmail: User = {
        ...mockUser2,
        email: 'jane.smith+test@example.co.uk',
      };

      userRepository.findOne.mockResolvedValue(userWithDifferentEmail);

      const result = await service.findByEmail('jane.smith+test@example.co.uk');

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { email: 'jane.smith+test@example.co.uk' },
      });
      expect(result).toEqual(userWithDifferentEmail);
    });
  });

  describe('findAll', () => {
    it('should return all users', async () => {
      const allUsers = [mockUser, mockUser2];
      userRepository.find.mockResolvedValue(allUsers);

      const result = await service.findAll();

      expect(userRepository.find).toHaveBeenCalledWith({
        relations: ['events'],
      });
      expect(result).toEqual(allUsers);
      expect(result.length).toBe(2);
    });

    it('should return empty array when no users exist', async () => {
      userRepository.find.mockResolvedValue([]);

      const result = await service.findAll();

      expect(userRepository.find).toHaveBeenCalledWith({
        relations: ['events'],
      });
      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    it('should return users with relations loaded', async () => {
      const user1WithEvents: User = {
        ...mockUser,
        events: [],
      };
      const user2WithEvents: User = {
        ...mockUser2,
        events: [],
      };
      const allUsers = [user1WithEvents, user2WithEvents];

      userRepository.find.mockResolvedValue(allUsers);

      const result = await service.findAll();

      expect(result).toEqual(allUsers);
      result.forEach((user) => {
        expect(user.events).toBeDefined();
      });
    });

    it('should return multiple users correctly', async () => {
      const user3: User = {
        id: 'user-3',
        name: 'Bob Wilson',
        email: 'bob@example.com',
        events: [],
      };
      const allUsers = [mockUser, mockUser2, user3];

      userRepository.find.mockResolvedValue(allUsers);

      const result = await service.findAll();

      expect(result.length).toBe(3);
      expect(result[0].id).toBe('user-1');
      expect(result[1].id).toBe('user-2');
      expect(result[2].id).toBe('user-3');
    });
  });
});

