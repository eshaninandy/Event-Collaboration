import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../../src/ai/cache.service';
import Redis from 'ioredis';

jest.mock('ioredis');

describe('CacheService', () => {
  let service: CacheService;
  let mockRedisClient: jest.Mocked<Redis>;

  beforeEach(async () => {
    mockRedisClient = {
      get: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
      flushdb: jest.fn(),
      quit: jest.fn(),
      on: jest.fn(),
    } as any;

    (Redis as jest.MockedClass<typeof Redis>).mockImplementation(() => mockRedisClient);

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'REDIS_ENABLED') return 'true';
        if (key === 'REDIS_HOST') return defaultValue || 'localhost';
        if (key === 'REDIS_PORT') return defaultValue || 6379;
        if (key === 'REDIS_PASSWORD') return defaultValue;
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<CacheService>(CacheService);
    
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    if (service && typeof service.clear === 'function') {
      await service.clear();
    }
    jest.clearAllMocks();
  });

  describe('get', () => {
    it('should return null for non-existent key', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      const result = await service.get('non-existent-key');
      expect(result).toBeNull();
      expect(mockRedisClient.get).toHaveBeenCalledWith('non-existent-key');
    });

    it('should return cached value when key exists', async () => {
      const key = 'test-key';
      const value = 'test-value';
      
      mockRedisClient.setex.mockResolvedValue('OK');
      mockRedisClient.get.mockResolvedValue(JSON.stringify(value));
      
      await service.set(key, value, 3600);
      const result = await service.get<string>(key);

      expect(result).toBe(value);
      expect(mockRedisClient.setex).toHaveBeenCalledWith(key, 3600, JSON.stringify(value));
      expect(mockRedisClient.get).toHaveBeenCalledWith(key);
    });

    it('should return null for expired entry', async () => {
      const key = 'expired-key';
      const value = 'test-value';

      mockRedisClient.setex.mockResolvedValue('OK');
      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(value))
        .mockResolvedValueOnce(null);

      await service.set(key, value, 1);
      const firstResult = await service.get<string>(key);
      expect(firstResult).toBe(value);

      mockRedisClient.get.mockResolvedValue(null);
      const result = await service.get<string>(key);
      expect(result).toBeNull();
    });

    it('should handle different value types', async () => {
      const stringKey = 'string-key';
      const numberKey = 'number-key';
      const objectKey = 'object-key';
      const arrayKey = 'array-key';

      mockRedisClient.setex.mockResolvedValue('OK');
      mockRedisClient.get
        .mockResolvedValueOnce(JSON.stringify('string-value'))
        .mockResolvedValueOnce(JSON.stringify(123))
        .mockResolvedValueOnce(JSON.stringify({ name: 'test' }))
        .mockResolvedValueOnce(JSON.stringify([1, 2, 3]));

      await service.set(stringKey, 'string-value', 3600);
      await service.set(numberKey, 123, 3600);
      await service.set(objectKey, { name: 'test' }, 3600);
      await service.set(arrayKey, [1, 2, 3], 3600);

      expect(await service.get<string>(stringKey)).toBe('string-value');
      expect(await service.get<number>(numberKey)).toBe(123);
      expect(await service.get<{ name: string }>(objectKey)).toEqual({ name: 'test' });
      expect(await service.get<number[]>(arrayKey)).toEqual([1, 2, 3]);
    });
  });

  describe('set', () => {
    it('should store value with TTL', async () => {
      const key = 'test-key';
      const value = 'test-value';

      mockRedisClient.setex.mockResolvedValue('OK');
      mockRedisClient.get.mockResolvedValue(JSON.stringify(value));

      await service.set(key, value, 3600);
      const result = await service.get<string>(key);

      expect(result).toBe(value);
      expect(mockRedisClient.setex).toHaveBeenCalledWith(key, 3600, JSON.stringify(value));
    });

    it('should overwrite existing value', async () => {
      const key = 'test-key';

      mockRedisClient.setex.mockResolvedValue('OK');
      mockRedisClient.get.mockResolvedValue(JSON.stringify('new-value'));

      await service.set(key, 'old-value', 3600);
      await service.set(key, 'new-value', 3600);

      const result = await service.get<string>(key);
      expect(result).toBe('new-value');
      expect(mockRedisClient.setex).toHaveBeenCalledTimes(2);
    });

    it('should handle zero TTL', async () => {
      const key = 'zero-ttl-key';
      const value = 'test-value';

      mockRedisClient.setex.mockResolvedValue('OK');
      mockRedisClient.get.mockResolvedValue(null);

      await service.set(key, value, 0);
      
      const result = await service.get<string>(key);
      expect(result).toBeNull();
      expect(mockRedisClient.setex).toHaveBeenCalledWith(key, 0, JSON.stringify(value));
    });

    it('should handle very long TTL', async () => {
      const key = 'long-ttl-key';
      const value = 'test-value';

      mockRedisClient.setex.mockResolvedValue('OK');
      mockRedisClient.get.mockResolvedValue(JSON.stringify(value));

      await service.set(key, value, 86400 * 365); // 1 year

      const result = await service.get<string>(key);
      expect(result).toBe(value);
      expect(mockRedisClient.setex).toHaveBeenCalledWith(key, 86400 * 365, JSON.stringify(value));
    });
  });

  describe('delete', () => {
    it('should delete existing key', async () => {
      const key = 'delete-key';
      const value = 'test-value';

      mockRedisClient.setex.mockResolvedValue('OK');
      mockRedisClient.del.mockResolvedValue(1);
      mockRedisClient.get.mockResolvedValue(null);

      await service.set(key, value, 3600);
      await service.delete(key);

      const result = await service.get<string>(key);
      expect(result).toBeNull();
      expect(mockRedisClient.del).toHaveBeenCalledWith(key);
    });

    it('should not throw error when deleting non-existent key', async () => {
      mockRedisClient.del.mockResolvedValue(0);
      await expect(service.delete('non-existent-key')).resolves.not.toThrow();
      expect(mockRedisClient.del).toHaveBeenCalledWith('non-existent-key');
    });
  });

  describe('clear', () => {
    it('should clear all cache entries', async () => {
      mockRedisClient.setex.mockResolvedValue('OK');
      mockRedisClient.flushdb.mockResolvedValue('OK');
      mockRedisClient.get.mockResolvedValue(null);

      await service.set('key1', 'value1', 3600);
      await service.set('key2', 'value2', 3600);
      await service.set('key3', 'value3', 3600);

      await service.clear();

      expect(await service.get('key1')).toBeNull();
      expect(await service.get('key2')).toBeNull();
      expect(await service.get('key3')).toBeNull();
      expect(mockRedisClient.flushdb).toHaveBeenCalled();
    });

    it('should handle clear on empty cache', async () => {
      mockRedisClient.flushdb.mockResolvedValue('OK');
      await expect(service.clear()).resolves.not.toThrow();
      expect(mockRedisClient.flushdb).toHaveBeenCalled();
    });
  });

  describe('Expiration', () => {
    it('should respect TTL expiration', async () => {
      const key = 'ttl-test';
      const value = 'test-value';

      mockRedisClient.setex.mockResolvedValue('OK');
      mockRedisClient.get
        .mockResolvedValueOnce(JSON.stringify(value))
        .mockResolvedValueOnce(null);

      await service.set(key, value, 2);

      expect(await service.get<string>(key)).toBe(value);

      mockRedisClient.get.mockResolvedValue(null);
      expect(await service.get<string>(key)).toBeNull();
    });

    it('should handle multiple entries with different TTLs', async () => {
      mockRedisClient.setex.mockResolvedValue('OK');
      mockRedisClient.get
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(JSON.stringify('long'));

      await service.set('short-ttl', 'short', 1);
      await service.set('long-ttl', 'long', 10);

      expect(await service.get('short-ttl')).toBeNull();
      expect(await service.get('long-ttl')).toBe('long');
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent set operations', async () => {
      mockRedisClient.setex.mockResolvedValue('OK');
      mockRedisClient.get.mockImplementation((key: string) => {
        const match = key.match(/key-(\d+)/);
        if (match) {
          return Promise.resolve(JSON.stringify(`value-${match[1]}`));
        }
        return Promise.resolve(null);
      });

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(service.set(`key-${i}`, `value-${i}`, 3600));
      }

      await Promise.all(promises);

      for (let i = 0; i < 10; i++) {
        expect(await service.get(`key-${i}`)).toBe(`value-${i}`);
      }
      expect(mockRedisClient.setex).toHaveBeenCalledTimes(10);
    });

    it('should handle concurrent get operations', async () => {
      mockRedisClient.setex.mockResolvedValue('OK');
      mockRedisClient.get.mockResolvedValue(JSON.stringify('concurrent-value'));

      await service.set('concurrent-key', 'concurrent-value', 3600);

      const promises = Array(10).fill(null).map(() => 
        service.get<string>('concurrent-key')
      );

      const results = await Promise.all(promises);
      results.forEach((result) => {
        expect(result).toBe('concurrent-value');
      });
      expect(mockRedisClient.get).toHaveBeenCalledTimes(10);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string key', async () => {
      mockRedisClient.setex.mockResolvedValue('OK');
      mockRedisClient.get.mockResolvedValue(JSON.stringify('empty-key-value'));

      await service.set('', 'empty-key-value', 3600);
      expect(await service.get('')).toBe('empty-key-value');
      expect(mockRedisClient.setex).toHaveBeenCalledWith('', 3600, JSON.stringify('empty-key-value'));
    });

    it('should handle very long key', async () => {
      const longKey = 'a'.repeat(1000);
      mockRedisClient.setex.mockResolvedValue('OK');
      mockRedisClient.get.mockResolvedValue(JSON.stringify('long-key-value'));

      await service.set(longKey, 'long-key-value', 3600);
      expect(await service.get(longKey)).toBe('long-key-value');
      expect(mockRedisClient.setex).toHaveBeenCalledWith(longKey, 3600, JSON.stringify('long-key-value'));
    });

    it('should handle null value', async () => {
      mockRedisClient.setex.mockResolvedValue('OK');
      mockRedisClient.get.mockResolvedValue(JSON.stringify(null));

      await service.set('null-key', null, 3600);
      const result = await service.get('null-key');
      expect(result).toBeNull();
      expect(mockRedisClient.setex).toHaveBeenCalledWith('null-key', 3600, JSON.stringify(null));
    });

    it('should handle undefined value', async () => {
      mockRedisClient.setex.mockResolvedValue('OK');
      mockRedisClient.get.mockResolvedValue(JSON.stringify(null));

      await service.set('undefined-key', undefined, 3600);
      const result = await service.get('undefined-key');
      expect(result).toBeNull();
      expect(mockRedisClient.setex).toHaveBeenCalled();
    });
  });
});

