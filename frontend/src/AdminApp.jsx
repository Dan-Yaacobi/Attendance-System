import { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL, apiRequest } from './api';
import './theme.css';

const navItems = ['Dashboard', 'Courses', 'Enrollments', 'Attendance', 'Participants', 'Logs'];

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] || '';
    });
    return {
      first_name: row.first_name || row.firstname || '',
      last_name: row.last_name || row.lastname || '',
      phone: row.phone || '',
      email: row.email || ''
    };
  });
}

function formatCourseMonthYear(course) {
  const monthIndex = Number(course.month) - 1;
  const monthLabel = monthIndex >= 0 && monthIndex < 12
    ? new Date(Date.UTC(Number(course.year), monthIndex, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
    : `Month ${course.month}`;
  return `${monthLabel} ${course.year}`;
}

function CourseContextHeader({ course }) {
  if (!course) {
    return <div className="course-context-empty">Please select a course to continue.</div>;
  }

  return (
    <header className="course-context-header">
      <p className="course-context-label">Editing Course</p>
      <h3>{course.course_title}</h3>
      <p className="course-context-meta">{course.sap_course_id} · {formatCourseMonthYear(course)}</p>
    </header>
  );
}

function CourseSelector({ courses, selectedCourseId, onSelect }) {
  return (
    <section className="admin-panel">
      <h3>Select Course</h3>
      <div className="course-selector-grid">
        {courses.map((course) => (
          <button
            key={course.id}
            className={`course-selector-btn ${String(course.id) === String(selectedCourseId) ? 'active' : ''}`}
            onClick={() => onSelect(String(course.id))}
          >
            <span>{course.course_title}</span>
            <small>{course.sap_course_id} · {formatCourseMonthYear(course)}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

export default function AdminApp() {
  const [section, setSection] = useState('Dashboard');
  const [admin, setAdmin] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [courses, setCourses] = useState([]);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [courseSessionsByCourseId, setCourseSessionsByCourseId] = useState({});
  const [enrollments, setEnrollments] = useState([]);
  const [attendance, setAttendance] = useState({ sessions: [], rows: [] });
  const [participants, setParticipants] = useState([]);
  const [logs, setLogs] = useState([]);

  const selectedCourse = useMemo(
    () => courses.find((c) => String(c.id) === String(selectedCourseId)),
    [courses, selectedCourseId]
  );

  const loadAuth = async () => {
    const { ok, data } = await apiRequest('/admin/auth/me', { credentials: 'include' });
    if (ok && data.success) setAdmin(data.data.admin);
  };

  const loadDashboard = async () => {
    const { ok, data } = await apiRequest('/admin/dashboard', { credentials: 'include' });
    if (ok && data.success) setDashboard(data.data);
  };

  const loadSessionsForCourse = async (courseId) => {
    if (!courseId) return;
    const { ok, data } = await apiRequest(`/admin/courses/${courseId}/sessions`, { credentials: 'include' });
    if (ok && data.success) {
      setCourseSessionsByCourseId((prev) => ({ ...prev, [courseId]: data.data }));
    }
  };

  const loadCourses = async () => {
    const { ok, data } = await apiRequest('/admin/courses', { credentials: 'include' });
    if (ok && data.success) {
      setCourses(data.data);
      if (!selectedCourseId && data.data[0]) setSelectedCourseId(String(data.data[0].id));
      await Promise.all(data.data.map((course) => loadSessionsForCourse(course.id)));
    }
  };

  const loadEnrollments = async (courseId) => {
    if (!courseId) return;
    const { ok, data } = await apiRequest(`/admin/courses/${courseId}/enrollments`, { credentials: 'include' });
    if (ok && data.success) setEnrollments(data.data);
  };

  const loadAttendance = async (courseId) => {
    if (!courseId) return;
    const { ok, data } = await apiRequest(`/admin/courses/${courseId}/attendance`, { credentials: 'include' });
    if (ok && data.success) setAttendance(data.data);
  };

  const loadParticipants = async (query = '') => {
    const { ok, data } = await apiRequest(`/admin/participants?q=${encodeURIComponent(query)}`, { credentials: 'include' });
    if (ok && data.success) setParticipants(data.data);
  };

  const loadLogs = async () => {
    const { ok, data } = await apiRequest('/admin/logs', { credentials: 'include' });
    if (ok && data.success) setLogs(data.data);
  };

  useEffect(() => {
    loadAuth();
  }, []);

  useEffect(() => {
    if (!admin) return;
    loadDashboard();
    loadCourses();
    loadParticipants();
    loadLogs();
  }, [admin]);

  useEffect(() => {
    if (!selectedCourseId || !admin) return;
    loadEnrollments(selectedCourseId);
    loadAttendance(selectedCourseId);
    loadSessionsForCourse(selectedCourseId);
  }, [selectedCourseId, admin]);

  const login = async (e) => {
    e.preventDefault();
    setError('');
    const { ok, data } = await apiRequest('/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });

    if (!ok || !data.success) {
      setError(data?.error?.message || 'Login failed');
      return;
    }

    setAdmin(data.data.admin);
    setPassword('');
  };

  const logout = async () => {
    await apiRequest('/admin/auth/logout', { method: 'POST', credentials: 'include' });
    setAdmin(null);
  };

  if (!admin) {
    return (
      <main className="app-shell">
        <section className="attendance-card">
          <h1>Admin Login</h1>
          {error && <p className="error-code">{error}</p>}
          <form onSubmit={login} className="sign-in-form">
            <div>
              <label>Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button type="submit">Login</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <h2>Admin Panel</h2>
        {navItems.map((item) => (
          <button key={item} className={section === item ? 'active' : ''} onClick={() => setSection(item)}>{item}</button>
        ))}
        <button onClick={logout}>Logout</button>
      </aside>
      <main className="admin-content">
        <div className="admin-toolbar">
          <strong>{admin.full_name}</strong>
        </div>

        {section === 'Dashboard' && dashboard && (
          <section className="admin-panel">
            <h3>Dashboard</h3>
            <p>Active courses today: {dashboard.active_courses_today}</p>
            <p>Attendance today: {dashboard.attendance_today}</p>
            <p>Participants: {dashboard.participant_count}</p>
          </section>
        )}

        {section === 'Courses' && (
          <CoursesSection
            courses={courses}
            sessionsByCourseId={courseSessionsByCourseId}
            reloadCourses={loadCourses}
            reloadSessions={loadSessionsForCourse}
          />
        )}

        {section === 'Enrollments' && (
          <>
            <CourseSelector courses={courses} selectedCourseId={selectedCourseId} onSelect={setSelectedCourseId} />
            <CourseContextHeader course={selectedCourse} />
            {selectedCourseId ? (
              <EnrollmentsSection
                courseId={selectedCourseId}
                enrollments={enrollments}
                reload={() => loadEnrollments(selectedCourseId)}
              />
            ) : (
              <section className="admin-panel"><p>Please select a course to continue.</p></section>
            )}
          </>
        )}

        {section === 'Attendance' && (
          <>
            <CourseSelector courses={courses} selectedCourseId={selectedCourseId} onSelect={setSelectedCourseId} />
            <CourseContextHeader course={selectedCourse} />
            {selectedCourseId ? (
              <AttendanceSection courseId={selectedCourseId} attendance={attendance} reload={() => loadAttendance(selectedCourseId)} />
            ) : (
              <section className="admin-panel"><p>Please select a course to continue.</p></section>
            )}
          </>
        )}

        {section === 'Participants' && (
          <ParticipantsSection participants={participants} onSearch={loadParticipants} />
        )}

        {section === 'Logs' && (
          <LogsSection logs={logs} reload={loadLogs} />
        )}
      </main>
    </div>
  );
}

function CoursesSection({ courses, sessionsByCourseId, reloadCourses, reloadSessions }) {
  const [form, setForm] = useState({ sap_course_id: '', course_title: '', month: '', year: '' });
  const [newSessionByCourse, setNewSessionByCourse] = useState({});

  const saveCourse = async (e) => {
    e.preventDefault();
    await apiRequest('/admin/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ ...form, month: Number(form.month), year: Number(form.year) })
    });
    setForm({ sap_course_id: '', course_title: '', month: '', year: '' });
    reloadCourses();
  };

  const addSession = async (e, courseId) => {
    e.preventDefault();
    const session_date = newSessionByCourse[courseId];
    if (!session_date) return;

    await apiRequest(`/admin/courses/${courseId}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ session_date })
    });

    setNewSessionByCourse((prev) => ({ ...prev, [courseId]: '' }));
    reloadSessions(courseId);
    reloadCourses();
  };

  const deleteSession = async (sessionId, courseId) => {
    await apiRequest(`/admin/sessions/${sessionId}`, { method: 'DELETE', credentials: 'include' });
    reloadSessions(courseId);
    reloadCourses();
  };

  return <section className="admin-panel"><h3>Courses</h3>
    <form onSubmit={saveCourse} className="admin-grid-form">
      <input placeholder="SAP Course ID" value={form.sap_course_id} onChange={(e) => setForm({ ...form, sap_course_id: e.target.value })} />
      <input placeholder="Course Title" value={form.course_title} onChange={(e) => setForm({ ...form, course_title: e.target.value })} />
      <input placeholder="Month" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} />
      <input placeholder="Year" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
      <button type="submit">Create Course</button>
    </form>

    <div className="course-card-list">
      {courses.map((course) => {
        const sessions = sessionsByCourseId[course.id] || [];
        return (
          <article key={course.id} className="course-card">
            <header className="course-card-header">
              <h4>{course.course_title}</h4>
              <p>{course.sap_course_id}</p>
              <p>{formatCourseMonthYear(course)}</p>
            </header>

            <section className="course-sessions">
              <h5>Sessions</h5>
              {sessions.length === 0 ? <p>No sessions yet.</p> : (
                <ul>
                  {sessions.map((session) => (
                    <li key={session.id}>
                      <span>{String(session.session_date).slice(0, 10)}</span>
                      <button onClick={() => deleteSession(session.id, course.id)} className="danger-btn">Delete</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <form className="inline-session-form" onSubmit={(e) => addSession(e, course.id)}>
              <input
                type="date"
                value={newSessionByCourse[course.id] || ''}
                onChange={(e) => setNewSessionByCourse((prev) => ({ ...prev, [course.id]: e.target.value }))}
              />
              <button type="submit">Add Session</button>
            </form>
          </article>
        );
      })}
    </div>
  </section>;
}

function EnrollmentsSection({ courseId, enrollments, reload }) {
  const [row, setRow] = useState({ first_name: '', last_name: '', phone: '', email: '' });

  const addRow = async (e) => {
    e.preventDefault();
    await apiRequest(`/admin/courses/${courseId}/enrollments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(row)
    });
    setRow({ first_name: '', last_name: '', phone: '', email: '' });
    reload();
  };

  const replaceByCsv = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text);
    await apiRequest(`/admin/courses/${courseId}/enrollments/replace`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ rows })
    });
    reload();
  };

  const removeEnrollment = async (id) => {
    await apiRequest(`/admin/enrollments/${id}`, { method: 'DELETE', credentials: 'include' });
    reload();
  };

  return <section className="admin-panel"><h3>Enrollments</h3>
    <label className="file-upload">CSV Upload (replace all): <input type="file" accept=".csv" onChange={replaceByCsv} /></label>
    <form onSubmit={addRow} className="admin-grid-form">
      <input placeholder="First Name" value={row.first_name} onChange={(e) => setRow({ ...row, first_name: e.target.value })} />
      <input placeholder="Last Name" value={row.last_name} onChange={(e) => setRow({ ...row, last_name: e.target.value })} />
      <input placeholder="Phone" value={row.phone} onChange={(e) => setRow({ ...row, phone: e.target.value })} />
      <input placeholder="Email" value={row.email} onChange={(e) => setRow({ ...row, email: e.target.value })} />
      <button type="submit">Add Enrollment</button>
    </form>
    <table className="admin-table"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th /></tr></thead><tbody>
      {enrollments.map((enrollment) => <tr key={enrollment.id}><td>{enrollment.first_name} {enrollment.last_name}</td><td>{enrollment.phone}</td><td>{enrollment.email}</td><td><button onClick={() => removeEnrollment(enrollment.id)}>Delete</button></td></tr>)}
    </tbody></table>
  </section>;
}

function AttendanceSection({ courseId, attendance, reload }) {
  const toggle = async (participantId, sessionId, present) => {
    await apiRequest('/admin/attendance', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ participant_id: participantId, session_id: sessionId, present: !present })
    });
    reload();
  };

  const grouped = {};
  for (const row of attendance.rows) {
    if (!grouped[row.participant_id]) grouped[row.participant_id] = { person: row, sessions: {} };
    grouped[row.participant_id].sessions[row.session_id] = row;
  }

  return <section className="admin-panel"><h3>Attendance</h3>
    <a href={`${API_BASE_URL}/admin/courses/${courseId}/attendance/export`} target="_blank" rel="noreferrer">Export CSV</a>
    <table className="admin-table"><thead><tr><th>Participant</th>{attendance.sessions.map((session) => <th key={session.id}>{String(session.session_date).slice(0, 10)}</th>)}</tr></thead><tbody>
      {Object.values(grouped).map((row) => <tr key={row.person.participant_id}><td>{row.person.first_name} {row.person.last_name}</td>
        {attendance.sessions.map((session) => {
          const cell = row.sessions[session.id];
          const present = cell && !cell.removed_at;
          return <td key={session.id}><button onClick={() => toggle(row.person.participant_id, session.id, present)}>{present ? 'Present' : 'Absent'} {cell?.source === 'admin_manual' ? '*' : ''}</button></td>;
        })}
      </tr>)}
    </tbody></table>
  </section>;
}

function ParticipantsSection({ participants, onSearch }) {
  return <section className="admin-panel"><h3>Participants</h3>
    <input placeholder="Search by name/email/phone" onChange={(e) => onSearch(e.target.value)} />
    <table className="admin-table"><thead><tr><th>Name</th><th>Phone</th><th>Email</th></tr></thead><tbody>
      {participants.map((participant) => <tr key={participant.id}><td>{participant.first_name} {participant.last_name}</td><td>{participant.phone}</td><td>{participant.email}</td></tr>)}
    </tbody></table>
  </section>;
}

function LogsSection({ logs, reload }) {
  return <section className="admin-panel"><h3>Logs</h3><button onClick={reload}>Refresh</button>
    <table className="admin-table"><thead><tr><th>Time</th><th>Admin</th><th>Action</th><th>Entity</th></tr></thead><tbody>
      {logs.map((log) => <tr key={log.id}><td>{new Date(log.created_at).toLocaleString()}</td><td>{log.admin_email || 'N/A'}</td><td>{log.action_type}</td><td>{log.entity_type}</td></tr>)}
    </tbody></table>
  </section>;
}
