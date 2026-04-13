import { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL, apiRequest } from './api';
import './theme.css';

const navItems = ['Dashboard', 'Courses', 'Enrollments', 'Attendance', 'Participants', 'Logs'];

function normalizeEnrollmentRow(row) {
  return {
    first_name: (row.first_name || row.firstname || '').toString().trim(),
    last_name: (row.last_name || row.lastname || '').toString().trim(),
    phone: (row.phone || '').toString().replace(/\D/g, '').trim(),
    email: (row.email || '').toString().trim()
  };
}

async function parseEnrollmentWorkbook(file) {
  const buffer = await file.arrayBuffer();
  const zipEntries = await readZipEntries(buffer);
  const sheetXml = await getFirstWorksheetXml(zipEntries);
  if (!sheetXml) return [];

  const sharedStrings = parseSharedStrings(zipEntries.get('xl/sharedStrings.xml'));
  const rowObjects = parseWorksheetRows(sheetXml, sharedStrings);
  return rowObjects.map(normalizeEnrollmentRow);
}

function readUInt16(view, offset) {
  return view.getUint16(offset, true);
}

function readUInt32(view, offset) {
  return view.getUint32(offset, true);
}

async function inflateDeflateRaw(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const arrayBuffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

async function readZipEntries(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);

  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (readUInt32(view, i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('Invalid .xlsx file (missing ZIP directory).');

  const centralDirectoryOffset = readUInt32(view, eocdOffset + 16);
  const totalEntries = readUInt16(view, eocdOffset + 10);
  const entries = new Map();

  let ptr = centralDirectoryOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (readUInt32(view, ptr) !== 0x02014b50) throw new Error('Invalid .xlsx file (bad ZIP header).');

    const compressionMethod = readUInt16(view, ptr + 10);
    const compressedSize = readUInt32(view, ptr + 20);
    const fileNameLength = readUInt16(view, ptr + 28);
    const extraLength = readUInt16(view, ptr + 30);
    const commentLength = readUInt16(view, ptr + 32);
    const localHeaderOffset = readUInt32(view, ptr + 42);

    const fileNameBytes = bytes.slice(ptr + 46, ptr + 46 + fileNameLength);
    const fileName = new TextDecoder().decode(fileNameBytes);

    if (readUInt32(view, localHeaderOffset) !== 0x04034b50) throw new Error('Invalid .xlsx file (bad local file header).');
    const localNameLen = readUInt16(view, localHeaderOffset + 26);
    const localExtraLen = readUInt16(view, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressedData = bytes.slice(dataStart, dataStart + compressedSize);

    let fileData;
    if (compressionMethod === 0) {
      fileData = compressedData;
    } else if (compressionMethod === 8) {
      fileData = await inflateDeflateRaw(compressedData);
    } else {
      throw new Error(`Unsupported ZIP compression method: ${compressionMethod}.`);
    }

    entries.set(fileName, new TextDecoder().decode(fileData));
    ptr += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

async function getFirstWorksheetXml(zipEntries) {
  const worksheetPaths = Array.from(zipEntries.keys())
    .filter((path) => path.startsWith('xl/worksheets/sheet') && path.endsWith('.xml'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const firstPath = worksheetPaths[0];
  return firstPath ? zipEntries.get(firstPath) : '';
}

function parseSharedStrings(sharedStringsXml = '') {
  if (!sharedStringsXml) return [];
  const doc = new DOMParser().parseFromString(sharedStringsXml, 'application/xml');
  const items = Array.from(doc.getElementsByTagName('si'));

  return items.map((item) => {
    const textNodes = Array.from(item.getElementsByTagName('t'));
    return textNodes.map((node) => node.textContent || '').join('');
  });
}

function columnLettersToIndex(letters) {
  let value = 0;
  for (const char of letters) {
    value = (value * 26) + (char.charCodeAt(0) - 64);
  }
  return value - 1;
}

function parseWorksheetRows(worksheetXml, sharedStrings) {
  const doc = new DOMParser().parseFromString(worksheetXml, 'application/xml');
  const rowNodes = Array.from(doc.getElementsByTagName('row'));
  if (rowNodes.length < 2) return [];

  const table = rowNodes.map((rowNode) => {
    const cells = Array.from(rowNode.getElementsByTagName('c'));
    const row = [];

    cells.forEach((cellNode) => {
      const ref = cellNode.getAttribute('r') || '';
      const letters = (ref.match(/[A-Z]+/) || [''])[0];
      const colIndex = letters ? columnLettersToIndex(letters) : row.length;
      const type = cellNode.getAttribute('t');

      let value = '';
      if (type === 'inlineStr') {
        value = cellNode.getElementsByTagName('t')[0]?.textContent || '';
      } else {
        const raw = cellNode.getElementsByTagName('v')[0]?.textContent || '';
        value = type === 's' ? (sharedStrings[Number(raw)] || '') : raw;
      }
      row[colIndex] = value;
    });

    return row;
  });

  return table.slice(1).map((row) => ({
    first_name: row[0] || '',
    last_name: row[1] || '',
    phone: row[2] || '',
    email: row[3] || ''
  }));
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
                onEnrollmentsChange={setEnrollments}
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
  const [qrLinkByCourse, setQrLinkByCourse] = useState({});
  const [creatingQrFor, setCreatingQrFor] = useState('');

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


  const createQrLink = async (courseId) => {
    setCreatingQrFor(String(courseId));
    const { ok, data } = await apiRequest(`/admin/courses/${courseId}/qr-session`, {
      method: 'POST',
      credentials: 'include'
    });

    if (ok && data.success) {
      setQrLinkByCourse((prev) => ({ ...prev, [courseId]: data.data }));
    }

    setCreatingQrFor('');
  };

  const copyQrLink = async (courseId) => {
    const link = qrLinkByCourse[courseId]?.qr_link;
    if (!link) return;

    try {
      await navigator.clipboard.writeText(link);
    } catch {
      window.prompt('Copy this QR link:', link);
    }
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
                      <span>{session.session_date}</span>
                      <button onClick={() => deleteSession(session.id, course.id)} className="danger-btn">Delete</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="qr-link-panel">
              <button onClick={() => createQrLink(course.id)} disabled={creatingQrFor === String(course.id)}>
                {creatingQrFor === String(course.id) ? 'Creating…' : 'Create QR Link'}
              </button>
              {qrLinkByCourse[course.id]?.qr_link && (
                <div className="qr-link-actions">
                  <input value={qrLinkByCourse[course.id].qr_link} readOnly />
                  <div className="inline-actions">
                    <button onClick={() => copyQrLink(course.id)} type="button">Copy Link</button>
                    <a href={qrLinkByCourse[course.id].qr_link} target="_blank" rel="noreferrer">Open QR Screen</a>
                  </div>
                </div>
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

function EnrollmentsSection({ courseId, enrollments, reload, onEnrollmentsChange }) {
  const [row, setRow] = useState({ first_name: '', last_name: '', phone: '', email: '' });
  const [selectedWorkbook, setSelectedWorkbook] = useState(null);
  const [parsedRows, setParsedRows] = useState([]);
  const [browseStatus, setBrowseStatus] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [editRows, setEditRows] = useState({});

  useEffect(() => {
    const next = {};
    enrollments.forEach((enrollment) => {
      next[enrollment.id] = {
        first_name: enrollment.first_name || '',
        last_name: enrollment.last_name || '',
        phone: enrollment.phone || '',
        email: enrollment.email || ''
      };
    });
    setEditRows(next);
  }, [enrollments]);

  const normalizePhone = (phone) => String(phone || '').replace(/\D/g, '');

  const addRow = async (e) => {
    e.preventDefault();
    await apiRequest(`/admin/courses/${courseId}/enrollments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ ...row, phone: normalizePhone(row.phone) })
    });
    setRow({ first_name: '', last_name: '', phone: '', email: '' });
    await reload();
  };

  const browseWorkbook = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadStatus('');
    setSelectedWorkbook(null);
    setParsedRows([]);

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setBrowseStatus('Browse failed: only .xlsx files are supported.');
      return;
    }

    try {
      const rows = await parseEnrollmentWorkbook(file);
      if (!rows.length) {
        setBrowseStatus('Browse failed: the workbook has no enrollment rows.');
        return;
      }

      setSelectedWorkbook(file);
      setParsedRows(rows);
      setBrowseStatus(`Browse successful: ready to upload ${rows.length} row(s).`);
    } catch (error) {
      setBrowseStatus(`Browse failed: ${error.message}`);
    }
  };

  const uploadWorkbook = async () => {
    if (!selectedWorkbook || parsedRows.length === 0) {
      setUploadStatus('Upload failed: browse and parse a .xlsx file first.');
      return;
    }

    const { ok, data } = await apiRequest(`/admin/courses/${courseId}/enrollments/replace`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ rows: parsedRows })
    });

    if (!ok || !data?.success) {
      setUploadStatus(`Upload failed: ${data?.error?.message || 'unknown error'}`);
      return;
    }

    setUploadStatus(`Upload successful: replaced ${data.data?.replaced_count || 0} enrollment(s).`);
    if (Array.isArray(data.data?.rows)) {
      onEnrollmentsChange(data.data.rows);
    } else {
      await reload();
    }
    setSelectedWorkbook(null);
    setParsedRows([]);
    setBrowseStatus('');
  };

  const clearSelectedWorkbook = () => {
    setSelectedWorkbook(null);
    setParsedRows([]);
    setBrowseStatus('');
    setUploadStatus('');
  };

  const clearSelectedWorkbook = () => {
    setSelectedWorkbook(null);
    setParsedRows([]);
    setBrowseStatus('');
    setUploadStatus('');
  };

  const removeEnrollment = async (id) => {
    await apiRequest(`/admin/enrollments/${id}`, { method: 'DELETE', credentials: 'include' });
    await reload();
  };

  const saveEnrollment = async (id) => {
    const draft = editRows[id];
    if (!draft) return;
    const payload = {
      ...draft,
      phone: normalizePhone(draft.phone),
      email: (draft.email || '').trim().toLowerCase()
    };
    const { ok, data } = await apiRequest(`/admin/enrollments/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    if (!ok || !data?.success) {
      setUploadStatus(`Update failed for enrollment ${id}: ${data?.error?.message || 'unknown error'}`);
      return;
    }
    setUploadStatus(`Enrollment ${id} updated successfully.`);
    await reload();
  };

  return <section className="admin-panel"><h3>Enrollments</h3>
    <label className="file-upload">Excel Upload (.xlsx):
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={browseWorkbook} />
    </label>
    {browseStatus && <p>{browseStatus}</p>}
    <div className="inline-actions">
      <button type="button" onClick={uploadWorkbook}>Upload</button>
      <button type="button" onClick={clearSelectedWorkbook}>Clear</button>
    </div>
    {uploadStatus && <p>{uploadStatus}</p>}
    <form onSubmit={addRow} className="admin-grid-form">
      <input placeholder="First Name" value={row.first_name} onChange={(e) => setRow({ ...row, first_name: e.target.value })} />
      <input placeholder="Last Name" value={row.last_name} onChange={(e) => setRow({ ...row, last_name: e.target.value })} />
      <input placeholder="Phone" value={row.phone} onChange={(e) => setRow({ ...row, phone: e.target.value })} />
      <input placeholder="Email" value={row.email} onChange={(e) => setRow({ ...row, email: e.target.value })} />
      <button type="submit">Add Enrollment</button>
    </form>
    <table className="admin-table"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th /></tr></thead><tbody>
      {enrollments.map((enrollment) => <tr key={enrollment.id}>
        <td>
          <input value={editRows[enrollment.id]?.first_name || ''} onChange={(e) => setEditRows((prev) => ({ ...prev, [enrollment.id]: { ...prev[enrollment.id], first_name: e.target.value } }))} placeholder="First" />
          <input value={editRows[enrollment.id]?.last_name || ''} onChange={(e) => setEditRows((prev) => ({ ...prev, [enrollment.id]: { ...prev[enrollment.id], last_name: e.target.value } }))} placeholder="Last" />
        </td>
        <td><input value={editRows[enrollment.id]?.phone || ''} onChange={(e) => setEditRows((prev) => ({ ...prev, [enrollment.id]: { ...prev[enrollment.id], phone: e.target.value } }))} /></td>
        <td><input value={editRows[enrollment.id]?.email || ''} onChange={(e) => setEditRows((prev) => ({ ...prev, [enrollment.id]: { ...prev[enrollment.id], email: e.target.value } }))} /></td>
        <td>
          <div className="inline-actions">
            <button type="button" onClick={() => saveEnrollment(enrollment.id)}>Save</button>
            <button type="button" onClick={() => removeEnrollment(enrollment.id)}>Delete</button>
          </div>
        </td>
      </tr>)}
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
    <table className="admin-table"><thead><tr><th>Participant</th>{attendance.sessions.map((session) => <th key={session.id}>{session.session_date}</th>)}</tr></thead><tbody>
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
