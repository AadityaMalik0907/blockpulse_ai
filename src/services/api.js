async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

export async function getDashboard() {
  const response = await fetch('/api/dashboard');
  return readJson(response);
}

export async function searchBlockchain(query) {
  const response = await fetch(`/api/search/${encodeURIComponent(query)}`);
  return readJson(response);
}


export async function getAiStatus() {
  return readJson(await fetch('/api/ai/status'));
}

export async function getRecentAiInsights() {
  return readJson(await fetch('/api/ai/insights/recent'));
}

export async function generateAiInsight(question = '') {
  return readJson(await fetch('/api/ai/insights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  }));
}

export async function getSystemHealth() {
  return readJson(await fetch('/api/health'));
}
