/**
 * Middleware that verifies a Supabase access token (Bearer header).
 * Sets req.supabaseUser = { id, email } on success.
 *
 * Used by billing routes — the frontend passes the Supabase session JWT,
 * not the legacy custom JWT from /auth/login.
 */
const supabase = require('../config/supabase');

const supabaseAuth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing Authorization header' });
    }
    const token = authHeader.replace('Bearer ', '').trim();

    // Use the Supabase admin client to verify the JWT and fetch the user.
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.supabaseUser = { id: data.user.id, email: data.user.email };
    next();
  } catch (e) {
    console.error('[supabaseAuth]', e.message);
    return res.status(401).json({ error: 'Auth error' });
  }
};

module.exports = supabaseAuth;
