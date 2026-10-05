/**
 * @vitest-environment happy-dom
 */
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const trackMocks = vi.hoisted(() => ({
  disable: vi.fn(),
  enable: vi.fn(),
  enableAutoTrack: vi.fn(),
  optIn: vi.fn(),
  optOut: vi.fn(),
}));

vi.mock('@nota/track', () => ({
  enableAutoTrack: trackMocks.enableAutoTrack,
  sentry: {
    disable: trackMocks.disable,
    enable: trackMocks.enable,
  },
  tracker: {
    opt_in_tracking: trackMocks.optIn,
    opt_out_tracking: trackMocks.optOut,
  },
}));

import { Telemetry } from './index';

describe('Telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('keeps cloud tracking disabled', async () => {
    render(<Telemetry />);

    await waitFor(() => {
      expect(trackMocks.disable).toHaveBeenCalledOnce();
      expect(trackMocks.optOut).toHaveBeenCalledOnce();
    });
    expect(trackMocks.enable).not.toHaveBeenCalled();
    expect(trackMocks.optIn).not.toHaveBeenCalled();
    expect(trackMocks.enableAutoTrack).not.toHaveBeenCalled();
  });
});
