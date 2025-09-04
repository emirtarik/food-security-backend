// app.js
const express = require('express');
const sql = require('mssql');
const { diagnosticsRouter } = require('./diagnostics');

// Load .env locally (Azure uses App Settings, so this won't run there)
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (_) {}
}

const app = express();

// Behind IIS/ARR we need this for secure cookies, proper IPs, etc.
app.set('trust proxy', 1);

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

app.use((req, res, next) => {
  const origin = req.get('Origin');

  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control'
  );
  res.header('Access-Control-Max-Age', '86400'); // 24h

  const allow = origin && allowedOrigins.includes(origin);

  if (req.method === 'OPTIONS') {
    if (allow) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    } else if (!origin) {
      res.header('Access-Control-Allow-Origin', '*');
    } else {
      // Fallback for unknown origins (optional)
      res.header('Access-Control-Allow-Origin', 'https://food-security-front.azurewebsites.net');
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    return res.status(204).send();
  }

  if (allow) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  } else if (!origin) {
    res.header('Access-Control-Allow-Origin', '*');
  } else {
    // Fallback for unknown origins (optional)
    res.header('Access-Control-Allow-Origin', 'https://food-security-front.azurewebsites.net');
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  next();
});

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

// ---- MSSQL config from ENV ----
// Required App Settings / .env keys:
//   DB_HOST, DB_PORT=1433, DB_USER, DB_PASS, DB_NAME
const sqlConfig = {
  server: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  options: {
    encrypt: true,                // required for RDS public TLS
    trustServerCertificate: false // keep false in production
  },
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 }
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
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  console.log(`Received login request for username: ${username}`);

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('username', sql.VarChar, username)
      .query('SELECT * FROM Users WHERE username = @username');

    const user = result.recordset[0];

    if (user && user.password === password) {
      console.log('Login successful');
      res.status(200).json({
        message: 'Login successful',
        country: user.country,
        role: user.role
      });
    } else {
      console.log('Login failed: Invalid credentials');
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ message: 'Login failed' });
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
