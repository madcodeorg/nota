import { useEffect, useState } from 'react';

const CODE_STORAGE_KEY = 'nota-google-auth-code';
const CODE_STORAGE_TIMEOUT = 30_000;
const LOOPBACK_FLOW_QUERY_PARAM = 'nota_flow';

function createCallbackPayload(params: URLSearchParams) {
  const brokerCode = params.get('broker_code');
  const code = params.get('code');
  const error = params.get('error');
  const brokerFlow = params.get(LOOPBACK_FLOW_QUERY_PARAM);
  const directFlow = params.get('state');
  const flowId =
    brokerFlow && directFlow && brokerFlow !== directFlow
      ? null
      : (brokerFlow ?? directFlow);

  return {
    type: 'google-auth-callback',
    ...(brokerCode ? { brokerCode } : {}),
    ...(code ? { code } : {}),
    ...(error ? { error } : {}),
    ...(flowId ? { flowId } : {}),
  };
}

const GoogleAuthCallbackInner = () => {
  const [status, setStatus] = useState<'processing' | 'done' | 'error'>(
    'processing'
  );
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payload = createCallbackPayload(params);
    const hasAuthResult = Boolean(payload.code || payload.brokerCode);

    if (payload.error) {
      setStatus('error');
      setErrorMsg(payload.error);
      if (window.opener) {
        window.opener.postMessage(payload, '*');
      }
      return;
    }

    if (!hasAuthResult) {
      setStatus('error');
      setErrorMsg('No authorization code received');
      return;
    }

    // If opened as popup, send code to opener
    if (window.opener) {
      try {
        window.opener.postMessage(payload, '*');
      } catch {
        // cross-origin restrictions
      }
      setStatus('done');
      setTimeout(() => {
        try {
          window.close();
        } catch {
          /* ignore */
        }
      }, 300);
      return;
    }

    // Not a popup — save code to localStorage so the main tab can pick it up
    localStorage.setItem(CODE_STORAGE_KEY, JSON.stringify(payload));
    // Remove after timeout to avoid stale codes
    setTimeout(() => {
      localStorage.removeItem(CODE_STORAGE_KEY);
    }, CODE_STORAGE_TIMEOUT);

    setStatus('done');
  }, []);

  if (status === 'error') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 16,
          color: '#c62828',
        }}
      >
        Authentication failed: {errorMsg}
      </div>
    );
  }

  if (status === 'done' && !window.opener) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 16,
          color: '#333',
          gap: 16,
        }}
      >
        <div style={{ fontSize: 24, color: '#34A853' }}>&#10003;</div>
        <div>Google approved Nota.</div>
        <div style={{ fontSize: 13, color: '#666' }}>
          Return to Nota to finish connecting Google Drive and Calendar.
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 16,
        color: '#666',
      }}
    >
      Connecting to Google services...
    </div>
  );
};

export const Component = GoogleAuthCallbackInner;
export { GoogleAuthCallbackInner as GoogleAuthCallback };
