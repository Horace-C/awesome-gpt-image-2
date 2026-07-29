import {
  getAuthContext,
  isSupabaseServerConfigured
} from './_lib/supabase.js';

const MAX_PROMPT_LENGTH = 6000;
const DEFAULT_CIYUAN_BASE_URL = 'https://ciyuan.today';

function json(res, status, payload) {
  res.status(status).json(payload);
}

function isServerConfigured() {
  return Boolean(process.env.CIYUAN_API_KEY && isSupabaseServerConfigured());
}

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function generateImage(prompt) {
  const baseUrl = (process.env.CIYUAN_BASE_URL || DEFAULT_CIYUAN_BASE_URL).replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CIYUAN_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'low',
      format: 'jpeg'
    })
  });
  const payload = await response.json().catch(() => ({}));
  const b64 = payload?.data?.[0]?.b64_json;

  if (!response.ok || !b64) {
    const message = payload?.error?.message || payload?.message || `Image generation failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = payload?.error?.code || payload?.code;
    error.type = payload?.error?.type || payload?.type;
    throw error;
  }

  return `data:image/jpeg;base64,${b64}`;
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (!isServerConfigured()) {
    return json(res, 500, { ok: false, error: 'SERVER_NOT_CONFIGURED' });
  }

  const auth = await getAuthContext(req, { allowAnonymous: req.method === 'GET' });
  if (auth.error) {
    return json(res, auth.status || 401, {
      ok: false,
      error: auth.error,
      loginRequired: auth.error === 'AUTH_REQUIRED'
    });
  }

  if (req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      authRequired: !auth.profile,
      freeUsed: Boolean(auth.profile?.freeUsed),
      user: auth.profile || null
    });
  }

  if (!auth.user || !auth.profile) {
    return json(res, 401, { ok: false, error: 'AUTH_REQUIRED', loginRequired: true });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { ok: false, error: 'INVALID_PROMPT' });
  }

  const prompt = String(body.prompt || '').trim();
  const caseId = Number(body.caseId);
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH || !Number.isFinite(caseId)) {
    return json(res, 400, { ok: false, error: 'INVALID_PROMPT' });
  }

  try {
    const image = await generateImage(prompt);
    await auth.client.from('generation_records').insert({
      user_id: auth.user.id,
      case_id: caseId,
      prompt,
      status: 'succeeded'
    });
    return json(res, 200, {
      ok: true,
      image,
      user: auth.profile
    });
  } catch (error) {
    console.warn('Image generation failed', {
      status: error?.status || null,
      code: error?.code || null,
      type: error?.type || null,
      message: String(error?.message || 'unknown').slice(0, 240)
    });

    if (error?.status === 429) {
      return json(res, 503, { ok: false, error: 'UPSTREAM_BUSY', user: auth.profile });
    }
    return json(res, 502, { ok: false, error: 'GENERATION_FAILED', user: auth.profile });
  }
}
