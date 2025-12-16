import dotenv from 'dotenv';
dotenv.config();
import https from 'node:https';
import fs from 'node:fs';
import express from 'express';
import path from 'node:path';
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
const pool = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: Number(process.env.PG_PORT),
});

// ---------- Express basic setup ----------
app.set('view engine', 'ejs');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Sessions ----------
app.set('trust proxy', 1);
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
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);

// ---------- Passport ----------
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

// Local strategy
passport.use(
  new LocalStrategy(
    { usernameField: 'email', passwordField: 'password' },
    async (email, password, done) => {
      try {
        const user = await findUserByEmail(email);
        if (!user) return done(null, false, { message: 'Incorrect email or password.' });
        if (!user.password_hash) return done(null, false, { message: 'Use social login for this account.' });
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return done(null, false, { message: 'Incorrect email or password.' });
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);

// Google strategy (currently commented — uncomment when ready)
/*
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      // your Google logic here
    }
  )
);
*/

// Serialize / deserialize
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await findUserById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// ---------- Auth helper ----------
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  res.redirect('/login');
}

// ---------- Logging visits ----------
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
app.get('/', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) return res.redirect('/drive');
  res.redirect('/login');
});

app.get('/login', (req, res) => res.render('login', { user: req.user || null }));

app.post('/login',
  passport.authenticate('local', {
    successRedirect: '/drive',
    failureRedirect: '/login',
  })
);

app.get('/register', (req, res) => res.render('register', { user: req.user || null }));

app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.redirect('/register');
  try {
    const existing = await findUserByEmail(email);
    if (existing) return res.redirect('/register');
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (email, password_hash, created_at) VALUES ($1, $2, NOW())`,
      [email, hash]
    );
    res.redirect('/login');
  } catch (err) {
    console.error('Error registering user:', err.message);
    res.redirect('/register');
  }
});

app.post('/logout', (req, res, next) => {
  req.logout(function (err) {
    if (err) return next(err);
    req.session.destroy(() => res.redirect('/login'));
  });
});

app.get('/drive', ensureAuthenticated, logVisit, (req, res) => {
  res.render('drive', { user: req.user, mapsApiKey: process.env.GOOGLE_MAPS_API_KEY });
});

// API: cameras – NOW WITH BOTH RADII
app.get('/api/cameras', ensureAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        name,
        latitude,
        longitude,
        limit_kmh,
        COALESCE(detection_radius_m, 60) AS detection_radius_m,
        COALESCE(warning_radius_m, 350) AS warning_radius_m
      FROM speed_cameras
      WHERE is_active = true
      ORDER BY id ASC
    `);

    const cameras = result.rows.map(cam => ({
      ...cam,
      detection_radius_m: cam.detection_radius_m || 60,
      warning_radius_m:    cam.warning_radius_m    || 350,
    }));

    res.json(cameras);
  } catch (err) {
    console.error('Error fetching cameras:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// API: save segment
app.post('/api/segments', ensureAuthenticated, async (req, res) => {
  const { firstCameraId, secondCameraId, avgSpeedKmh, startedAt, finishedAt } = req.body;
  try {
    // Fetch camera names
    const firstCamResult = await pool.query(
      'SELECT id, name FROM speed_cameras WHERE id = $1',
      [firstCameraId]
    );
    const secondCamResult = await pool.query(
      'SELECT id, name FROM speed_cameras WHERE id = $1',
      [secondCameraId]
    );

    const firstName = firstCamResult.rows[0]?.name || null;
    const secondName = secondCamResult.rows[0]?.name || null;

    console.log('Saving segment:', {
      userId: req.user.id,
      firstCameraId,
      secondCameraId,
      firstName,
      secondName,
      avgSpeedKmh,
      startedAt,
      finishedAt,
    });

    await pool.query(
      `INSERT INTO segments
        (user_id, first_camera_id, second_camera_id,
         first_camera_name, second_camera_name,
         average_speed_kmh, started_at, finished_at, created_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
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

    console.log('Segment saved successfully');
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Error saving segment:', err.message);
    console.error('Full error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/history', ensureAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        first_camera_name,
        second_camera_name,
        average_speed_kmh,
        finished_at
       FROM segments
       WHERE user_id = $1
       ORDER BY finished_at DESC`,
      [req.user.id]
    );

    const segments = result.rows;
    res.render('history', { user: req.user, segments });
  } catch (err) {
    console.error('Error fetching segments:', err.message);
    res.status(500).render('history', { user: req.user, segments: [], error: 'Failed to load history' });
  }
});


// ---------- Admin helper ----------
function ensureAdmin(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.redirect('/login');
  }
  if (req.user.acc_type !== 2) {
    return res.redirect('/drive');
  }
  next();
}


// ---------- Admin Dashboard ----------
app.get('/admin/dashboard', ensureAdmin, async (req, res) => {
  try {
    // Total users
    const totalUsersResult = await pool.query('SELECT COUNT(*) as count FROM users');
    const totalUsers = parseInt(totalUsersResult.rows[0].count);

    // Paid users
    const paidUsersResult = await pool.query('SELECT COUNT(*) as count FROM users WHERE acc_type = 1');
    const paidUsers = parseInt(paidUsersResult.rows[0].count);

    // Free users
    const freeUsersResult = await pool.query('SELECT COUNT(*) as count FROM users WHERE acc_type = 0');
    const freeUsers = parseInt(freeUsersResult.rows[0].count);

    // Total official segments
    const totalSegmentsResult = await pool.query('SELECT COUNT(*) as count FROM official_segments');
    const totalSegments = parseInt(totalSegmentsResult.rows[0].count);

    // Total cameras
    const totalCamerasResult = await pool.query('SELECT COUNT(*) as count FROM speed_cameras');
    const totalCameras = parseInt(totalCamerasResult.rows[0].count);

    const stats = {
      totalUsers,
      paidUsers,
      freeUsers,
      totalSegments,
      totalCameras,
    };

    res.render('admin/dashboard', { user: req.user, stats, error: null });
  } catch (err) {
    console.error('Error fetching admin stats:', err.message);
    res.status(500).render('admin/dashboard', { user: req.user, stats: {}, error: 'Failed to load statistics' });
  }
});




// ---------- Admin Segments ----------
app.get('/admin/segments', ensureAdmin, async (req, res) => {
  res.render('admin/segments', { user: req.user });
});

// ---------- Camera Management APIs ----------

// GET all cameras
app.get('/api/admin/cameras', ensureAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, latitude, longitude, limit_kmh, is_active, detection_radius_m, warning_radius_m
       FROM speed_cameras
       ORDER BY name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching cameras:', err.message);
    res.status(500).json({ error: 'Failed to fetch cameras' });
  }
});

// POST - Create new camera
app.post('/api/admin/cameras', ensureAdmin, async (req, res) => {
  const { name, latitude, longitude, limit_kmh, is_active, detection_radius_m, warning_radius_m } = req.body;
  
  try {
    if (!name || latitude === undefined || longitude === undefined || !limit_kmh) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await pool.query(
      `INSERT INTO speed_cameras (name, latitude, longitude, limit_kmh, is_active, detection_radius_m, warning_radius_m)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, latitude, longitude, limit_kmh, is_active, detection_radius_m, warning_radius_m`,
      [name, latitude, longitude, limit_kmh, is_active || false, detection_radius_m || 60, warning_radius_m || 350]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error creating camera:', err.message);
    res.status(500).json({ error: 'Failed to create camera' });
  }
});

// PUT - Update camera
app.put('/api/admin/cameras/:id', ensureAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, latitude, longitude, limit_kmh, is_active, detection_radius_m, warning_radius_m } = req.body;
  
  try {
    if (!name || latitude === undefined || longitude === undefined || !limit_kmh) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await pool.query(
      `UPDATE speed_cameras 
       SET name = $1, latitude = $2, longitude = $3, limit_kmh = $4, is_active = $5, detection_radius_m = $6, warning_radius_m = $7
       WHERE id = $8
       RETURNING id, name, latitude, longitude, limit_kmh, is_active, detection_radius_m, warning_radius_m`,
      [name, latitude, longitude, limit_kmh, is_active || false, detection_radius_m || 60, warning_radius_m || 350, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Camera not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating camera:', err.message);
    res.status(500).json({ error: 'Failed to update camera' });
  }
});

// DELETE camera
app.delete('/api/admin/cameras/:id', ensureAdmin, async (req, res) => {
  const { id } = req.params;
  
  try {
    // Delete all official segments that use this camera
    await pool.query(
      'DELETE FROM official_segments WHERE first_camera_id = $1 OR second_camera_id = $1',
      [id]
    );

    // Delete the camera
    const result = await pool.query('DELETE FROM speed_cameras WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Camera not found' });
    }

    res.json({ success: true, message: 'Camera deleted' });
  } catch (err) {
    console.error('Error deleting camera:', err.message);
    res.status(500).json({ error: 'Failed to delete camera: ' + err.message });
  }
});



// ---------- Official Segments APIs ----------

// GET all official segments
app.get('/api/admin/segments', ensureAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        os.id,
        os.first_camera_id,
        os.second_camera_id,
        os.speed_limit,
        os.created_at,
        c1.name as first_camera_name,
        c2.name as second_camera_name
       FROM official_segments os
       JOIN speed_cameras c1 ON os.first_camera_id = c1.id
       JOIN speed_cameras c2 ON os.second_camera_id = c2.id
       ORDER BY os.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching segments:', err.message);
    res.status(500).json({ error: 'Failed to fetch segments' });
  }
});

// POST - Create new official segment
app.post('/api/admin/segments', ensureAdmin, async (req, res) => {
  const { first_camera_id, second_camera_id, speed_limit } = req.body;
  
  try {
    if (!first_camera_id || !second_camera_id || !speed_limit) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (first_camera_id === second_camera_id) {
      return res.status(400).json({ error: 'Cannot select the same camera twice' });
    }

    const result = await pool.query(
      `INSERT INTO official_segments (first_camera_id, second_camera_id, speed_limit)
       VALUES ($1, $2, $3)
       RETURNING id, first_camera_id, second_camera_id, speed_limit, created_at`,
      [first_camera_id, second_camera_id, speed_limit]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error creating segment:', err.message);
    res.status(500).json({ error: 'Failed to create segment' });
  }
});

// PUT - Update official segment
app.put('/api/admin/segments/:id', ensureAdmin, async (req, res) => {
  const { id } = req.params;
  const { first_camera_id, second_camera_id, speed_limit } = req.body;
  
  try {
    if (!first_camera_id || !second_camera_id || !speed_limit) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (first_camera_id === second_camera_id) {
      return res.status(400).json({ error: 'Cannot select the same camera twice' });
    }

    const result = await pool.query(
      `UPDATE official_segments 
       SET first_camera_id = $1, second_camera_id = $2, speed_limit = $3
       WHERE id = $4
       RETURNING id, first_camera_id, second_camera_id, speed_limit, created_at`,
      [first_camera_id, second_camera_id, speed_limit, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Segment not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating segment:', err.message);
    res.status(500).json({ error: 'Failed to update segment' });
  }
});

// DELETE official segment
app.delete('/api/admin/segments/:id', ensureAdmin, async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query('DELETE FROM official_segments WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Segment not found' });
    }

    res.json({ success: true, message: 'Segment deleted' });
  } catch (err) {
    console.error('Error deleting segment:', err.message);
    res.status(500).json({ error: 'Failed to delete segment' });
  }
});

// Check if official segment exists
app.get('/api/check-segment', ensureAuthenticated, async (req, res) => {
  const { first, second } = req.query;
  
  try {
    if (!first || !second) {
      return res.json({ exists: false });
    }

    const result = await pool.query(
      'SELECT id FROM official_segments WHERE first_camera_id = $1 AND second_camera_id = $2 LIMIT 1',
      [first, second]
    );

    res.json({ exists: result.rows.length > 0 });
  } catch (err) {
    console.error('Error checking segment:', err.message);
    res.json({ exists: false });
  }
});


// ---------- HTTPS Server ----------
const PORT = process.env.PORT || 3030;
const options = {
  key: fs.readFileSync(path.join(__dirname, 'public.key')),
  cert: fs.readFileSync(path.join(__dirname, 'public.crt'))
};

https.createServer(options, app).listen(PORT, () => {
  console.log(`HTTPS Server running on https://167.172.161.174:${PORT}`);
});
