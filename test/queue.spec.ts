import { Job } from 'bullmq';
import { PrismaService } from '../src/database/prisma.service';
import { jobKey } from '../src/queues/queues.service';
import { ExecutionService } from '../src/queues/execution.service';
import { TelegramWorker } from '../src/telegram/telegram.worker';
import { TelegramService } from '../src/telegram/telegram.service';
describe('queue foundation', () => {
  it('uses stable queue-specific IDs without BullMQ-reserved colons', () => {
    expect(jobKey('q', 'op', '2026:09')).toBe(jobKey('q', 'op', '2026:09'));
    expect(jobKey('q', 'op', '2026:09')).not.toContain(':');
    expect(jobKey('q', 'op', 'x')).not.toBe(jobKey('other', 'op', 'x'));
  });
  it('skips durably completed work even if a job is replayed', async () => {
    const db = { automationRun: { findUnique: jest.fn().mockResolvedValue({ status: 'COMPLETED' }) } };
    const action = jest.fn();
    await new ExecutionService(db as unknown as PrismaService).execute('q', 'SYSTEM', { id: '1' } as Job, action);
    expect(action).not.toHaveBeenCalled();
  });
  it('validates queue data before delivering', async () => {
    const telegram = { deliver: jest.fn() };
    const executions = { execute: jest.fn((_q, _a, _j, operation: () => Promise<void>) => operation()) };
    const worker = new TelegramWorker(telegram as unknown as TelegramService, executions as unknown as ExecutionService);
    await expect(worker.process({ name: 'send', data: { chatId: 'attacker' } } as Job)).rejects.toThrow();
    expect(telegram.deliver).not.toHaveBeenCalled();
    await worker.process({ name: 'send', data: { notificationId: 'n' } } as Job);
    expect(telegram.deliver).toHaveBeenCalledWith('n');
  });
});
