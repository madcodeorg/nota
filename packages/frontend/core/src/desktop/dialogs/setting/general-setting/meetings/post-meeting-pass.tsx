import { notify, Switch, useConfirmModal } from '@nota/component';
import { SettingRow } from '@nota/component/setting-components';
import { useCallback, useEffect, useRef, useState } from 'react';

// The accurate model that re-transcribes a meeting once it ends. The backend
// only runs this pass when the user opted in AND this model is downloaded.
const POST_MEETING_PASS_MODEL_ID = 'whisper-large-v3-turbo-q5-cpp';
const PROMPT_COUNT_KEY = 'nota:post-meeting-pass-prompts';
const MAX_PROMPTS = 3;

type PostMeetingPassState = {
  enabled: boolean;
  downloadStatus?: string;
  progress?: number;
  sizeMb?: number;
};

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok && response.status !== 409) {
    throw new Error(
      data?.error ?? `AI backend returned HTTP ${response.status}`
    );
  }
}

async function fetchPostMeetingPassState(): Promise<PostMeetingPassState> {
  const response = await fetch('/api/ai/settings');
  if (!response.ok) {
    throw new Error(`AI backend returned HTTP ${response.status}`);
  }
  const data = (await response.json()) as {
    meetings?: {
      localModels?: Array<{
        downloadStatus?: string;
        id: string;
        progress?: number;
        sizeMb: number;
      }>;
      postPassEnabled?: boolean;
    };
  };
  const model = data.meetings?.localModels?.find(
    item => item.id === POST_MEETING_PASS_MODEL_ID
  );
  return {
    enabled: data.meetings?.postPassEnabled === true,
    downloadStatus: model?.downloadStatus,
    progress: model?.progress,
    sizeMb: model?.sizeMb,
  };
}

async function enablePostMeetingPass() {
  const state = await fetchPostMeetingPassState();
  await postJson('/api/ai/settings', { meetingPostPassEnabled: true });
  if (state.downloadStatus !== 'downloaded') {
    await postJson(
      `/v1/stt/models/${encodeURIComponent(POST_MEETING_PASS_MODEL_ID)}/download`,
      {}
    );
  }
}

function describeModel(state: PostMeetingPassState | null) {
  const size = state?.sizeMb
    ? `${Math.round(state.sizeMb)} MB`
    : 'about 550 MB';
  return `Whisper Large v3 Turbo (${size} one-time download)`;
}

function postMeetingPassStatus(state: PostMeetingPassState | null) {
  if (!state?.enabled) return 'Off';
  if (state.downloadStatus === 'downloaded') return 'On';
  if (
    state.downloadStatus === 'downloading' ||
    state.downloadStatus === 'queued'
  )
    return typeof state.progress === 'number'
      ? `Downloading model ${Math.round(state.progress * 100)}%`
      : 'Downloading model';
  return 'On once the model is downloaded';
}

export function usePostMeetingPass() {
  const [state, setState] = useState<PostMeetingPassState | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState(await fetchPostMeetingPassState());
    } catch (error) {
      console.warn(
        'Failed to load the after-meeting transcript setting',
        error
      );
    }
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  const downloading =
    state?.downloadStatus === 'downloading' ||
    state?.downloadStatus === 'queued';
  useEffect(() => {
    if (!downloading) return;
    const timer = window.setInterval(() => {
      refresh().catch(console.error);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [downloading, refresh]);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      setBusy(true);
      try {
        if (enabled) await enablePostMeetingPass();
        else
          await postJson('/api/ai/settings', { meetingPostPassEnabled: false });
        await refresh();
      } catch (error) {
        notify.error({
          title: 'The after-meeting transcript setting could not be saved',
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  return { busy, refresh, setEnabled, state };
}

export const PostMeetingPassRow = () => {
  const { busy, setEnabled, state } = usePostMeetingPass();
  return (
    <SettingRow
      name="Improve transcripts after meetings"
      desc={`After you stop, re-transcribe the meeting on this device with ${describeModel(state)}. It fixes names and missed words but takes a few minutes. ${postMeetingPassStatus(state)}.`}
    >
      <Switch
        aria-label="Improve transcripts after meetings"
        checked={state?.enabled === true}
        disabled={busy || state === null}
        onChange={checked => {
          setEnabled(checked).catch(console.error);
        }}
      />
    </SettingRow>
  );
};

// Offers the after-meeting pass once a meeting has ended, for the first few
// meetings only, and only when the user has not already turned it on.
export function usePostMeetingPassPrompt(meetingStopped: boolean) {
  const { openConfirmModal } = useConfirmModal();
  const wasStopped = useRef(false);

  useEffect(() => {
    const justStopped = meetingStopped && !wasStopped.current;
    wasStopped.current = meetingStopped;
    if (!justStopped) return;
    let shown = 0;
    try {
      shown = Number(localStorage.getItem(PROMPT_COUNT_KEY) ?? 0) || 0;
    } catch {
      return;
    }
    if (shown >= MAX_PROMPTS) return;
    fetchPostMeetingPassState()
      .then(state => {
        if (state.enabled) return;
        try {
          localStorage.setItem(PROMPT_COUNT_KEY, String(shown + 1));
        } catch {
          return;
        }
        openConfirmModal({
          title: 'Improve this transcript after meetings?',
          children: `Nota can re-transcribe each meeting on your device with ${describeModel(state)} once you stop. It takes a few minutes, fixes names and missed words, and nothing leaves your computer. You can change this later in Settings > Meetings.`,
          confirmText: 'Turn on',
          cancelText: 'Not now',
          onConfirm: async () => {
            try {
              await enablePostMeetingPass();
              notify.success({
                title: 'Transcripts will be improved after meetings',
              });
            } catch (error) {
              notify.error({
                title:
                  'The after-meeting transcript setting could not be saved',
                message: error instanceof Error ? error.message : String(error),
              });
            }
          },
        });
      })
      .catch(error => {
        console.warn(
          'Failed to check the after-meeting transcript setting',
          error
        );
      });
  }, [meetingStopped, openConfirmModal]);
}
