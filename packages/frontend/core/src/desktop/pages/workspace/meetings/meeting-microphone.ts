const BUILT_IN_MAC_MICROPHONE =
  /(?:macbook|built[- ]?in|internal).*(?:microphone|mic)|(?:microphone|mic).*(?:macbook|built[- ]?in|internal)/i;

export async function ensureMeetingAudioContextRunning(
  context: Pick<AudioContext, 'resume' | 'state'>
) {
  if (context.state !== 'running') await context.resume();
  if (context.state !== 'running') {
    throw new Error(
      'Microphone audio could not start. Try starting the meeting again.'
    );
  }
}

export function preferredMeetingMicrophoneDeviceId(
  devices: Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>[],
  isMacOs: boolean
) {
  if (!isMacOs) {
    return null;
  }

  return (
    devices.find(
      device =>
        device.kind === 'audioinput' &&
        device.deviceId !== 'default' &&
        device.deviceId !== 'communications' &&
        BUILT_IN_MAC_MICROPHONE.test(device.label)
    )?.deviceId ?? null
  );
}

const BLUETOOTH_MICROPHONE =
  /bluetooth|airpods|buds|\bpods\b|headset|hands-?free|jabra|bose|beats|wh-1000|wf-1000/i;

// Bluetooth headsets switch to a narrow-band call profile (8-16 kHz) as soon
// as their microphone is used, which makes speech much harder to transcribe.
export function meetingMicrophoneWarning(
  devices: Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>[]
) {
  const inputs = devices.filter(device => device.kind === 'audioinput');
  const target =
    inputs.find(device => device.deviceId === 'default') ?? inputs[0];
  if (!target?.label || !BLUETOOTH_MICROPHONE.test(target.label)) {
    return null;
  }
  const name = target.label.replace(/^default\s*-\s*/i, '');
  return `Your system microphone is ${name}, which looks like a Bluetooth headset. Bluetooth microphones record at phone quality and lower transcription accuracy. Set the input to the built-in microphone in System Settings > Sound (you can keep the headset for output).`;
}

export async function meetingMicrophoneConstraints(
  mediaDevices: Pick<MediaDevices, 'enumerateDevices'>,
  isMacOs: boolean
): Promise<MediaTrackConstraints> {
  const constraints: MediaTrackConstraints = {
    autoGainControl: false,
    echoCancellation: false,
    noiseSuppression: false,
  };

  try {
    const devices = await mediaDevices.enumerateDevices();
    const deviceId = preferredMeetingMicrophoneDeviceId(devices, isMacOs);
    if (deviceId) {
      constraints.deviceId = { exact: deviceId };
    }
  } catch {
    // Permission checks normally make labels/devices available before this
    // point. If enumeration still fails, the browser default remains usable.
  }

  return constraints;
}
