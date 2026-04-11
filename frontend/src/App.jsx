import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './api';
import './theme.css';

function AttendanceApp() {
  return <div className="app-shell"><section className="attendance-card"><h1>Attendance Check-In</h1><p>Public attendance flow remains isolated.</p></section></div>;
}

const NAV = ['Dashboard', 'Courses', 'Enrollments', 'Attendance', 'Participants', 'Logs'];

function AdminApp() {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [me, setMe] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [courses, setCourses] = useState([]);
  const [logs, setLogs] = useState([]);

  const loadDashboard = async () => {
    const result = await apiRequest('/api/admin/dashboard');
    if (result.ok && result.data?.success) {
      setDashboard(result.data.data);
    }
  };

  const loadCourses = async () => {
    const result = await apiRequest('/api/admin/courses');
    if (result.ok && result.data?.success) {
      setCourses(result.data.data);
    }
  };

  const loadLogs = async () => {
    const result = await apiRequest('/api/admin/logs?page=1&page_size=30');
    if (result.ok && result.data?.success) {
      setLogs(result.data.data);
    }
  };

  const refreshTab = async (tab) => {
    if (tab === 'Dashboard') await loadDashboard();
    if (tab === 'Courses' || tab === 'Enrollments' || tab === 'Attendance') await loadCourses();
    if (tab === 'Logs') await loadLogs();
  };

  useEffect(() => {
    (async () => {
      const result = await apiRequest('/api/admin/auth/me');
      if (result.ok && result.data?.success) {
        setMe(result.data.data.admin);
        await refreshTab(activeTab);
      }
    })();
  }, []);

  useEffect(() => {
    if (me) {
      refreshTab(activeTab);
    }
  }, [activeTab]);

  const login = async (e) => {
    e.preventDefault();
    setError('');
    const result = await apiRequest('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!result.ok || !result.data?.success) {
      setError(result.data?.error?.message || 'Login failed');
      return;
    }

    setMe(result.data.data.admin);
    setPassword('');
    await refreshTab(activeTab);
  };

  const logout = async () => {
    await apiRequest('/api/admin/auth/logout', { method: 'POST' });
    setMe(null);
    setDashboard(null);
  };

  if (!me) {
    return (
      <main className="admin-shell">
        <section className="admin-login-card">
          <h1>Admin Login</h1>
          <form onSubmit={login} className="sign-in-form">
            <div><label>Email</label><input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><label>Password</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            <button type="submit">Sign in</button>
          </form>
          {error && <p className="error-code">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <h2>Control Panel</h2>
        <p className="hint">{me.full_name}</p>
        {NAV.map((item) => (
          <button key={item} className={`nav-btn ${activeTab === item ? 'active' : ''}`} onClick={() => setActiveTab(item)}>{item}</button>
        ))}
        <button onClick={logout}>Logout</button>
      </aside>
      <section className="admin-content">
        {activeTab === 'Dashboard' && dashboard && (
          <div className="grid">
            <article className="card"><h3>Active Courses Today</h3><p>{dashboard.active_courses_today}</p></article>
            <article className="card"><h3>Attendance Today</h3><p>{dashboard.attendance_today}</p></article>
            <article className="card"><h3>Participants</h3><p>{dashboard.participant_count}</p></article>
          </div>
        )}
        {activeTab === 'Courses' && <pre>{JSON.stringify(courses, null, 2)}</pre>}
        {activeTab === 'Enrollments' && <p>Use API endpoints for atomic bulk upload and manual enrollment updates.</p>}
        {activeTab === 'Attendance' && <p>Use admin attendance matrix and override APIs to edit traceably.</p>}
        {activeTab === 'Participants' && <p>Use participant search API for support/debugging.</p>}
        {activeTab === 'Logs' && <pre>{JSON.stringify(logs, null, 2)}</pre>}
      </section>
    </main>
  );
}

export default function App() {
  const pathname = useMemo(() => window.location.pathname, []);
  if (pathname.startsWith('/admin')) {
    return <AdminApp />;
  }

  return <AttendanceApp />;
}
