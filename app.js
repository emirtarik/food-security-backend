// app.js
const express = require('express');
const sql = require('mssql');
const { diagnosticsRouter } = require('./diagnostics');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');



// Load .env locally (Azure uses App Settings, so this won't run there)
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (_) {}
}

const app = express();

// Behind IIS/ARR we need this for secure cookies, proper IPs, etc.
app.set('trust proxy', 1);

app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - t0;
    console.log(`[RT] ${req.method} ${req.originalUrl} -> ${res.statusCode} in ${ms}ms`);
  });
  next();
});


// ---- Diagnostics (liveness, env, db) ----
app.use('/_diag', diagnosticsRouter());

// ---- Request logging (sanitized) ----
app.use((req, res, next) => {
  console.log('=== Incoming Request ===');
  console.log(`${req.method} ${req.url}`);
  console.log('Origin:', req.get('Origin'));
  // Do NOT log bodies that may contain secrets
  next();
});

// ---- CORS ----
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5001',
  'https://food-security-front.azurewebsites.net',
  'https://food-security-back.azurewebsites.net',
  'https://food-security.net',
  'https://www.food-security.net'
];

const corsOptions = {
  origin(origin, cb) {
    // allow non-browser tools (no Origin) and known origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true, // <-- sets Access-Control-Allow-Credentials: true
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'Cache-Control'
  ],
  maxAge: 86400,
};

app.use(cors(corsOptions));
// Make sure preflights are handled universally
app.options('*', cors(corsOptions));

app.use('/login', rateLimit({
  windowMs: 15*60*1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  // don't count or block preflights
  skip: (req) => req.method === 'OPTIONS'
}));


app.use(express.json());

// ---- Root + test routes ----
app.get('/', (req, res) => {
  const origin = req.get('Origin');
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  res.json({ message: 'Backend is running', timestamp: new Date().toISOString() });
});

app.get('/test-cors', (req, res) => {
  const origin = req.get('Origin');
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  res.json({
    message: 'CORS test successful',
    timestamp: new Date().toISOString(),
    origin
  });
});

// ---- Data download logging ----
const downloadLogLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS'
});

app.post('/download-requests', downloadLogLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const required = ['email', 'firstName', 'lastName', 'country', 'organisation', 'stakeholder'];
    for (const k of required) {
      if (!body[k] || String(body[k]).trim() === '') {
        return res.status(400).json({ message: `Missing required field: ${k}` });
      }
    }

    const pool = await getPool();
    await pool.request()
      .input('email', sql.VarChar, body.email)
      .input('firstName', sql.NVarChar, body.firstName)
      .input('lastName', sql.NVarChar, body.lastName)
      .input('country', sql.NVarChar, body.country)
      .input('organisation', sql.NVarChar, body.organisation)
      .input('stakeholder', sql.NVarChar, body.stakeholder)
      .input('usage', sql.NVarChar, body.usage || null)
      .input('language', sql.VarChar, body.language || null)
      .input('ipAddress', sql.VarChar, (req.ip || '').toString())
      .input('userAgent', sql.NVarChar, req.get('user-agent') || null)
      .query(`INSERT INTO dbo.DataDownloadRequests
              (email, firstName, lastName, country, organisation, stakeholder, usage, language, ipAddress, userAgent)
              VALUES (@email, @firstName, @lastName, @country, @organisation, @stakeholder, @usage, @language, @ipAddress, @userAgent)`);

    return res.json({ ok: true });
  } catch (err) {
    console.error('Error logging download request:', err);
    return res.status(500).json({ ok: false, message: 'Failed to log download request' });
  }
});

function loadDbCa() {
  const p = process.env.DB_CA_PEM_PATH
    ? path.resolve(__dirname, process.env.DB_CA_PEM_PATH) // __dirname-safe
    : null;

  if (!p || !fs.existsSync(p)) {
    console.warn('DB_CA_PEM_PATH not set or file not found:', p);
    return undefined;
  }
  try {
    const pem = fs.readFileSync(p, 'utf8');
    // quick sanity check: don't print the whole cert, just length
    console.log('Loaded DB CA PEM, bytes:', Buffer.byteLength(pem, 'utf8'));
    return pem;
  } catch (e) {
    console.error('Failed reading DB CA PEM:', e.message);
    return undefined;
  }
}

const caPem = loadDbCa();

const sqlConfig = {
  server: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  options: {
    encrypt: true,
    // keep strict in prod; allow local toggle only if needed
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true',
    // give Node the CA so it can build the chain
    cryptoCredentialsDetails: caPem ? { ca: [caPem] } : undefined,
    // ensure SNI / hostname check matches
    serverName: process.env.DB_HOST
  },
  pool: { max: 5, min: 1, idleTimeoutMillis: 30000 },

  connectionTimeout: 8000,
  requestTimeout: 15000,
};

// Reuse a single connection pool
let poolPromise;
async function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(sqlConfig)
      .connect()
      .then(p => {
        console.log('✅ MSSQL connected');
        return p;
      })
      .catch(err => {
        console.error('❌ MSSQL connection error:', err);
        poolPromise = null; // allow retry on next call
        throw err;
      });
  }
  return poolPromise;
}

// ---- Auth: /login ----
// NOTE: For production, store hashed passwords and compare with bcrypt.

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
const PEPPER = process.env.PASSWORD_PEPPER || '';

// Precompute a dummy hash at startup for timing-equalization when user not found
const DUMMY_HASH = bcrypt.hashSync('dummy-password', BCRYPT_ROUNDS);

app.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ message: 'Missing credentials' });
  }

  console.log(`Received login request for username: ${username}`);

  try {
    const pool = await getPool();

    // Fetch only what you need
    const result = await pool
      .request()
      .input('username', sql.VarChar, username)
      .query('SELECT country, role, password FROM Users WHERE username = @username');

    const user = result.recordset[0];

    if (!user) {
      // Do a dummy compare to keep timing similar whether user exists or not
      await bcrypt.compare(password + PEPPER, DUMMY_HASH);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const stored = user.password || '';
    const looksBcrypt = /^\$2[aby]\$[0-9]{2}\$/.test(stored);

    let ok = false;

    if (looksBcrypt) {
      // Normal path: compare against bcrypt hash
      ok = await bcrypt.compare(password + PEPPER, stored);
    } else {
      // Legacy path: DB stored plaintext (or other scheme)
      ok = stored === password;
      if (ok) {
        // Seamless, one-time upgrade to bcrypt
        const newHash = await bcrypt.hash(password + PEPPER, BCRYPT_ROUNDS);
        try {
          await pool
            .request()
            .input('username', sql.VarChar, username)
            .input('hash', sql.VarChar, newHash)
            .query('UPDATE Users SET password = @hash WHERE username = @username');
          console.log(`Upgraded password hash for ${username}`);
        } catch (e) {
          // If the upgrade fails, still let the login succeed; log the error for later fix
          console.error('Password upgrade failed:', e);
        }
      }
    }

    if (!ok) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Success — return what you already return
    return res.status(200).json({
      message: 'Login successful',
      country: user.country,
      role: user.role
    });

  } catch (error) {
    console.error('Error during login:', error);
    return res.status(500).json({ message: 'Login failed' });
  }
});



// ---- Submit (section) ----
app.post('/submit', async (req, res) => {
  const {
    country,
    role,
    year,
    month,
    responses,
    comments,
    questionComments,
    performanceScore,
    financingNeed,
    financingMobilized,
    actionPlanPerQuestion,
    savedActionPlans,
    submitted
  } = req.body;

  console.log('Received submission:', { country, role, year, month, submitted });

  try {
    const pool = await getPool();

    const existing = await pool
      .request()
      .input('country', sql.VarChar, country)
      .input('role', sql.VarChar, role)
      .input('year', sql.VarChar, year)
      .input('month', sql.VarChar, month)
      .query(
        'SELECT * FROM Submissions WHERE country = @country AND role = @role AND year = @year AND month = @month'
      );

    if (existing.recordset.length > 0) {
      await pool
        .request()
        .input('responses', sql.NVarChar, JSON.stringify(responses))
        .input('comments', sql.NVarChar, comments)
        .input('questionComments', sql.NVarChar, JSON.stringify(questionComments))
        .input('performanceScore', sql.VarChar, performanceScore)
        .input('financingNeed', sql.VarChar, financingNeed)
        .input('financingMobilized', sql.VarChar, financingMobilized)
        .input('actionPlanPerQuestion', sql.NVarChar, JSON.stringify(actionPlanPerQuestion))
        .input('savedActionPlans', sql.NVarChar, JSON.stringify(savedActionPlans))
        .input('submitted', sql.Bit, submitted)
        .input('country', sql.VarChar, country)
        .input('role', sql.VarChar, role)
        .input('year', sql.VarChar, year)
        .input('month', sql.VarChar, month)
        .query(`
          UPDATE Submissions 
          SET 
            responses = @responses, 
            comments = @comments, 
            questionComments = @questionComments, 
            performanceScore = @performanceScore, 
            financingNeed = @financingNeed, 
            financingMobilized = @financingMobilized, 
            actionPlanPerQuestion = @actionPlanPerQuestion,
            savedActionPlans = @savedActionPlans,
            submitted = @submitted
          WHERE country = @country AND role = @role AND year = @year AND month = @month
        `);
    } else {
      await pool
        .request()
        .input('country', sql.VarChar, country)
        .input('role', sql.VarChar, role)
        .input('year', sql.VarChar, year)
        .input('month', sql.VarChar, month)
        .input('responses', sql.NVarChar, JSON.stringify(responses))
        .input('comments', sql.NVarChar, comments)
        .input('questionComments', sql.NVarChar, JSON.stringify(questionComments))
        .input('performanceScore', sql.VarChar, performanceScore)
        .input('financingNeed', sql.VarChar, financingNeed)
        .input('financingMobilized', sql.VarChar, financingMobilized)
        .input('actionPlanPerQuestion', sql.NVarChar, JSON.stringify(actionPlanPerQuestion))
        .input('savedActionPlans', sql.NVarChar, JSON.stringify(savedActionPlans))
        .input('submitted', sql.Bit, submitted)
        .query(`
          INSERT INTO Submissions 
            (country, role, year, month, responses, comments, questionComments, performanceScore, financingNeed, financingMobilized, actionPlanPerQuestion, savedActionPlans, submitted)
          VALUES 
            (@country, @role, @year, @month, @responses, @comments, @questionComments, @performanceScore, @financingNeed, @financingMobilized, @actionPlanPerQuestion, @savedActionPlans, @submitted)
        `);
    }

    console.log(`Submission saved/updated for ${country} / ${role} / ${year}-${month}`);
    res.status(200).send('Responses saved/updated in the database');
  } catch (error) {
    console.error('Error saving submission:', error);
    res.status(500).send('Error saving submission');
  }
});

// ---- Submit master ----
app.post('/submit-master', async (req, res) => {
  const {
    country,
    role,
    year,
    month,
    responses,
    comments,
    questionComments,
    performanceScore,
    financingNeed,
    financingMobilized,
    actionPlanPerQuestion,
    savedActionPlans,
    submitted
  } = req.body;

  console.log('Received master submission:', { country, role, year, month, submitted });

  try {
    const pool = await getPool();

    const existing = await pool
      .request()
      .input('country', sql.VarChar, country)
      .input('role', sql.VarChar, role)
      .input('year', sql.VarChar, year)
      .input('month', sql.VarChar, month)
      .query(
        'SELECT * FROM Submissions WHERE country = @country AND role = @role AND year = @year AND month = @month'
      );

    if (existing.recordset.length > 0) {
      await pool
        .request()
        .input('responses', sql.NVarChar, JSON.stringify(responses))
        .input('comments', sql.NVarChar, comments)
        .input('questionComments', sql.NVarChar, JSON.stringify(questionComments))
        .input('performanceScore', sql.Float, performanceScore)
        .input('financingNeed', sql.BigInt, financingNeed)
        .input('financingMobilized', sql.Float, financingMobilized)
        .input('actionPlanPerQuestion', sql.NVarChar, JSON.stringify(actionPlanPerQuestion))
        .input('savedActionPlans', sql.NVarChar, JSON.stringify(savedActionPlans))
        .input('submitted', sql.Bit, submitted)
        .input('country', sql.VarChar, country)
        .input('role', sql.VarChar, role)
        .input('year', sql.VarChar, year)
        .input('month', sql.VarChar, month)
        .query(`
          UPDATE Submissions 
          SET 
            responses = @responses, 
            comments = @comments, 
            questionComments = @questionComments, 
            performanceScore = @performanceScore, 
            financingNeed = @financingNeed, 
            financingMobilized = @financingMobilized, 
            actionPlanPerQuestion = @actionPlanPerQuestion,
            savedActionPlans = @savedActionPlans,
            submitted = @submitted
          WHERE country = @country AND role = @role AND year = @year AND month = @month
        `);
    } else {
      await pool
        .request()
        .input('country', sql.VarChar, country)
        .input('role', sql.VarChar, role)
        .input('year', sql.VarChar, year)
        .input('month', sql.VarChar, month)
        .input('responses', sql.NVarChar, JSON.stringify(responses))
        .input('comments', sql.NVarChar, comments)
        .input('questionComments', sql.NVarChar, JSON.stringify(questionComments))
        .input('performanceScore', sql.Float, performanceScore)
        .input('financingNeed', sql.BigInt, financingNeed)
        .input('financingMobilized', sql.Float, financingMobilized)
        .input('actionPlanPerQuestion', sql.NVarChar, JSON.stringify(actionPlanPerQuestion))
        .input('savedActionPlans', sql.NVarChar, JSON.stringify(savedActionPlans))
        .input('submitted', sql.Bit, submitted)
        .query(`
          INSERT INTO Submissions 
            (country, role, year, month, responses, comments, questionComments, performanceScore, financingNeed, financingMobilized, actionPlanPerQuestion, savedActionPlans, submitted)
          VALUES 
            (@country, @role, @year, @month, @responses, @comments, @questionComments, @performanceScore, @financingNeed, @financingMobilized, @actionPlanPerQuestion, @savedActionPlans, @submitted)
        `);
    }

    console.log(`Master submission saved/updated for ${country} / ${role} / ${year}-${month}`);
    res.status(200).send('Master responses saved/updated in the database');
  } catch (error) {
    console.error('Error saving master submission:', error);
    res.status(500).send('Error saving master submission');
  }
});


// ---- Utility lookups ----
app.get('/available-countries', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`SELECT DISTINCT country FROM Submissions`);
    const countries = result.recordset.map(row => row.country);
    res.json(countries);
  } catch (error) {
    console.error('Error fetching available countries:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/available-months', async (req, res) => {
  const { country, year } = req.query;
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('country', sql.VarChar, country)
      .input('year', sql.VarChar, year)
      .query(`
        SELECT DISTINCT month 
        FROM Submissions 
        WHERE country = @country AND year = @year
      `);
  const months = result.recordset.map(row => row.month);
  res.json(months);
  } catch (error) {
    console.error('Error fetching available months:', error);
    res.status(500).send('Error fetching available months');
  }
});

app.get('/responses', async (req, res) => {
  const { country, year, month, role } = req.query;
  console.log('Received request with:', { country, year, month, role });

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('country', sql.VarChar, country)
      .input('year', sql.VarChar, year)
      .input('month', sql.VarChar, month)
      .input('role', sql.VarChar, role)
      .query(
        'SELECT * FROM Submissions WHERE country = @country AND year = @year AND month = @month AND role = @role'
      );

    const submissions = result.recordset;

    if (submissions.length === 0) {
      return res.status(200).json({});
    }

    const submission = submissions[0];

    // Parse helpers
    const safeParse = (s, fallback) => {
      try { return s ? JSON.parse(s) : fallback; }
      catch { return fallback; }
    };

    const responseData = {
      responses: safeParse(submission.responses, {}),
      submitted: submission.submitted,
      comments: safeParse(submission.comments, ''),
      questionComments: safeParse(submission.questionComments, {}),
      performanceScore: submission.performanceScore || 0,
      financingNeed: submission.financingNeed || 0,
      financingMobilized: submission.financingMobilized || 0,
      actionPlanPerQuestion: safeParse(submission.actionPlanPerQuestion, {}),
      savedActionPlans: safeParse(submission.savedActionPlans, {}),
      actionPlan: safeParse(submission.actionPlan, [])
    };

    console.log('Sending response data');
    res.json(responseData);
  } catch (error) {
    console.error('Error fetching stored responses:', error);
    res.status(500).send('Error fetching stored responses');
  }
});

app.get('/master-responses', async (req, res) => {
  const { country, year, month } = req.query;

  if (!country || !year || !month) {
    return res.status(400).json({ error: 'country, year, and month are required' });
  }

  console.log('Received /master-responses request with:', { country, year, month });

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('country', sql.VarChar, country)
      .input('year', sql.VarChar, year)
      .input('month', sql.VarChar, month)
      .query(`
        SELECT * FROM Submissions 
        WHERE country = @country 
          AND year = @year 
          AND month = @month
          AND role IN ('section1', 'section2', 'section3', 'section4')
      `);

    const submissions = result.recordset;

    const aggregatedData = {
      section1: { responses: {}, comments: {}, questionComments: {}, actionPlans: {}, savedActionPlans: {}, submitted: false },
      section2: { responses: {}, comments: {}, questionComments: {}, actionPlans: {}, savedActionPlans: {}, submitted: false },
      section3: { responses: {}, comments: {}, questionComments: {}, actionPlans: {}, savedActionPlans: {}, submitted: false },
      section4: { responses: {}, comments: {}, questionComments: {}, actionPlans: {}, savedActionPlans: {}, submitted: false }
    };

    submissions.forEach(submission => {
      const role = submission.role;
      if (!aggregatedData[role]) return;

      const safeParse = (s, fallback) => {
        try { return s ? JSON.parse(s) : fallback; }
        catch { return fallback; }
      };

      aggregatedData[role].responses = { ...aggregatedData[role].responses, ...safeParse(submission.responses, {}) };
      aggregatedData[role].comments = { ...aggregatedData[role].comments, ...safeParse(submission.comments, {}) };
      aggregatedData[role].questionComments = { ...aggregatedData[role].questionComments, ...safeParse(submission.questionComments, {}) };
      aggregatedData[role].actionPlans = { ...aggregatedData[role].actionPlans, ...safeParse(submission.actionPlanPerQuestion, {}) };
      aggregatedData[role].savedActionPlans = { ...aggregatedData[role].savedActionPlans, ...safeParse(submission.savedActionPlans, {}) };
      aggregatedData[role].submitted = submission.submitted === true;
    });

    res.json(aggregatedData);
  } catch (error) {
    console.error('Error fetching master responses:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/dashboard-responses', async (req, res) => {
  const { country, year, month } = req.query;
  console.log('Received dashboard request with:', { country, year, month });

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('country', sql.VarChar, country)
      .input('year', sql.VarChar, year)
      .input('month', sql.VarChar, month)
      .query(`
        SELECT
          responses,
          savedActionPlans,
          questionComments,
          performanceScore,
          financingNeed,
          financingMobilized
        FROM Submissions
        WHERE country = @country
          AND year    = @year
          AND month   = @month
      `);

    const submissions = result.recordset;

    if (submissions.length === 0) {
      return res.status(200).json({
        responses: {},
        savedActionPlans: {},
        questionComments: {},
        performanceScore: 0,
        financingNeed: 0,
        financingMobilized: 0
      });
    }

    const safeParse = (s, fallback) => {
      try { return s ? JSON.parse(s) : fallback; }
      catch { return fallback; }
    };

    const cumulativeResponses = submissions.reduce((acc, s) => ({ ...acc, ...safeParse(s.responses, {}) }), {});
    const cumulativeSavedActionPlans = submissions.reduce((acc, s) => {
      const parsed = safeParse(s.savedActionPlans, {});
      for (const [k, plans] of Object.entries(parsed)) acc[k] = (acc[k] || []).concat(plans);
      return acc;
    }, {});
    const cumulativeQuestionComments = submissions.reduce((acc, s) => ({ ...acc, ...safeParse(s.questionComments, {}) }), {});

    const { performanceScore: rawPerf, financingNeed: rawNeed, financingMobilized: rawMob } = submissions[0];
    const performanceScore   = rawPerf != null ? parseFloat(rawPerf) : 0;
    const financingNeed      = rawNeed != null ? parseFloat(rawNeed) : 0;
    const financingMobilized = rawMob != null ? parseFloat(rawMob) : 0;

    return res.json({
      responses: cumulativeResponses,
      savedActionPlans: cumulativeSavedActionPlans,
      questionComments: cumulativeQuestionComments,
      performanceScore,
      financingNeed,
      financingMobilized
    });
  } catch (error) {
    console.error('Error fetching dashboard responses:', error);
    return res.status(500).send('Error fetching dashboard responses');
  }
});

// ---- Projects CRUD ----
app.post('/projects', async (req, res) => {
  try {
    const body = req.body || {};

    const required = ['country', 'admin1', 'title'];
    for (const k of required) {
      if (!body[k] || String(body[k]).trim() === '') {
        return res.status(400).json({ message: `Missing required field: ${k}` });
      }
    }

    const categoriesJson = JSON.stringify(body.categories || {});

    const pool = await getPool();
    await pool
      .request()
      .input('country',            sql.VarChar,        body.country)
      .input('admin1',             sql.VarChar,        body.admin1)
      .input('donor',              sql.VarChar,        body.donor || null)
      .input('title',              sql.NVarChar,       body.title)
      .input('status',             sql.VarChar,        body.status || null)
      .input('fundingAgency',      sql.VarChar,        body.fundingAgency || null)
      .input('implementingAgency', sql.VarChar,        body.implementingAgency || null)
      .input('recipient',          sql.VarChar,        body.recipient || null)
      .input('zone',               sql.VarChar,        body.zone || null)
      .input('start',              sql.Int,            body.start ? parseInt(body.start, 10) : null)
      .input('end',                sql.Int,            body.end ? parseInt(body.end, 10) : null)
      .input('currency',           sql.VarChar,        body.currency || null)
      .input('budget',             sql.Decimal(18,2),  body.budget !== undefined && body.budget !== null && body.budget !== '' ? Number(body.budget) : null)
      .input('budgetUSD',          sql.Decimal(18,2),  body.budgetUSD !== undefined && body.budgetUSD !== null && body.budgetUSD !== '' ? Number(body.budgetUSD) : null)
      .input('link',               sql.NVarChar,       body.link || null)
      .input('img',                sql.NVarChar,       body.img || null)
      .input('comments',           sql.NVarChar,       body.comments || null)
      .input('topic',              sql.NVarChar,       body.topic || null)
      .input('categoriesJson',     sql.NVarChar,       categoriesJson)
      .input('createdBy',          sql.VarChar,        body.createdBy || null)
      .query(`
        INSERT INTO dbo.Projects (
          country, admin1, donor, title, status, fundingAgency, implementingAgency, recipient, zone,
          [start], [end], currency, budget, budgetUSD, [link], img, comments, topic, categoriesJson, createdBy
        ) VALUES (
          @country, @admin1, @donor, @title, @status, @fundingAgency, @implementingAgency, @recipient, @zone,
          @start, @end, @currency, @budget, @budgetUSD, @link, @img, @comments, @topic, @categoriesJson, @createdBy
        );
      `);

    return res.status(201).json({ message: 'Project created' });
  } catch (err) {
    console.error('Error creating project:', err);
    return res.status(500).json({ message: 'Error creating project' });
  }
});

// Update project categories (merge with existing; locked trues stay true)
app.put('/projects/:id', async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const userCats = body.categories || {};
  if (!id) return res.status(400).json({ message: 'Missing id' });

  try {
    const pool = await getPool();
    // fetch existing categoriesJson
    const current = await pool
      .request()
      .input('id', sql.Int, parseInt(id, 10))
      .query('SELECT categoriesJson FROM dbo.Projects WHERE id = @id');

    if (current.recordset.length === 0) {
      return res.status(404).json({ message: 'Not found' });
    }

    const raw = current.recordset[0].categoriesJson;
    let baseCats = {};
    try { baseCats = raw ? JSON.parse(raw) : {}; } catch { baseCats = {}; }

    // merge: locked trues preserved; otherwise take user value (default false)
    const labels = new Set([
      ...Object.keys(baseCats || {}),
      ...Object.keys(userCats || {})
    ]);
    const merged = {};
    labels.forEach(label => {
      merged[label] = baseCats[label] === true ? true : !!userCats[label];
    });

    await pool
      .request()
      .input('id', sql.Int, parseInt(id, 10))
      .input('categoriesJson', sql.NVarChar, JSON.stringify(merged))
      .query('UPDATE dbo.Projects SET categoriesJson = @categoriesJson WHERE id = @id');

    return res.status(200).json({ id: parseInt(id, 10), categoriesJson: merged });
  } catch (err) {
    console.error('Error updating project categories:', err);
    return res.status(500).json({ message: 'Error updating project' });
  }
});

// Quick verification endpoint (optional)
app.get('/projects', async (req, res) => {
  const { country, admin1 } = req.query;
  try {
    const pool = await getPool();
    const request = pool.request();
    if (country) request.input('country', sql.VarChar, country);
    if (admin1) request.input('admin1', sql.VarChar, admin1);
    const where = [
      country ? 'country = @country' : null,
      admin1 ? 'admin1 = @admin1' : null
    ].filter(Boolean).join(' AND ');
    const sqlText = `SELECT TOP 50 id, country, admin1, title, status, categoriesJson, createdAt, createdBy FROM dbo.Projects ${where ? 'WHERE ' + where : ''} ORDER BY id DESC`;
    const result = await request.query(sqlText);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching projects:', err);
    res.status(500).json({ message: 'Error fetching projects' });
  }
});

// Mirror under /api for proxies that prefix API routes
// (removed test diagnostics and mirror routes)
// ---- Projects CRUD ----
app.post('/projects', async (req, res) => {
  try {
    const body = req.body || {};

    const required = ['country', 'admin1', 'title'];
    for (const k of required) {
      if (!body[k] || String(body[k]).trim() === '') {
        return res.status(400).json({ message: `Missing required field: ${k}` });
      }
    }

    const categoriesJson = JSON.stringify(body.categories || {});

    const pool = await getPool();
    await pool
      .request()
      .input('country',            sql.VarChar,        body.country)
      .input('admin1',             sql.VarChar,        body.admin1)
      .input('donor',              sql.VarChar,        body.donor || null)
      .input('title',              sql.NVarChar,       body.title)
      .input('status',             sql.VarChar,        body.status || null)
      .input('fundingAgency',      sql.VarChar,        body.fundingAgency || null)
      .input('implementingAgency', sql.VarChar,        body.implementingAgency || null)
      .input('recipient',          sql.VarChar,        body.recipient || null)
      .input('zone',               sql.VarChar,        body.zone || null)
      .input('start',              sql.Int,            body.start ? parseInt(body.start, 10) : null)
      .input('end',                sql.Int,            body.end ? parseInt(body.end, 10) : null)
      .input('currency',           sql.VarChar,        body.currency || null)
      .input('budget',             sql.Decimal(18,2),  body.budget !== undefined && body.budget !== null && body.budget !== '' ? Number(body.budget) : null)
      .input('budgetUSD',          sql.Decimal(18,2),  body.budgetUSD !== undefined && body.budgetUSD !== null && body.budgetUSD !== '' ? Number(body.budgetUSD) : null)
      .input('link',               sql.NVarChar,       body.link || null)
      .input('img',                sql.NVarChar,       body.img || null)
      .input('comments',           sql.NVarChar,       body.comments || null)
      .input('topic',              sql.NVarChar,       body.topic || null)
      .input('categoriesJson',     sql.NVarChar,       categoriesJson)
      .input('createdBy',          sql.VarChar,        body.createdBy || null)
      .query(`
        INSERT INTO dbo.Projects (
          country, admin1, donor, title, status, fundingAgency, implementingAgency, recipient, zone,
          [start], [end], currency, budget, budgetUSD, [link], img, comments, topic, categoriesJson, createdBy
        ) VALUES (
          @country, @admin1, @donor, @title, @status, @fundingAgency, @implementingAgency, @recipient, @zone,
          @start, @end, @currency, @budget, @budgetUSD, @link, @img, @comments, @topic, @categoriesJson, @createdBy
        );
      `);

    return res.status(201).json({ message: 'Project created' });
  } catch (err) {
    console.error('Error creating project:', err);
    return res.status(500).json({ message: 'Error creating project' });
  }
});

// ---- Error handler (keep last) ----
app.use((err, req, res, next) => {
  console.error('💥 Unexpected error in', req.method, req.path, err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// ---- Start server ----
const PORT = process.env.PORT || 5001;
app.listen(PORT, '0.0.0.0', () => console.log(`Server listening on ${PORT}`));

// Log unhandled errors so they appear in Azure logs
process.on('uncaughtException', err => console.error('UNCAUGHT', err));
process.on('unhandledRejection', err => console.error('UNHANDLED', err));

function shutdown(sig){
  console.log(`\n${sig} received, closing...`);
  sql.close().catch(()=>{}).finally(()=>process.exit(0));
}
['SIGTERM','SIGINT'].forEach(s=>process.on(s,()=>shutdown(s)));

