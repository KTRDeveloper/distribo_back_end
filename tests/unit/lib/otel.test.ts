import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockLogger } from '../../helpers/mocks.js';

const doubles = vi.hoisted(() => ({
  start: vi.fn(),
  shutdown: vi.fn(),
  sdk: vi.fn(),
  resourceFromAttributes: vi.fn(),
  instrumentations: vi.fn(),
  config: { otel: { endpoint: '', serviceName: 'maintenance-test' }, isProduction: false },
}));

vi.mock('../../../src/config/index.js', () => ({ config: doubles.config }));
vi.mock('../../../src/lib/logger.js', () => ({ logger: createMockLogger() }));
vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: class {
    constructor(options: unknown) {
      doubles.sdk(options);
    }
    start = doubles.start;
    shutdown = doubles.shutdown;
  },
}));
vi.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: doubles.resourceFromAttributes,
}));
vi.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: doubles.instrumentations,
}));

let terminationListeners: NodeJS.SignalsListener[];

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  doubles.config.otel.endpoint = '';
  doubles.config.isProduction = false;
  doubles.start.mockReset();
  doubles.shutdown.mockReset().mockResolvedValue(undefined);
  doubles.resourceFromAttributes.mockReturnValue({
    attributes: { 'service.name': 'maintenance-test' },
  });
  doubles.instrumentations.mockReturnValue(['fake-instrumentation']);
  terminationListeners = process.listeners('SIGTERM');
});

afterEach(() => {
  // Remove only the listener installed by this module, never other test listeners.
  for (const listener of process.listeners('SIGTERM')) {
    if (!terminationListeners.includes(listener)) process.removeListener('SIGTERM', listener);
  }
});

describe('OpenTelemetry lifecycle', () => {
  it('does not construct or shut down a SDK without an endpoint', async () => {
    const otel = await import('../../../src/lib/otel.js');
    otel.initializeOtel();
    await otel.shutdownOtel();
    expect(doubles.sdk).not.toHaveBeenCalled();
    expect(doubles.start).not.toHaveBeenCalled();
    expect(doubles.shutdown).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'preserves service identity and fs instrumentation (production=%s)',
    async (production) => {
      doubles.config.otel.endpoint = 'http://localhost:3000';
      doubles.config.isProduction = production;
      const otel = await import('../../../src/lib/otel.js');
      otel.initializeOtel();
      expect(doubles.resourceFromAttributes).toHaveBeenCalledExactlyOnceWith({
        'service.name': 'maintenance-test',
      });
      expect(doubles.instrumentations).toHaveBeenCalledExactlyOnceWith({
        '@opentelemetry/instrumentation-fs': { enabled: production },
      });
      expect(doubles.sdk).toHaveBeenCalledExactlyOnceWith({
        resource: { attributes: { 'service.name': 'maintenance-test' } },
        instrumentations: [['fake-instrumentation']],
      });
      expect(doubles.start).toHaveBeenCalledOnce();
      await otel.shutdownOtel();
      expect(doubles.shutdown).toHaveBeenCalledOnce();
    }
  );

  it('shuts down on SIGTERM without emitting a real process signal', async () => {
    doubles.config.otel.endpoint = 'http://localhost:3000';
    const otel = await import('../../../src/lib/otel.js');
    otel.initializeOtel();
    const listener = process
      .listeners('SIGTERM')
      .find((item) => !terminationListeners.includes(item));
    expect(listener).toBeDefined();
    listener?.('SIGTERM');
    await vi.waitFor(() => expect(doubles.shutdown).toHaveBeenCalledOnce());
  });

  it('logs SDK startup failures', async () => {
    doubles.config.otel.endpoint = 'http://localhost:3000';
    const error = new Error('fake startup failure');
    doubles.start.mockImplementation(() => {
      throw error;
    });
    const otel = await import('../../../src/lib/otel.js');
    const { logger } = await import('../../../src/lib/logger.js');
    otel.initializeOtel();
    expect(logger.error).toHaveBeenCalledWith({ error }, 'Failed to initialize OpenTelemetry');
  });

  it('logs SDK shutdown failures', async () => {
    doubles.config.otel.endpoint = 'http://localhost:3000';
    const error = new Error('fake shutdown failure');
    doubles.shutdown.mockRejectedValue(error);
    const otel = await import('../../../src/lib/otel.js');
    const { logger } = await import('../../../src/lib/logger.js');
    otel.initializeOtel();
    await otel.shutdownOtel();
    expect(logger.error).toHaveBeenCalledWith({ error }, 'Failed to shutdown OpenTelemetry');
  });
});
