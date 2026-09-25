import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { Settings } from '../src/common/config/settings.service';
import { UsageService } from '../src/usage/usage.service';
import { AIService } from '../src/ai/ai.service';
const mockParse = jest.fn();
jest.mock('openai', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({ responses: { parse: mockParse } })) }));
describe('shared AI service', () => {
  function setup(enabled = true) {
    const settings = new Settings(new ConfigService({ OPENAI_ENABLED: enabled, OPENAI_API_KEY: 'test', HTTP_TIMEOUT_MS: 1000,
      OPENAI_MODEL_SMALL: 'test-model', OPENAI_MODEL_PRICES: { 'test-model': { input: 1, output: 2 } }, OPENAI_MAX_OUTPUT_TOKENS: 1000 }));
    const usage = { completed: jest.fn().mockResolvedValue(null), reserve: jest.fn().mockResolvedValue('r'), settle: jest.fn(), uncertain: jest.fn() };
    return { usage, service: new AIService(settings, usage as unknown as UsageService) };
  }
  const request = { agent: 'RESEARCH' as const, job: 'extract', requestKey: 'unique' };
  it('reserves budget before using structured outputs and records tokens', async () => {
    mockParse.mockResolvedValue({ status: 'completed', output_parsed: { value: 'ok' }, usage: { input_tokens: 10, output_tokens: 20 } });
    const { service, usage } = setup();
    await expect(service.extractStructuredData(request, 'Extract', { content: 'untrusted' }, z.object({ value: z.string() }))).resolves.toEqual({ value: 'ok' });
    expect(usage.reserve.mock.invocationCallOrder[0]).toBeLessThan(mockParse.mock.invocationCallOrder[0]);
    expect(mockParse.mock.calls[0][0]).toMatchObject({ store: false, max_output_tokens: 1000 });
    expect(usage.settle).toHaveBeenCalledWith('r', 10, 20, 0.00005, { value: 'ok' });
  });
  it('does not call OpenAI when budget fails', async () => {
    const { service, usage } = setup(); usage.reserve.mockRejectedValue(new Error('budget'));
    await expect(service.classifyResearch(request, {})).rejects.toThrow('budget');
    expect(mockParse).not.toHaveBeenCalled();
  });
  it('keeps reservation after uncertain API failure', async () => {
    mockParse.mockRejectedValue(new Error('timeout'));
    const { service, usage } = setup();
    await expect(service.classifyResearch(request, {})).rejects.toThrow('AI request failed');
    expect(usage.uncertain).toHaveBeenCalledWith('r');
  });
  it('fails explicitly when disabled', async () => {
    await expect(setup(false).service.classifyResearch(request, {})).rejects.toThrow('disabled');
    expect(mockParse).not.toHaveBeenCalled();
  });
  it('reuses settled output when a downstream write is retried', async () => {
    const { service, usage } = setup(); usage.completed.mockResolvedValue({ value: 'cached' });
    await expect(service.extractStructuredData(request, 'Extract', {}, z.object({ value: z.string() }))).resolves.toEqual({ value: 'cached' });
    expect(mockParse).not.toHaveBeenCalled(); expect(usage.reserve).not.toHaveBeenCalled();
  });
});
