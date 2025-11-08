import { DataSource, Repository } from 'typeorm';
import { createPgMemDataSource } from '../../integration/utils/pgmem-datasource';
import { AuditLog } from '../../../src/audit-log/entities/audit-log.entity';
import { v4 as uuidv4 } from 'uuid';

describe('AuditLog Repository (Database Unit Tests)', () => {
  let dataSource: DataSource;
  let auditLogRepository: Repository<AuditLog>;

  beforeAll(async () => {
    dataSource = await createPgMemDataSource();
    auditLogRepository = dataSource.getRepository(AuditLog);
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await auditLogRepository.query('DELETE FROM audit_logs');
  });

  describe('Basic CRUD Operations', () => {
    it('should create an audit log', async () => {
      const auditLogId = uuidv4();
      const auditLogData = {
        id: auditLogId,
        userId: '00000000-0000-0000-0000-000000000001',
        newEventId: '00000000-0000-0000-0000-000000000002',
        mergedEventIds: ['event-1', 'event-2'],
        notes: 'Test merge operation',
      };

      const auditLog = auditLogRepository.create(auditLogData);
      const savedAuditLog = await auditLogRepository.save(auditLog);

      expect(savedAuditLog).toBeDefined();
      expect(savedAuditLog.id).toBeDefined();
      expect(savedAuditLog.userId).toBe('00000000-0000-0000-0000-000000000001');
      expect(savedAuditLog.newEventId).toBe('00000000-0000-0000-0000-000000000002');
      expect(savedAuditLog.mergedEventIds).toEqual(['event-1', 'event-2']);
      expect(savedAuditLog.notes).toBe('Test merge operation');
      expect(savedAuditLog.createdAt).toBeDefined();
    });

    it('should find an audit log by ID', async () => {
      const auditLogId = uuidv4();
      const auditLog = auditLogRepository.create({
        id: auditLogId,
        userId: '00000000-0000-0000-0000-000000000001',
        newEventId: '00000000-0000-0000-0000-000000000002',
        mergedEventIds: ['event-1'],
        notes: 'Test notes',
      });
      const savedAuditLog = await auditLogRepository.save(auditLog);

      const foundAuditLog = await auditLogRepository.findOne({
        where: { id: savedAuditLog.id },
      });

      expect(foundAuditLog).toBeDefined();
      expect(foundAuditLog!.id).toBe(savedAuditLog.id);
      expect(foundAuditLog!.notes).toBe('Test notes');
    });

    it('should find audit logs by user ID', async () => {
      await auditLogRepository.save(
        auditLogRepository.create({
          id: uuidv4(),
          userId: '00000000-0000-0000-0000-000000000001',
          newEventId: '00000000-0000-0000-0000-000000000010',
          mergedEventIds: ['event-1'],
          notes: 'First merge',
        }),
      );

      await auditLogRepository.save(
        auditLogRepository.create({
          id: uuidv4(),
          userId: '00000000-0000-0000-0000-000000000001',
          newEventId: '00000000-0000-0000-0000-000000000011',
          mergedEventIds: ['event-2'],
          notes: 'Second merge',
        }),
      );

      await auditLogRepository.save(
        auditLogRepository.create({
          id: uuidv4(),
          userId: '00000000-0000-0000-0000-000000000002',
          newEventId: '00000000-0000-0000-0000-000000000012',
          mergedEventIds: ['event-3'],
          notes: 'Other user merge',
        }),
      );

      const userAuditLogs = await auditLogRepository.find({
        where: { userId: '00000000-0000-0000-0000-000000000001' },
      });

      expect(userAuditLogs.length).toBe(2);
      expect(userAuditLogs.every((log) => log.userId === '00000000-0000-0000-0000-000000000001')).toBe(true);
    });

    it('should find audit logs by new event ID', async () => {
      const newEventId = '00000000-0000-0000-0000-000000000020';

      await auditLogRepository.save(
        auditLogRepository.create({
          id: uuidv4(),
          userId: '00000000-0000-0000-0000-000000000001',
          newEventId: newEventId,
          mergedEventIds: ['event-1', 'event-2'],
          notes: 'First merge',
        }),
      );

      await auditLogRepository.save(
        auditLogRepository.create({
          id: uuidv4(),
          userId: '00000000-0000-0000-0000-000000000001',
          newEventId: newEventId,
          mergedEventIds: ['event-3'],
          notes: 'Second merge',
        }),
      );

      const eventAuditLogs = await auditLogRepository.find({
        where: {
          newEventId: newEventId,
        },
        order: {
          createdAt: 'ASC',
        },
      });

      expect(eventAuditLogs.length).toBe(2);
      expect(eventAuditLogs.every((log) => log.newEventId === newEventId)).toBe(true);
    });
  });

  describe('Query Builder', () => {
    it('should use query builder to filter by user ID', async () => {
      await auditLogRepository.save(
        auditLogRepository.create({
          id: uuidv4(),
          userId: '00000000-0000-0000-0000-000000000001',
          newEventId: '00000000-0000-0000-0000-000000000010',
          mergedEventIds: ['event-1'],
          notes: 'First merge',
        }),
      );

      await auditLogRepository.save(
        auditLogRepository.create({
          id: uuidv4(),
          userId: '00000000-0000-0000-0000-000000000002',
          newEventId: '00000000-0000-0000-0000-000000000011',
          mergedEventIds: ['event-2'],
          notes: 'Second merge',
        }),
      );

      const userLogs = await auditLogRepository
        .createQueryBuilder('audit_log')
        .where('audit_log.userId = :userId', { userId: '00000000-0000-0000-0000-000000000001' })
        .getMany();

      expect(userLogs.length).toBe(1);
      expect(userLogs[0].userId).toBe('00000000-0000-0000-0000-000000000001');
    });

    it('should use query builder with date range filtering', async () => {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);

      await auditLogRepository.save(
        auditLogRepository.create({
          id: uuidv4(),
          userId: '00000000-0000-0000-0000-000000000001',
          newEventId: '00000000-0000-0000-0000-000000000010',
          mergedEventIds: ['event-1'],
          notes: 'Old merge',
          createdAt: yesterday,
        }),
      );

      await auditLogRepository.save(
        auditLogRepository.create({
          id: uuidv4(),
          userId: '00000000-0000-0000-0000-000000000001',
          newEventId: '00000000-0000-0000-0000-000000000011',
          mergedEventIds: ['event-2'],
          notes: 'Recent merge',
          createdAt: now,
        }),
      );

      const recentLogs = await auditLogRepository
        .createQueryBuilder('audit_log')
        .where('audit_log.createdAt >= :date', { date: now })
        .getMany();

      expect(recentLogs.length).toBe(1);
    });
  });

  describe('JSONB Columns', () => {
    it('should store and retrieve mergedEventIds JSONB field', async () => {
      const auditLogId = uuidv4();
      const mergedEventIds = ['event-1', 'event-2', 'event-3'];

      const auditLog = auditLogRepository.create({
        id: auditLogId,
        userId: '00000000-0000-0000-0000-000000000001',
        newEventId: '00000000-0000-0000-0000-000000000020',
        mergedEventIds: mergedEventIds,
        notes: 'Merged three events',
      });
      const savedAuditLog = await auditLogRepository.save(auditLog);

      const foundAuditLog = await auditLogRepository.findOne({
        where: { id: savedAuditLog.id },
      });

      expect(foundAuditLog).toBeDefined();
      expect(foundAuditLog!.mergedEventIds).toBeDefined();
      expect(Array.isArray(foundAuditLog!.mergedEventIds)).toBe(true);
      expect(foundAuditLog!.mergedEventIds.length).toBe(3);
      expect(foundAuditLog!.mergedEventIds).toEqual(mergedEventIds);
    });

    it('should handle empty mergedEventIds array', async () => {
      const auditLogId = uuidv4();
      const auditLog = auditLogRepository.create({
        id: auditLogId,
        userId: '00000000-0000-0000-0000-000000000001',
        newEventId: '00000000-0000-0000-0000-000000000020',
        mergedEventIds: [],
        notes: 'No merged events',
      });
      const savedAuditLog = await auditLogRepository.save(auditLog);

      const foundAuditLog = await auditLogRepository.findOne({
        where: { id: savedAuditLog.id },
      });

      expect(foundAuditLog!.mergedEventIds).toEqual([]);
    });
  });

  describe('Timestamps', () => {
    it('should automatically set createdAt timestamp', async () => {
      const auditLogId = uuidv4();
      const beforeCreate = new Date();

      const auditLog = auditLogRepository.create({
        id: auditLogId,
        userId: '00000000-0000-0000-0000-000000000001',
        newEventId: '00000000-0000-0000-0000-000000000020',
        mergedEventIds: ['event-1'],
        notes: 'Test timestamp',
      });
      const savedAuditLog = await auditLogRepository.save(auditLog);

      const afterCreate = new Date();

      expect(savedAuditLog.createdAt).toBeDefined();
      expect(savedAuditLog.createdAt.getTime()).toBeGreaterThanOrEqual(
        beforeCreate.getTime(),
      );
      expect(savedAuditLog.createdAt.getTime()).toBeLessThanOrEqual(
        afterCreate.getTime(),
      );
    });
  });

  describe('Nullable Fields', () => {
    it('should handle null notes', async () => {
      const auditLogId = uuidv4();
      const auditLog = auditLogRepository.create({
        id: auditLogId,
        userId: '00000000-0000-0000-0000-000000000001',
        newEventId: '00000000-0000-0000-0000-000000000020',
        mergedEventIds: ['event-1'],
        notes: null,
      });
      const savedAuditLog = await auditLogRepository.save(auditLog);

      const foundAuditLog = await auditLogRepository.findOne({
        where: { id: savedAuditLog.id },
      });

      expect(foundAuditLog!.notes).toBeNull();
    });
  });
});

