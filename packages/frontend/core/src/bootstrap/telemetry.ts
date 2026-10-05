import { sentry, tracker } from '@nota/track';

tracker.init();
sentry.init();

// No Nota Cloud / telemetry server exists, so there is nowhere to send events.
// Opt out unconditionally to avoid failing /api/telemetry/collect requests at
// launch. (The tracker/sentry APIs stay usable as no-ops.)
sentry.disable();
tracker.opt_out_tracking();
