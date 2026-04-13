import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './api';
import './theme.css';

function getSessionIdFromPath() {
  const match = window.location.pathname.match(/^\/qr-display\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : '';
}

function toQrImageUrl(value) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(value)}`;
}

export default function QrDisplayPage() {
  const sessionId = useMemo(() => getSessionIdFromPath(), []);
  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState('');
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    if (!sessionId) {
      setErrorCode('INVALID_QR_SESSION');
      setLoading(false);
      return;
    }

    let isMounted = true;
    let timer;

    const load = async () => {
      try {
        const { ok, data } = await apiRequest(`/attendance/qr-display/${encodeURIComponent(sessionId)}`);
        if (!ok || !data.success) {
          throw new Error(data?.error?.code || 'INVALID_QR_SESSION');
        }

        if (!isMounted) return;

        setPayload(data.data);
        setErrorCode('');
      } catch (error) {
        if (!isMounted) return;
        setErrorCode(error.message || 'INVALID_QR_SESSION');
      } finally {
        if (isMounted) {
          setLoading(false);
          timer = setTimeout(load, 15000);
        }
      }
    };

    load();

    return () => {
      isMounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId]);

  const signInUrl = payload
    ? `${window.location.origin}/?course_id=${encodeURIComponent(payload.course_id)}&token=${encodeURIComponent(payload.token)}`
    : '';

  return (
    <main className="app-shell">
      <section className="attendance-card">
        <header className="card-header">
          <h1>Course QR Sign-In</h1>
          <p className="subtitle">Keep this screen open for participants to scan.</p>
        </header>

        {loading && <p className="status-line">Loading session…</p>}

        {!loading && errorCode && (
          <section className="alert alert-error" role="alert">
            <h2>QR screen unavailable</h2>
            <p>{errorCode === 'QR_SESSION_EXPIRED' ? 'This QR link has expired. Create a new QR link from Admin.' : 'This QR link is invalid.'}</p>
          </section>
        )}

        {!loading && !errorCode && payload && (
          <section className="qr-display-panel">
            <img src={toQrImageUrl(signInUrl)} alt="Course sign-in QR code" className="qr-image" />
            <p className="subtitle">Course ID: {payload.course_id}</p>
            <p className="hint">Token refreshes automatically every few seconds.</p>
            <p className="hint">Session expires: {new Date(payload.session_expires_at).toLocaleString()}</p>
          </section>
        )}
      </section>
    </main>
  );
}
