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
