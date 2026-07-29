import { getAuthContext, getProfileById, isSupabaseServerConfigured } from './_lib/supabase.js';

function json(res, status, payload) {
  res.status(status).json(payload);
}

function sanitizeDisplayName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

export default async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (!isSupabaseServerConfigured()) {
    return json(res, 500, { ok: false, error: 'SERVER_NOT_CONFIGURED' });
  }

  const auth = await getAuthContext(req, { allowAnonymous: req.method === 'GET' });
  if (auth.error) {
    return json(res, auth.status || 401, { ok: false, error: auth.error });
  }

  if (req.method === 'PATCH') {
    if (!auth.user || !auth.profile) {
      return json(res, 401, { ok: false, error: 'AUTH_REQUIRED', loginRequired: true });
    }

    let body;
    try {
      body = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8') || '{}') : req.body || {};
    } catch {
      return json(res, 400, { ok: false, error: 'INVALID_PROFILE' });
    }

    const fullName = sanitizeDisplayName(body.fullName || body.full_name);
    if (!fullName) {
      return json(res, 400, { ok: false, error: 'INVALID_PROFILE' });
    }

    const { error } = await auth.client
      .from('profiles')
      .update({ full_name: fullName })
      .eq('id', auth.user.id);

    if (error) {
      console.warn('Failed to update profile', {
        userId: auth.user.id,
        message: String(error?.message || 'unknown').slice(0, 240)
      });
      return json(res, 500, { ok: false, error: 'PROFILE_UPDATE_FAILED' });
    }

    const nextProfile = await getProfileById(auth.user.id);
    return json(res, 200, { ok: true, user: nextProfile });
  }

  return json(res, 200, {
    ok: true,
    user: auth.profile || null
  });
}
