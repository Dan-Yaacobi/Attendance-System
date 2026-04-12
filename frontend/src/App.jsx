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
  INVALID_QR: 'קוד ה-QR לא כולל פרטי קורס. נא לסרוק קוד תקין של הקורס.',
  COURSE_NOT_FOUND: 'לא הצלחנו למצוא את הקורס הזה. נא לוודא שסרקת את הקוד הנכון.',
  NO_SESSION_TODAY: 'אין מפגש פעיל לקורס זה היום.',
  INVALID_DEVICE_UUID: 'המכשיר הזה כבר לא מזוהה עבור הקורס. נא להתחבר מחדש.',
  NOT_ALLOWED: 'הפרטים שהוזנו אינם מתאימים לקורס זה. נא לבדוק טלפון/אימייל או לפנות לתמיכה.',
  NOT_ASSIGNED_TO_COURSE:
    'עדיין לא שובצת לקורס זה. נא לפנות לרכז/ת הקורס.',
  VALIDATION_ERROR: 'חלק מהפרטים חסרים או לא תקינים. נא לבדוק את הנתונים ולנסות שוב.',
  SIGN_IN_FAILED: 'לא הצלחנו להשלים התחברות כרגע. נא לנסות שוב בעוד רגע.',
  MARK_BY_DEVICE_FAILED: 'לא הצלחנו לאמת את המכשיר כרגע. נא לנסות להתחבר מחדש.',
  DEVICE_UUID_MISSING: 'ההתחברות הצליחה, אך חסר מזהה מכשיר לאימות. נא לנסות שוב.',
  UNKNOWN_ERROR: 'אירעה תקלה לא צפויה. נא לנסות שוב.',
};

function getFriendlyErrorMessage(code) {
  if (!code) {
    return FRIENDLY_ERROR_MESSAGES.UNKNOWN_ERROR;
  }

  return FRIENDLY_ERROR_MESSAGES[code] || 'אירעה שגיאה לא צפויה. נא לנסות שוב או לפנות לתמיכה.';
}

function tryFixMojibake(value) {
  if (typeof value !== 'string') {
    return value;
  }

  if (!value.includes('×')) {
    return value;
  }

  try {
    return decodeURIComponent(escape(value));
  } catch {
    return value;
  }
}

function formatSessionDate(rawDate) {
  if (!rawDate) {
    return 'לא זמין';
  }

  const parsedDate = new Date(rawDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return String(rawDate);
  }

  const day = String(parsedDate.getUTCDate()).padStart(2, '0');
  const month = String(parsedDate.getUTCMonth() + 1).padStart(2, '0');
  const year = parsedDate.getUTCFullYear();
  return `${day}-${month}-${year}`;
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
  const [participantFirstName, setParticipantFirstName] = useState('');

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
        const storedFirstName = localStorage.getItem(`participant_first_name_${courseId}`) || '';
        if (storedFirstName) {
          setIfMounted(setParticipantFirstName, storedFirstName);
        }
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
        if (markData?.participant?.first_name) {
          setIfMounted(setParticipantFirstName, markData.participant.first_name);
          localStorage.setItem(`participant_first_name_${courseId}`, markData.participant.first_name);
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
      const firstName = signInData?.participant?.first_name || '';
      setParticipantFirstName(firstName);
      if (firstName) {
        localStorage.setItem(`participant_first_name_${courseId}`, firstName);
      }
      setSuccess(true);
      setNeedsSignIn(false);
    } catch (err) {
      setErrorCode(err?.message || 'SIGN_IN_FAILED');
    } finally {
      setLoading(false);
    }
  };

  const sessionDateRaw = session?.date || session?.session_date || session?.start_time || '';
  const sessionDate = formatSessionDate(sessionDateRaw);
  const courseTitleRaw = course?.title || course?.name || course?.course_title || 'לא צוין';
  const courseTitle = tryFixMojibake(courseTitleRaw);
  const errorMessage = errorCode ? getFriendlyErrorMessage(errorCode) : '';
  const firstNameForMessage = participantFirstName || 'משתתף/ת';

  return (
    <main className="app-shell" dir="rtl">
      <section className="attendance-card">
        <header className="card-header">
          <h1>רישום נוכחות</h1>
          <p className="subtitle">קורס: {courseTitle}</p>
        </header>

        {loading && <p className="status-line">טוענים את פרטי המפגש…</p>}

        {!loading && errorMessage && (
          <div className="alert alert-error" role="alert" aria-live="polite">
            <h2>לא הצלחנו להשלים את רישום הנוכחות</h2>
            <p>{errorMessage}</p>
            <p className="error-code">קוד שגיאה: {errorCode}</p>
          </div>
        )}

        {!loading && success && (
          <section className="alert alert-success">
            <h2>{alreadyMarked ? `כבר נרשמת היום, ${firstNameForMessage}` : `נרשמת בהצלחה, ${firstNameForMessage}`}</h2>
            <p>
              <strong>קורס:</strong> {courseTitle}
            </p>
            <p>
              <strong>תאריך מפגש:</strong> {sessionDate}
            </p>
            <p>
              {alreadyMarked
                ? `${firstNameForMessage}, כבר נרשמת לנוכחות במפגש של היום ואין צורך בפעולה נוספת.`
                : `${firstNameForMessage}, הנוכחות שלך נרשמה בהצלחה. שיהיה מפגש מוצלח!`}
            </p>
            {deviceUuid && <p className="hint">המכשיר הזה יזוהה אוטומטית בסריקה הבאה שלך.</p>}
          </section>
        )}

        {!loading && !success && needsSignIn && (
          <section>
            <h2>אימות פרטים לרישום נוכחות</h2>
            <p className="subtitle">יש להזין טלפון ואימייל כדי לאמת הרשמה לקורס ולסמן נוכחות.</p>

            <form onSubmit={handleSignIn} className="sign-in-form">
              <div>
                <label htmlFor="phone">טלפון</label>
                <input
                  id="phone"
                  name="phone"
                  value={form.phone}
                  onChange={handleInputChange}
                  required
                  autoComplete="tel"
                  placeholder="לדוגמה: 0501234567"
                />
              </div>

              <div>
                <label htmlFor="email">אימייל</label>
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
                אימות ורישום נוכחות
              </button>
            </form>
          </section>
        )}

        {!loading && !success && !needsSignIn && !errorMessage && (
          <p className="status-line">מכינים את תהליך הרישום לנוכחות…</p>
        )}
      </section>
    </main>
  );
}

export default App;
