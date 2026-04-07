import { useEffect, useMemo, useState } from 'react';

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
      if (isMounted) {
        setter(value);
      }
    };

    const parseErrorMessage = async (response) => {
      try {
        const data = await response.json();
        return data?.error?.code || data?.code || data?.message || `Request failed (${response.status})`;
      } catch {
        return `Request failed (${response.status})`;
      }
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
        const entryResponse = await fetch('/api/v1/attendance/entry', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ course_id: courseId }),
        });

        if (!entryResponse.ok) {
          const entryError = await parseErrorMessage(entryResponse);
          throw new Error(entryError);
        }

        const entryData = await entryResponse.json();
        setIfMounted(setCourse, entryData.course || null);
        setIfMounted(setSession, entryData.session || null);

        const storedDeviceUuid = getStoredDeviceUuid(courseId);
        console.log('Device UUID for course:', storedDeviceUuid);
        if (!storedDeviceUuid) {
          setIfMounted(setNeedsSignIn, true);
          return;
        }

        setIfMounted(setDeviceUuid, storedDeviceUuid);

        const markResponse = await fetch('/api/v1/attendance/mark-by-device', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            course_id: courseId,
            device_uuid: storedDeviceUuid,
          }),
        });

        if (!markResponse.ok) {
          clearStoredDeviceUuid(courseId);
          setIfMounted(setDeviceUuid, '');
          setIfMounted(setNeedsSignIn, true);
          return;
        }

        setIfMounted(setSuccess, true);
      } catch (err) {
        setIfMounted(setError, err?.message || 'Something went wrong');
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
      setError('Invalid QR');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/v1/attendance/sign-in', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          course_id: courseId,
          first_name: form.first_name,
          last_name: form.last_name,
          phone: form.phone,
          email: form.email,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const signInError = data?.error?.code || data?.code || data?.message || `Request failed (${response.status})`;
        throw new Error(signInError);
      }

      if (data?.device_uuid) {
        setStoredDeviceUuid(courseId, data.device_uuid);
        setDeviceUuid(data.device_uuid);
      }

      setSuccess(true);
      setNeedsSignIn(false);
    } catch (err) {
      setError(err?.message || 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const sessionDate = session?.date || session?.session_date || session?.start_time || 'N/A';
  const courseTitle = course?.title || course?.name || 'Course';

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
          {deviceUuid && <p style={{ fontSize: '0.875rem', color: '#555' }}>Device recognized.</p>}
        </section>
      )}

      {!loading && !success && needsSignIn && (
        <section>
          <h2>Sign In</h2>
          <p>Please enter your details to mark attendance.</p>
          <form onSubmit={handleSignIn}>
            <div style={{ marginBottom: '0.75rem' }}>
              <label htmlFor="first_name">First Name</label>
              <input
                id="first_name"
                name="first_name"
                value={form.first_name}
                onChange={handleInputChange}
                required
                style={{ display: 'block', width: '100%', padding: '0.5rem' }}
              />
            </div>

            <div style={{ marginBottom: '0.75rem' }}>
              <label htmlFor="last_name">Last Name</label>
              <input
                id="last_name"
                name="last_name"
                value={form.last_name}
                onChange={handleInputChange}
                required
                style={{ display: 'block', width: '100%', padding: '0.5rem' }}
              />
            </div>

            <div style={{ marginBottom: '0.75rem' }}>
              <label htmlFor="phone">Phone</label>
              <input
                id="phone"
                name="phone"
                value={form.phone}
                onChange={handleInputChange}
                required
                style={{ display: 'block', width: '100%', padding: '0.5rem' }}
              />
            </div>

            <div style={{ marginBottom: '0.75rem' }}>
              <label htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                value={form.email}
                onChange={handleInputChange}
                required
                style={{ display: 'block', width: '100%', padding: '0.5rem' }}
              />
            </div>

            <button type="submit" disabled={loading} style={{ padding: '0.5rem 1rem' }}>
              Submit
            </button>
          </form>
        </section>
      )}

      {!loading && !success && !needsSignIn && !error && <p>Preparing attendance flow...</p>}
    </main>
  );
}

export default App;
