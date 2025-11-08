import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly client: Redis | null;
  private readonly useRedis: boolean;

  constructor(private readonly configService: ConfigService) {
    this.useRedis = this.configService.get<string>('REDIS_ENABLED', 'true') === 'true';
    
    if (this.useRedis) {
      const redisHost = this.configService.get<string>('REDIS_HOST', 'localhost');
      const redisPort = this.configService.get<number>('REDIS_PORT', 6379);
      const redisPassword = this.configService.get<string>('REDIS_PASSWORD');

      const redisConfig: any = {
        host: redisHost,
        port: redisPort,
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
      };

      if (redisPassword) {
        redisConfig.password = redisPassword;
      }

      this.client = new Redis(redisConfig);

      this.client.on('error', (err) => {
        this.logger.error('Redis Client Error', err);
      });

      this.client.on('connect', () => {
        this.logger.log('Redis Client Connected');
      });

      this.client.on('ready', () => {
        this.logger.log('Redis Client Ready');
      });
    } else {
      this.logger.warn('Redis is disabled, caching will be skipped');
      this.client = null;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.useRedis || !this.client) {
      return null;
    }

    try {
      const value = await this.client.get(key);
      if (!value) {
        return null;
      }
      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.error(`Error getting cache key: ${key}`, error);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (!this.useRedis || !this.client) {
      return;
    }

    try {
      const serialized = JSON.stringify(value);
      await this.client.setex(key, ttlSeconds, serialized);
    } catch (error) {
      this.logger.error(`Error setting cache key: ${key}`, error);
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.useRedis || !this.client) {
      return;
    }

    try {
      await this.client.del(key);
    } catch (error) {
      this.logger.error(`Error deleting cache key: ${key}`, error);
    }
  }

  async clear(): Promise<void> {
    if (!this.useRedis || !this.client) {
      return;
    }

    try {
      await this.client.flushdb();
    } catch (error) {
      this.logger.error('Error clearing cache', error);
    }
  }

  async onModuleDestroy() {
    if (this.client && this.useRedis) {
      await this.client.quit();
      this.logger.log('Redis Client Disconnected');
    }
  }
}
