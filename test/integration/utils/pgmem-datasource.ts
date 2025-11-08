import { newDb } from 'pg-mem';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Event } from '../../../src/event/entities/event.entity';
import { User } from '../../../src/user/entities/user.entity';
import { AuditLog } from '../../../src/audit-log/entities/audit-log.entity';

export async function createPgMemDataSource(): Promise<DataSource> {
  const db = newDb({ 
    autoCreateForeignKeyIndices: true,
  });

  db.public.registerFunction({
    name: 'version',
    implementation: () => 'PostgreSQL 14.0 (pg-mem)',
  });
  
  db.public.registerFunction({
    name: 'current_database',
    implementation: () => 'test',
  });
  
  db.public.registerFunction({
    name: 'uuid_generate_v4',
    implementation: () => {
      return uuidv4();
    },
  });
  
  db.public.registerFunction({
    name: 'pg_advisory_unlock_all',
    implementation: () => {},
  });

  const pg = db.adapters.createPg();

  const originalPg = require('pg');
  const originalClient = originalPg.Client;
  
  originalPg.Client = pg.Client;
  originalPg.Pool = pg.Pool;

  try {
    const dataSource = new DataSource({
      type: 'postgres',
      entities: [Event, User, AuditLog],
      synchronize: true,
      host: 'localhost',
      port: 5432,
      username: 'test',
      password: 'test',
      database: 'test',
    });

    await dataSource.initialize();
    
    originalPg.Client = originalClient;
    
    return dataSource;
  } catch (error) {
    originalPg.Client = originalClient;
    throw error;
  }
}


