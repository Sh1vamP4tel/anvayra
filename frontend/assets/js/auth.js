/* ==========================================================================
   Anvayra — auth.js (production authentication)

   Real authentication: managed identity provider (email + password, Google OAuth).
   Sessions are JWTs managed by supabase-js (refreshed automatically);
   user identity lives in auth.users, profiles/workspaces in Postgres.

   Removed: the old browser-only user store, local password hashing, fixed
   12-hour sessions and shared sign-in. Every account is a real customer
   account created through the identity provider.

   Google OAuth must be enabled in the identity provider dashboard with the
   Google client ID and secret.
   ========================================================================== */

window.AnvayraAuth = (function () {
  'use strict';

  /* ---------- Auth client ---------- */
  const SUPABASE_URL = 'https://nbxsebcrcussmmxismsa.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_i_72_ereXj3VTKsjOCfi-g_rmbwjsJX';

  const client = window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'anvayra.auth.v2'
        }
      })
    : null;

  if (!client) {
    console.error('[AnvayraAuth] supabase-js failed to load. Check network / CDN access.');
  }

  /* Optional: authoritative server-side session confirmation via the Express
     backend. When the backend is deployed, set this URL (e.g.
     "https://api.yourdomain.com/api/auth/session"). If it is empty, the dashboard
     trusts the session directly (still validated with the identity provider).
     This hook never blocks or breaks the app: a network error or timeout keeps
     the session; only an explicit server "authenticated:false" (token
     revoked server-side) forces a sign-out. */
  const SERVER_SESSION_URL = (window.AnvayraServerSessionUrl || '').replace(/\/+$/, '');

  async function serverConfirms(token) {
    if (!SERVER_SESSION_URL) return { confirmed: true };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const r = await fetch(SERVER_SESSION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token || '' }),
        signal: ctrl.signal
      });
      const data = await r.json().catch(() => ({}));
      if (data && data.authenticated === false) return { confirmed: false };
      return { confirmed: true };
    } catch (_) {
      return { confirmed: true }; // network/timeout -> trust the session
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------- helpers ---------- */
  function normaliseEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function authError(message) {
    const error = new Error(friendly(message));
    error.raw = message;
    return error;
  }

  /* Translate common identity-provider errors into plain-language copy. */
  function friendly(message) {
    const m = String(message || '');
    if (/invalid login credentials/i.test(m)) return 'That email or password is incorrect.';
    if (/email not confirmed/i.test(m)) {
      return 'Please confirm your email first — check your inbox for the verification link.';
    }
    if (/user already registered/i.test(m)) {
      return 'A workspace already exists for this email. Try signing in instead.';
    }
    if (/password.*at least|should be at least/i.test(m)) {
      return 'Use a password of at least 8 characters.';
    }
    if (/provider is not enabled|unsupported_provider/i.test(m)) {
      return 'Social sign-in is being configured. Please use email and password for now.';
    }
    if (/failed to fetch|network/i.test(m)) {
      return 'Network error — check your connection and try again.';
    }
    return message || 'Something went wrong. Please try again.';
  }

  /* ---------- session ---------- */
  /**
   * Resolves the signed-in user into the plain shape the workspace expects:
   * { userId, name, email, business }. Returns null when signed out.
   */
  async function getSession() {
    if (!client) return null;

    const { data, error } = await client.auth.getUser();
    const user = data && data.user;
    if (!user) {
      if (error && !/missing|401|session/i.test(error.message || '')) {
        console.warn('[AnvayraAuth] getSession:', error.message);
      }
      return null;
    }

    /* Optional server-side confirmation (see SERVER_SESSION_URL above). */
    const sess = await client.auth.getSession().then((s) => s && s.data && s.data.session).catch(() => null);
    const verdict = await serverConfirms(sess && sess.access_token);
    if (!verdict.confirmed) {
      try { await client.auth.signOut(); } catch (_) { /* ignore */ }
      return null;
    }

    const meta = user.user_metadata || {};
    let name = meta.full_name || meta.name || '';
    let business = meta.business_name || meta.business || '';

    try {
      const { data: profile } = await client
        .from('profiles')
        .select('full_name, business_name')
        .eq('id', user.id)
        .maybeSingle();
      if (profile) {
        if (profile.full_name) name = profile.full_name;
        if (profile.business_name) business = profile.business_name;
      }
    } catch (_) {
      /* profile fetch is best-effort; metadata already covers it */
    }

    return {
      userId: user.id,
      email: user.email,
      name: name || (user.email || '').split('@')[0],
      business: business || ''
    };
  }

  /** Route guard. Await this; redirects to /login/ when unauthenticated. */
  async function requireSession() {
    const session = await getSession();
    if (session) return session;

    const next = encodeURIComponent(
      window.location.pathname.replace(/^\/+|\/+$/g, '').replace(/\/index\.html?$/i, '')
        || 'dashboard'
    );
    window.location.replace('../login/?next=' + next);
    return null;
  }

  /* ---------- credentials ---------- */
  async function login(email, password) {
    if (!client) throw new Error('Authentication is not available right now.');
    const { data, error } = await client.auth.signInWithPassword({
      email: normaliseEmail(email),
      password: password
    });
    if (error) throw authError(error.message);
    return sessionFromUser(data.user);
  }

  async function signup({ name, email, password, business }) {
    if (!client) throw new Error('Authentication is not available right now.');
    const cleanEmail = normaliseEmail(email);
    if (!name || !cleanEmail || !password) throw new Error('Name, email and password are required.');
    if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error('That email address does not look valid.');

    const redirectTo = window.location.origin + '/dashboard/';
    const { data, error } = await client.auth.signUp({
      email: cleanEmail,
      password: password,
      options: {
        data: { full_name: String(name).trim(), business_name: String(business || '').trim() },
        emailRedirectTo: redirectTo
      }
    });
    if (error) throw authError(error.message);

    /* Email confirmation is enabled on the project: when no session comes
       back, tell the user to check their inbox instead of failing silently. */
    if (!data.session) {
      const confirmation = new Error('CONFIRM_EMAIL');
      confirmation.confirmationRequired = true;
      throw confirmation;
    }
    return sessionFromUser(data.user);
  }

  /* ---------- social ---------- */
  function oauthRedirect() {
    /* Post-login destination. The identity provider must allow this origin in
       its redirect URL list, and the site URL must be the production domain,
       otherwise OAuth falls back to the site URL (often localhost:3000). */
    const origin = /^https?:$/.test(window.location.protocol)
      ? window.location.origin
      : 'https://anvayra.vercel.app';
    return origin + '/dashboard/';
  }

  async function signInWithGoogle() {
    if (!client) throw new Error('Authentication is not available right now.');
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: oauthRedirect(), queryParams: { prompt: 'select_account' } }
    });
    if (error) throw authError(error.message);
    return data;
  }

  async function signInWithFacebook() {
    if (!client) throw new Error('Authentication is not available right now.');
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'facebook',
      options: { redirectTo: oauthRedirect() }
    });
    if (error) throw authError(error.message);
    return data;
  }

  /* ---------- session lifecycle ---------- */
  function sessionFromUser(user) {
    if (!user) return null;
    const meta = user.user_metadata || {};
    return {
      userId: user.id,
      email: user.email,
      name: meta.full_name || meta.name || (user.email || '').split('@')[0],
      business: meta.business_name || meta.business || ''
    };
  }

  async function logout() {
    if (client) {
      try { await client.auth.signOut(); } catch (error) { /* ignore */ }
    }
    window.location.href = '../login/';
  }

  /* ---------- profile ---------- */
  async function updateProfile(patch) {
    const user = (await client.auth.getUser()).data.user;
    if (!user) return null;

    const name = patch.name ? String(patch.name).trim() : undefined;
    const business = patch.business ? String(patch.business).trim() : undefined;

    const updates = {};
    if (name !== undefined) updates.full_name = name;
    if (business !== undefined) updates.business_name = business;
    if (Object.keys(updates).length === 0) return sessionFromUser(user);

    const { error } = await client
      .from('profiles')
      .update(updates)
      .eq('id', user.id);
    if (error) throw new Error('Could not save the profile: ' + friendly(error.message));

    /* Keep auth metadata in step so the header survives a profile-table miss. */
    await client.auth.updateUser({ data: {
      full_name: name !== undefined ? name : (user.user_metadata || {}).full_name,
      business_name: business !== undefined ? business : (user.user_metadata || {}).business_name
    } });

    return sessionFromUser({
      id: user.id,
      email: user.email,
      user_metadata: Object.assign({}, user.user_metadata, {
        full_name: name !== undefined ? name : (user.user_metadata || {}).full_name,
        business_name: business !== undefined ? business : (user.user_metadata || {}).business_name
      })
    });
  }

  return {
    client,
    getSession,
    requireSession,
    login,
    signup,
    logout,
    updateProfile,
    signInWithGoogle,
    signInWithFacebook
  };
})();
