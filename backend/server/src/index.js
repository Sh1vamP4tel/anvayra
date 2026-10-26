/**
 * Anvayra — Express backend entry point.
 *
 * The frontend is a static site; login and identity live in Supabase Auth.
 * This Node/Express server provides a proper server-side confirmation of a
 * user's session (the access token is validated against Supabase, not just
 * trusted from localStorage), plus a handful of public API endpoints.
 *
 * SECURITY: the service-role key is used only here, server-side. It never
 * reaches the browser.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://anvayra.vercel.app';
const PORT = Number(process.env.PORT || 4000);

const allowedOrigins = [APP_ORIGIN, 'http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:5500'];
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '256kb' }));

const admin = SUPABASE_URL && SERVICE_ROLE
  ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  : null;

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'anvayra-backend',
    time: new Date().toISOString(),
    authConfigured: Boolean(admin),
  });
});

/** Public, non-secret app constants for the client. */
app.get('/api/config', (_req, res) => {
  res.json({
    appId: '1111754955165517',
    configId: '1469679065081628',
    graphVersion: 'v21.0',
    webhook: `${SUPABASE_URL || ''}/functions/v1/wa-webhook`,
    dataDeletion: `${SUPABASE_URL || ''}/functions/v1/data-deletion`,
  });
});

/**
 * POST /api/auth/session
 * body: { token: string }   <- the user's Supabase access token
 * Returns an authoritative confirmation that the token belongs to a real,
 * confirmed user of this project. This is the "confirm login" call the
 * dashboard can make as a server-side check.
 */
app.post('/api/auth/session', async (req, res) => {
  const token = req.body && typeof req.body.token === 'string' ? req.body.token : '';
  if (!token) {
    return res.status(400).json({ authenticated: false, error: 'token required' });
  }
  if (!admin) {
    return res.status(503).json({ authenticated: false, error: 'auth not configured on server' });
  }
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data || !data.user) {
      return res.status(401).json({ authenticated: false, error: 'invalid session' });
    }
    const u = data.user;
    // A confirmed account must have completed email (or social) verification.
    const confirmed = Boolean(u.email_confirmed_at || u.phone_confirmed_at || u.identities?.length);
    return res.json({
      authenticated: true,
      confirmed,
      user: {
        id: u.id,
        email: u.email,
        email_confirmed_at: u.email_confirmed_at || null,
        created_at: u.created_at,
      },
    });
  } catch (err) {
    console.error('GET user failed', err);
    return res.status(500).json({ authenticated: false, error: 'server error' });
  }
});

// Anything under /api that is not matched is a client error.
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

app.listen(PORT, () => {
  console.log(`anvayra-backend listening on :${PORT}`);
  if (!admin) console.warn('WARN: SUPABASE_URL / SERVICE_ROLE not set — /api/auth/session will 503');
});
