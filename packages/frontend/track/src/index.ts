import { enableAutoTrack, makeTracker } from './auto';
import { type EventArgs, type Events } from './events';
import {
  flushTelemetry,
  setTelemetryContext,
  setTelemetryTransport,
} from './telemetry';
import { tracker } from './tracker';
export const track = makeTracker((event, props) => {
  tracker.track(event, props);
});

export {
  enableAutoTrack,
  type EventArgs,
  type Events,
  flushTelemetry,
  setTelemetryContext,
  setTelemetryTransport,
  tracker,
};
export default track;
