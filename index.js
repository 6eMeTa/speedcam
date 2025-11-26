import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import connectPgSimple from 'connect-pg-simple';
import { fileURLToPath } from 'url';
import session from 'express-session';
import pg from 'pg';
const { Pool } = pg;
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import bcrypt from 'bcrypt';

const PgSession = connectPgSimple(session);

const app = express();

// ---------- PostgreSQL pool ----------
// Use individual config fields from environment variables
const pool = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: Number(process.env.PG_PORT),
});

// ---------- Express basic setup ----------
app.set('view engine', 'ejs');

// Recreate __filename and __dirname in ES modules scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set('views', path.join(__dirname, 'views'));


app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Sessions with Postgres store ----------
app.set('trust proxy', 1); // if behind reverse proxy (e.g. Nginx)

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: 'session',
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production', // true if HTTPS
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  })
); // [web:51][web:59]

// ---------- Passport configuration ----------
app.use(passport.initialize());
app.use(passport.session());

// Helper: find user by id
async function findUserById(id) {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// Helper: find user by email
async function findUserByEmail(email) {
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0] || null;
}
/*
// Helper: find or create user by Google profile
async function findOrCreateGoogleUser(profile) {
  const googleId = profile.id;
  const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;

  const existing = await pool.query(
    'SELECT * FROM users WHERE google_id = $1',
    [googleId]
  );
  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  // Optionally check by email first to link accounts

  const insert = await pool.query(
    `INSERT INTO users (email, google_id, created_at)
     VALUES ($1, $2, NOW())
     RETURNING *`,
    [email, googleId]
  );
  return insert.rows[0];
}
  */

// Local strategy (email/password) [web:52]
passport.use(
  new LocalStrategy(
    { usernameField: 'email', passwordField: 'password' },
    async (email, password, done) => {
      try {
        const user = await findUserByEmail(email);
        if (!user) {
          return done(null, false, { message: 'Incorrect email or password.' });
        }
        if (!user.password_hash) {
          return done(null, false, { message: 'Use social login for this account.' });
        }
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
          return done(null, false, { message: 'Incorrect email or password.' });
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);
/*
// Google OAuth2 strategy [web:18][web:57]
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL, // e.g. https://your-domain.com/auth/google/callback
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const user = await findOrCreateGoogleUser(profile);
        done(null, user);
      } catch (err) {
        done(err);
      }
    }
  )
);
*/
// TODO: Add Apple strategy here (passport-apple or similar)

// Serialize / deserialize
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await findUserById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// ---------- Auth helpers ----------
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
}

// ---------- Logging middleware (visits) ----------
async function logVisit(req, res, next) {
  try {
    const userId = req.user ? req.user.id : null;
    const userAgent = req.headers['user-agent'] || null;
    await pool.query(
      `INSERT INTO visits (user_id, opened_at, path, user_agent)
       VALUES ($1, NOW(), $2, $3)`,
      [userId, req.originalUrl, userAgent]
    );
  } catch (err) {
    console.error('Error logging visit:', err.message);
  }
  next();
}

// ---------- Routes ----------

// Home
app.get('/', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return res.redirect('/drive');
  }
  res.redirect('/login');
});

// Login form
app.get('/login', (req, res) => {
  res.render('login', { user: req.user || null });
});

// Local login POST
app.post(
  '/login',
  passport.authenticate('local', {
    successRedirect: '/drive',
    failureRedirect: '/login',
  })
);

// Register form
app.get('/register', (req, res) => {
  res.render('register', { user: req.user || null });
});

// Register POST
app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  // Add your own validation here
  if (!email || !password) {
    return res.redirect('/register');
  }

  try {
    const existing = await findUserByEmail(email);
    if (existing) {
      return res.redirect('/register');
    }

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (email, password_hash, created_at)
       VALUES ($1, $2, NOW())`,
      [email, hash]
    );
    res.redirect('/login');
  } catch (err) {
    console.error('Error registering user:', err.message);
    res.redirect('/register');
  }
});
/*
// Google auth
app.get(
  '/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get(
  '/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    res.redirect('/drive');
  }
);
*/
// Logout
app.post('/logout', (req, res, next) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    req.session.destroy(() => {
      res.redirect('/login');
    });
  });
});

// Drive page (protected) + visit logging
app.get('/drive', ensureAuthenticated, logVisit, (req, res) => {
  res.render('drive', {
    user: req.user,
    mapsApiKey: process.env.MAPS_API_KEY, // used in EJS to load Google Maps script [web:14]
  });
});

// Example API for cameras (fill later)
app.get('/api/cameras', ensureAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, latitude, longitude, limit_kmh
       FROM speed_cameras
       WHERE is_active = true
       ORDER BY id ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching cameras:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Example API for saving segments (average speeds)
app.post('/api/segments', ensureAuthenticated, async (req, res) => {
  const {
    firstCameraId,
    secondCameraId,
    avgSpeedKmh,
    startedAt,
    finishedAt,
  } = req.body;

  try {
    const cameras = await pool.query(
      'SELECT id, name FROM speed_cameras WHERE id = ANY($1::int[])',
      [[firstCameraId, secondCameraId]]
    );
    const map = new Map();
    cameras.rows.forEach((c) => map.set(c.id, c.name));

    const firstName = map.get(Number(firstCameraId)) || null;
    const secondName = map.get(Number(secondCameraId)) || null;

    await pool.query(
      `INSERT INTO segments
        (user_id, first_camera_id, second_camera_id,
         first_camera_name, second_camera_name,
         avg_speed_kmh, started_at, finished_at, created_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, NOW())`,
      [
        req.user.id,
        firstCameraId,
        secondCameraId,
        firstName,
        secondName,
        avgSpeedKmh,
        startedAt,
        finishedAt,
      ]
    );

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Error saving segment:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- Start server ----------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
