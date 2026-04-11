import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './api';
import './theme.css';

function getDeviceKey(courseId) {
  return `device_uuid_${courseId}`;
}

function getStoredDeviceUuid(courseId) {
  return localStorage.getItem(getDeviceKey(courseId));
}

function setStoredDeviceUuid(courseId, uuid) {
  localStorage.setItem(getDeviceKey(courseId), uuid);
}

function clearStoredDeviceUuid(courseId) {
  localStorage.removeItem(getDeviceKey(courseId));
}

const FRIENDLY_ERROR_MESSAGES = {
  INVALID_QR: 'The QR code is missing course information. Please scan a valid course QR code.',
  COURSE_NOT_FOUND: 'We could not find this course. Please verify you scanned the correct QR code.',
  NO_SESSION_TODAY: 'There is no active session for this course today.',
  INVALID_DEVICE_UUID: 'This device is no longer recognized for this course. Please sign in again.',
  NOT_ALLOWED: 'Your details are not eligible for this course. Please check your phone/email or contact support.',
  NOT_ASSIGNED_TO_COURSE:
    'You are not assigned to this course yet. Please contact your course coordinator.',
  VALIDATION_ERROR: 'Some details are missing or invalid. Please review your inputs and try again.',
  SIGN_IN_FAILED: 'Could not complete sign-in right now. Please try again in a moment.',
  MARK_BY_DEVICE_FAILED: 'Could not verify this device right now. Please try signing in again.',
  DEVICE_UUID_MISSING: 'Sign-in succeeded, but the device verification token was missing. Please try again.',
  UNKNOWN_ERROR: 'Something unexpected happened. Please try again.',
};

function getFriendlyErrorMessage(code) {
  if (!code) {
    return FRIENDLY_ERROR_MESSAGES.UNKNOWN_ERROR;
  }

  return FRIENDLY_ERROR_MESSAGES[code] || 'An unexpected error occurred. Please try again or contact support.';
}

function App() {
  const courseId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('course_id');
  }, []);

  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState('');
  const [course, setCourse] = useState(null);
  const [session, setSession] = useState(null);
  const [deviceUuid, setDeviceUuid] = useState('');
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState({
    phone: '',
    email: '',
  });
  const [alreadyMarked, setAlreadyMarked] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const setIfMounted = (setter, value) => {
      if (isMounted) {
        setter(value);
      }
    };

    const init = async () => {
      if (!courseId) {
        setIfMounted(setErrorCode, 'INVALID_QR');
        setIfMounted(setLoading, false);
        return;
      }

      setIfMounted(setLoading, true);
      setIfMounted(setErrorCode, '');

      try {
        const { ok, data } = await apiRequest('/attendance/entry', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ course_id: courseId }),
        });

        if (!ok || !data.success) {
          throw new Error(data?.error?.code || 'UNKNOWN_ERROR');
        }

        setCourse(data?.data?.course || null);
        setSession(data?.data?.session || null);

        const storedDeviceUuid = getStoredDeviceUuid(courseId);
        if (!storedDeviceUuid) {
          setIfMounted(setNeedsSignIn, true);
          return;
        }

        setIfMounted(setDeviceUuid, storedDeviceUuid);

        const markResponse = await apiRequest('/attendance/mark-by-device', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            course_id: courseId,
            device_uuid: storedDeviceUuid,
          }),
        });

        if (!markResponse.ok || !markResponse.data?.success) {
          if (markResponse.data?.error?.code === 'INVALID_DEVICE_UUID') {
            clearStoredDeviceUuid(courseId);
            setIfMounted(setDeviceUuid, '');
            setIfMounted(setNeedsSignIn, true);
            return;
          }

          throw new Error(markResponse.data?.error?.code || 'MARK_BY_DEVICE_FAILED');
        }

        const markData = markResponse.data?.data;
        if (markData?.already_marked) {
          setIfMounted(setAlreadyMarked, true);
        }

        setIfMounted(setSuccess, true);
      } catch (err) {
        if (err?.message === 'ALREADY_MARKED') {
          setIfMounted(setAlreadyMarked, true);
          setIfMounted(setSuccess, true);
          return;
        }

        setIfMounted(setErrorCode, err?.message || 'UNKNOWN_ERROR');
      } finally {
        setIfMounted(setLoading, false);
      }
    };

    init();

    return () => {
      isMounted = false;
    };
  }, [courseId]);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSignIn = async (event) => {
    event.preventDefault();

    if (!courseId) {
      setErrorCode('INVALID_QR');
      return;
    }

    setLoading(true);
    setErrorCode('');

    try {
      const { ok, data } = await apiRequest('/attendance/sign-in', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          course_id: courseId,
          phone: form.phone,
          email: form.email,
        }),
      });

      if (!ok || !data.success) {
        throw new Error(data?.error?.code || 'SIGN_IN_FAILED');
      }

      const signInData = data?.data;

      if (!signInData?.device_uuid) {
        throw new Error('DEVICE_UUID_MISSING');
      }

      setStoredDeviceUuid(courseId, signInData.device_uuid);
      setDeviceUuid(signInData.device_uuid);
      setAlreadyMarked(Boolean(signInData.already_marked));
      setSuccess(true);
      setNeedsSignIn(false);
    } catch (err) {
      setErrorCode(err?.message || 'SIGN_IN_FAILED');
    } finally {
      setLoading(false);
    }
  };

  const sessionDate = session?.date || session?.session_date || session?.start_time || 'N/A';
  const courseTitle = course?.title || course?.name || course?.course_title || 'Course';
  const errorMessage = errorCode ? getFriendlyErrorMessage(errorCode) : '';

  return (
    <main className="app-shell">
      <section className="attendance-card">
        <header className="card-header">
          <p className="kicker">Lahav-style Course Portal</p>
          <h1>Attendance Check-In</h1>
          <p className="subtitle">Secure QR attendance for today&apos;s session.</p>
        </header>

        {loading && <p className="status-line">Loading your session details…</p>}

        {!loading && errorMessage && (
          <div className="alert alert-error" role="alert" aria-live="polite">
            <h2>We couldn&apos;t complete your check-in</h2>
            <p>{errorMessage}</p>
            <p className="error-code">Reference: {errorCode}</p>
          </div>
        )}

        {!loading && success && (
          <section className="alert alert-success">
            <h2>{alreadyMarked ? 'Attendance Already Recorded' : 'Attendance Confirmed'}</h2>
            <p>
              <strong>Course:</strong> {courseTitle}
            </p>
            <p>
              <strong>Session Date:</strong> {sessionDate}
            </p>
            <p>
              {alreadyMarked
                ? 'You already checked in for this session. No additional action is needed.'
                : 'Your attendance has been successfully recorded. Have a great session.'}
            </p>
            {deviceUuid && <p className="hint">This device is recognized for your next scan.</p>}
          </section>
        )}

        {!loading && !success && needsSignIn && (
          <section>
            <h2>Confirm your details</h2>
            <p className="subtitle">Enter your phone and email to verify your enrollment and record attendance.</p>

            <form onSubmit={handleSignIn} className="sign-in-form">
              <div>
                <label htmlFor="phone">Phone</label>
                <input
                  id="phone"
                  name="phone"
                  value={form.phone}
                  onChange={handleInputChange}
                  required
                  autoComplete="tel"
                  placeholder="e.g. 0501234567"
                />
              </div>

              <div>
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleInputChange}
                  required
                  autoComplete="email"
                  placeholder="name@example.com"
                />
              </div>

              <button type="submit" disabled={loading}>
                Verify & Mark Attendance
              </button>
            </form>
          </section>
        )}

        {!loading && !success && !needsSignIn && !errorMessage && (
          <p className="status-line">Preparing attendance flow…</p>
        )}
      </section>
    </main>
  );
}

export default App;
