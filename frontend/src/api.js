const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...options,
  });

  let data = {};
  try {
    data = await response.json();
  } catch {}

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

export { API_BASE_URL };
