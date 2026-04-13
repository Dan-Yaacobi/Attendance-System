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

function formatDisplayDate(value) {
  const parsedDate = value ? new Date(value) : new Date();
  if (Number.isNaN(parsedDate.getTime())) {
    return new Date().toLocaleDateString('he-IL');
  }

  return parsedDate.toLocaleDateString('he-IL');
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
  const courseTitle = payload?.course_title || '';
  const courseDate = formatDisplayDate(payload?.session_date);

  return (
    <main className="app-shell">
      <section className="attendance-card">
        {!loading && !errorCode && payload && (
          <section className="qr-display-panel">
            <h1>{courseTitle}</h1>
            <p className="subtitle">{courseDate}</p>
            <img src={toQrImageUrl(signInUrl)} alt="Course sign-in QR code" className="qr-image" />
          </section>
        )}
      </section>
    </main>
  );
}
