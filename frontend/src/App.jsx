import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './api';

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

function App() {
  const courseId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('course_id');
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [course, setCourse] = useState(null);
  const [session, setSession] = useState(null);
  const [deviceUuid, setDeviceUuid] = useState('');
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [success, setSuccess] = useState(false);

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    email: '',
  });

  useEffect(() => {
    let isMounted = true;

    const setIfMounted = (setter, value) => {
      if (isMounted) setter(value);
    };

    const init = async () => {
      if (!courseId) {
        setIfMounted(setError, 'Invalid QR');
        setIfMounted(setLoading, false);
        return;
      }

      console.log('Course ID:', courseId);

      setIfMounted(setLoading, true);
      setIfMounted(setError, '');

      try {
        // 1. Entry
        const { ok, data } = await apiRequest('/attendance/entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ course_id: courseId }),
        });

        console.log('ENTRY DATA:', data);

        if (!ok || !data?.success) {
          throw new Error(data?.error?.code || 'ENTRY_FAILED');
        }

        setIfMounted(setCourse, data.course || null);
        setIfMounted(setSession, data.session || null);

        // 2. Check device UUID
        const storedDeviceUuid = getStoredDeviceUuid(courseId);
        console.log('Device UUID for course:', storedDeviceUuid);

        if (!storedDeviceUuid) {
          setIfMounted(setNeedsSignIn, true);
          return;
        }

        setIfMounted(setDeviceUuid, storedDeviceUuid);

        // 3. Try auto check-in
        const markRes = await apiRequest('/attendance/mark-by-device', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            course_id: courseId,
            device_uuid: storedDeviceUuid,
          }),
        });

        if (!markRes.ok || !markRes.data?.success) {
          console.log('Invalid UUID, clearing...');
          clearStoredDeviceUuid(courseId);
          setIfMounted(setDeviceUuid, '');
          setIfMounted(setNeedsSignIn, true);
          return;
        }

        setIfMounted(setSuccess, true);
      } catch (err) {
        console.error(err);
        setIfMounted(setError, err.message || 'Something went wrong');
      } finally {
        setIfMounted(setLoading, false);
      }
    };

    init();

    return () => {
      isMounted = false;
    };
  }, [courseId]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSignIn = async (e) => {
    e.preventDefault();

    if (!courseId) {
      setError('Invalid QR');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { ok, data } = await apiRequest('/attendance/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course_id: courseId,
          first_name: form.first_name,
          last_name: form.last_name,
          phone: form.phone,
          email: form.email,
        }),
      });

      console.log('SIGN-IN DATA:', data);

      if (!ok || !data?.success) {
        throw new Error(data?.error?.code || 'SIGN_IN_FAILED');
      }

      if (data?.device_uuid) {
        setStoredDeviceUuid(courseId, data.device_uuid);
        setDeviceUuid(data.device_uuid);
      }

      setSuccess(true);
      setNeedsSignIn(false);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const sessionDate =
    session?.date || session?.session_date || session?.start_time || 'N/A';

  const courseTitle =
    course?.title || course?.name || 'Course';

  return (
    <main style={{ fontFamily: 'Arial, sans-serif', padding: '2rem', maxWidth: '480px', margin: '0 auto' }}>
      <h1>QR Attendance System</h1>

      {loading && <p>Loading...</p>}

      {!loading && error && <p style={{ color: 'crimson' }}>{error}</p>}

      {!loading && success && (
        <section>
          <h2>Attendance Marked</h2>
          <p><strong>Course:</strong> {courseTitle}</p>
          <p><strong>Session Date:</strong> {sessionDate}</p>
          <p>Your attendance has been successfully recorded.</p>
          {deviceUuid && (
            <p style={{ fontSize: '0.875rem', color: '#555' }}>
              Device recognized.
            </p>
          )}
        </section>
      )}

      {!loading && !success && needsSignIn && (
        <section>
          <h2>Sign In</h2>
          <p>Please enter your details to mark attendance.</p>

          <form onSubmit={handleSignIn}>
            {['first_name', 'last_name', 'phone', 'email'].map((field) => (
              <div key={field} style={{ marginBottom: '0.75rem' }}>
                <label>{field.replace('_', ' ')}</label>
                <input
                  name={field}
                  value={form[field]}
                  onChange={handleInputChange}
                  required
                  style={{ display: 'block', width: '100%', padding: '0.5rem' }}
                />
              </div>
            ))}

            <button type="submit" disabled={loading}>
              Submit
            </button>
          </form>
        </section>
      )}

      {!loading && !success && !needsSignIn && !error && (
        <p>Preparing attendance flow...</p>
      )}
    </main>
  );
}

export default App;