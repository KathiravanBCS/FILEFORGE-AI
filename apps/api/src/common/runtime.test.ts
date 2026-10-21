import { describe, expect, it } from 'vitest';
import { apiRuntime } from './runtime.js';

describe('API hosting runtime', () => {
  it('uses the platform-injected PORT ahead of the local development API_PORT', () => {
    expect(apiRuntime({ VERCEL: '1', PORT: '8080', API_PORT: '4000' })).toEqual({
      port: 8080,
      handleProcessSignals: false,
    });
  });
  it('retains the configured local port and process shutdown lifecycle outside functions', () => {
    expect(apiRuntime({ API_PORT: '4001' })).toEqual({ port: 4001, handleProcessSignals: true });
    expect(apiRuntime({}).port).toBe(4000);
  });
  it.each(['not-a-port', '0', '65536'])(
    'fails early on an invalid injected platform port %s',
    (PORT) => {
      expect(() => apiRuntime({ PORT, API_PORT: '4000' })).toThrow();
    },
  );
});
