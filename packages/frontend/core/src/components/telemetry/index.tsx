import { sentry, tracker } from '@nota/track';
import { useEffect } from 'react';

export function Telemetry() {
  useEffect(() => {
    // Nota has no telemetry service. Keep tracking disabled regardless of any
    // enableTelemetry value persisted by older builds.
    sentry.disable();
    tracker.opt_out_tracking();
  }, []);

  return null;
}
