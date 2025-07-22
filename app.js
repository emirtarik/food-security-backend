import express from 'express';
import cors    from 'cors';
import sql     from 'mssql';

const app = express();

// Debug: Log all incoming requests
app.use((req, res, next) => {
  console.log('=== Incoming Request ===');
  console.log(`${req.method} ${req.url}`);
  console.log('Origin:', req.get('Origin'));
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  next();
});

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5001',
  'https://food-security-front.azurewebsites.net',
  'https://food-security-back.azurewebsites.net',
  'https://food-security.net',
  'https://www.food-security.net',
  'https://www.food-security.net/login'
];

const corsOptions = {
  origin: function (origin, callback) {
    console.log('CORS check for origin:', origin);
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      console.log('No origin - allowing');
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      console.log('Origin allowed:', origin);
      callback(null, true);
    } else {
      console.log('Origin NOT allowed:', origin);
      console.log('Available origins:', allowedOrigins);
      callback(new Error(`CORS Error: Origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With', 
    'Content-Type', 
    'Accept',
    'Authorization',
    'Cache-Control',
    'X-Requested-With'
  ],
  preflightContinue: false,
  optionsSuccessStatus: 204
};


app.use(cors(corsOptions));

// Explicit OPTIONS handler for all routes
app.options('*', (req, res) => {
  console.log('=== OPTIONS Request ===');
  console.log('Origin:', req.get('Origin'));
  console.log('Access-Control-Request-Method:', req.get('Access-Control-Request-Method'));
  console.log('Access-Control-Request-Headers:', req.get('Access-Control-Request-Headers'));
  
  const origin = req.get('Origin');
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin,X-Requested-With,Content-Type,Accept,Authorization,Cache-Control');
    res.status(204).send();
  } else {
    res.status(403).send('CORS not allowed');
  }
});

app.use(express.json());

// Add response headers middleware
app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  next();
});

const config = {
    user: 'admin',  // Replace with your RDS master username
    password: 'XEqbUunu1P0vTyJH873y',  // Replace with your RDS master user password
    server: 'food-security-backend.cf6smoo0edix.eu-north-1.rds.amazonaws.com',  // Your AWS RDS endpoint
    database: 'backend',  // The name of your database in RDS
    port: 1433,
    options: {
        encrypt: true,  // Required for AWS RDS
        trustServerCertificate: true  // Recommended for production environments
    }
};

// Login route: authenticate users based on MSSQL Users table
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    console.log(`Received login request for username: ${username} and password: ${password}`);

    try {
        const pool = await sql.connect(config);
        const result = await pool.request()
            .input('username', sql.VarChar, username)
            .query('SELECT * FROM Users WHERE username = @username');

        const user = result.recordset[0];

        console.log(`User found in database: ${user}`);

        if (user && user.password === password) {  // In production, compare hashed passwords
            console.log('Login successful, sending country and role to client');
            res.status(200).json({ message: 'Login successful', country: user.country, role: user.role });
        } else {
            console.log('Login failed: Invalid credentials');
            res.status(401).json({ message: 'Invalid credentials' });
        }
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ message: 'Login failed' });
    }
});

// POST route to store or update the questionnaire responses
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
        submitted,
    } = req.body;

    console.log('Received submission for country:', country);
    console.log('Received submission for role:', role);
    console.log('Received year:', year);
    console.log('Received month:', month);
    console.log('Submitted status:', submitted);
    console.log('Action Plan Per Question:', actionPlanPerQuestion); // Log the action plan data
    console.log('Saved Action Plans:', savedActionPlans); // Log saved action plans

    try {
        const pool = await sql.connect(config);

        // Check if a submission already exists
        const existingSubmission = await pool.request()
            .input('country', sql.VarChar, country)
            .input('role', sql.VarChar, role)
            .input('year', sql.VarChar, year)
            .input('month', sql.VarChar, month)
            .query('SELECT * FROM Submissions WHERE country = @country AND role = @role AND year = @year AND month = @month');

        if (existingSubmission.recordset.length > 0) {
            // Update the existing submission
            await pool.request()
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
            // Insert a new submission
            await pool.request()
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

        console.log(`Submission saved/updated for country: ${country}, role: ${role}, year: ${year}, month: ${month}`);
        res.status(200).send('Responses saved/updated in the database');
    } catch (error) {
        console.error('Error saving submission:', error);
        res.status(500).send('Error saving submission');
    }
});

app.post('/submit-master', async (req, res) => {
    const {
        country,
        role,
        year,
        month,
        responses, // Assuming this includes all sections
        comments,
        questionComments,
        performanceScore,
        financingNeed,
        financingMobilized,
        actionPlanPerQuestion,
        savedActionPlans,
        submitted,
    } = req.body;

    console.log('Received master submission for country:', country);
    console.log('Received master submission for role:', role);
    console.log('Received year:', year);
    console.log('Received month:', month);
    console.log('Submitted status:', submitted);
    console.log('Action Plan Per Question:', actionPlanPerQuestion); // Log the action plan data
    console.log('Saved Action Plans:', savedActionPlans); // Log saved action plans

    try {
        const pool = await sql.connect(config);

        // Check if a master submission already exists
        const existingSubmission = await pool.request()
            .input('country', sql.VarChar, country)
            .input('role', sql.VarChar, role)
            .input('year', sql.VarChar, year)
            .input('month', sql.VarChar, month)
            .query('SELECT * FROM Submissions WHERE country = @country AND role = @role AND year = @year AND month = @month');

        if (existingSubmission.recordset.length > 0) {
            // Update the existing master submission
            await pool.request()
                .input('responses', sql.NVarChar, JSON.stringify(responses))
                .input('comments', sql.NVarChar, comments)
                .input('questionComments', sql.NVarChar, JSON.stringify(questionComments))
                .input('performanceScore', sql.Float, performanceScore) // Changed to Float for numerical value
                .input('financingNeed', sql.BigInt, financingNeed) // Changed to BigInt for larger numbers
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
            // Insert a new master submission
            await pool.request()
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

        console.log(`Master submission saved/updated for country: ${country}, role: ${role}, year: ${year}, month: ${month}`);
        res.status(200).send('Master responses saved/updated in the database');
    } catch (error) {
        console.error('Error saving master submission:', error);
        res.status(500).send('Error saving master submission');
    }
});

app.get('/available-countries', async (req, res) => {
    try {
      const pool = await sql.connect(config);
  
      const result = await pool.request()
        .query(`
          SELECT DISTINCT country 
          FROM Submissions
        `);
  
      const countries = result.recordset.map(row => row.country);
      res.json(countries);
    } catch (error) {
      console.error('Error fetching available countries:', error);
      res.status(500).send('Internal Server Error');
    }
  });
  
  

// Example backend route to return available months for a given year and country
app.get('/available-months', async (req, res) => {
  const { country, year } = req.query;

  try {
    const pool = await sql.connect(config);

    const result = await pool.request()
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

// Updated /responses route for master user functionality
app.get('/responses', async (req, res) => {
    const { country, year, month, role } = req.query; // Include role in the query params

    console.log('Received request with:', { country, year, month, role });

    try {
        const pool = await sql.connect(config);
        const result = await pool.request()
            .input('country', sql.VarChar, country)
            .input('year', sql.VarChar, year)
            .input('month', sql.VarChar, month)
            .input('role', sql.VarChar, role) // Ensure we filter by role
            .query('SELECT * FROM Submissions WHERE country = @country AND year = @year AND month = @month AND role = @role');

        const submissions = result.recordset;

        if (submissions.length > 0) {
            const submission = submissions[0]; // Expecting one submission per role

            // Parse the 'responses' JSON string (assuming it's already flat)
            let parsedResponses = {};
            try {
                parsedResponses = JSON.parse(submission.responses);
            } catch (parseError) {
                console.error('Error parsing responses JSON:', parseError);
                return res.status(500).send('Error parsing responses data');
            }

            // Parse 'comments' JSON string (if applicable)
            let parsedComments = '';
            if (submission.comments) {
                try {
                    parsedComments = JSON.parse(submission.comments);
                } catch (parseError) {
                    console.error('Error parsing comments JSON:', parseError);
                    parsedComments = submission.comments; // Fallback to raw string
                }
            }

            // **Parse 'questionComments' JSON string**
            let parsedQuestionComments = {};
            if (submission.questionComments) {
                try {
                    parsedQuestionComments = JSON.parse(submission.questionComments);
                } catch (parseError) {
                    console.error('Error parsing questionComments JSON:', parseError);
                    parsedQuestionComments = {}; // Fallback to empty object
                }
            }

            // Parse 'actionPlanPerQuestion' if it's stored as a JSON string
            let parsedActionPlanPerQuestion = {};
            if (submission.actionPlanPerQuestion) {
                try {
                    parsedActionPlanPerQuestion = JSON.parse(submission.actionPlanPerQuestion);
                } catch (parseError) {
                    console.error('Error parsing actionPlanPerQuestion JSON:', parseError);
                    parsedActionPlanPerQuestion = {};
                }
            }

            // Parse 'savedActionPlans' if it's stored as a JSON string
            let parsedSavedActionPlans = {};
            if (submission.savedActionPlans) {
                try {
                    parsedSavedActionPlans = JSON.parse(submission.savedActionPlans);
                } catch (parseError) {
                    console.error('Error parsing savedActionPlans JSON:', parseError);
                    parsedSavedActionPlans = {};
                }
            }

            // Parse 'actionPlan' if it's stored as a JSON string (optional)
            let parsedActionPlan = [];
            if (submission.actionPlan) {
                try {
                    parsedActionPlan = JSON.parse(submission.actionPlan);
                } catch (parseError) {
                    console.error('Error parsing actionPlan JSON:', parseError);
                    parsedActionPlan = [];
                }
            }

            // Construct the full response object
            const responseData = {
                responses: parsedResponses, // Flat object mapping question keys to scores
                submitted: submission.submitted, // Assuming 'submitted' is a boolean
                comments: parsedComments, // Parsed comments
                questionComments: parsedQuestionComments, // **Include questionComments**
                performanceScore: submission.performanceScore || 0,
                financingNeed: submission.financingNeed || 0,
                financingMobilized: submission.financingMobilized || 0,
                actionPlanPerQuestion: parsedActionPlanPerQuestion, // Parsed per-question action plans
                savedActionPlans: parsedSavedActionPlans, // Parsed saved action plans
                actionPlan: parsedActionPlan, // Optional: If you need to include this
            };

            console.log('Sending response data:', responseData); // Debugging

            res.json(responseData);
        } else {
            res.status(200).json({}); // No submission found
        }
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
        const pool = await sql.connect(config);

        // Fetch submissions for all roles matching country, year, and month
        const result = await pool.request()
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

        // Initialize aggregation objects with 'submitted' flag
        const aggregatedData = {
            section1: { responses: {}, comments: {}, questionComments: {}, actionPlans: {}, savedActionPlans: {}, submitted: false },
            section2: { responses: {}, comments: {}, questionComments: {}, actionPlans: {}, savedActionPlans: {}, submitted: false },
            section3: { responses: {}, comments: {}, questionComments: {}, actionPlans: {}, savedActionPlans: {}, submitted: false },
            section4: { responses: {}, comments: {}, questionComments: {}, actionPlans: {}, savedActionPlans: {}, submitted: false },
        };

        if (submissions.length > 0) {
            submissions.forEach(submission => {
                const role = submission.role; // e.g., 'section1'
                if (aggregatedData[role]) {
                    const responses = JSON.parse(submission.responses || '{}');
                    const comments = JSON.parse(submission.comments || '{}');
                    const questionComments = JSON.parse(submission.questionComments || '{}'); // **Parse questionComments**
                    const actionPlans = JSON.parse(submission.actionPlanPerQuestion || '{}');
                    const savedActionPlans = JSON.parse(submission.savedActionPlans || '{}');
                    const submitted = submission.submitted === true; // Ensure it's a boolean

                    // Aggregate responses
                    aggregatedData[role].responses = {
                        ...aggregatedData[role].responses,
                        ...responses, // Merge responses by question index
                    };

                    // Aggregate comments
                    aggregatedData[role].comments = {
                        ...aggregatedData[role].comments,
                        ...comments,
                    };

                    // **Aggregate questionComments**
                    aggregatedData[role].questionComments = {
                        ...aggregatedData[role].questionComments,
                        ...questionComments,
                    };

                    // Aggregate action plans
                    aggregatedData[role].actionPlans = {
                        ...aggregatedData[role].actionPlans,
                        ...actionPlans,
                    };

                    // Aggregate saved action plans
                    aggregatedData[role].savedActionPlans = {
                        ...aggregatedData[role].savedActionPlans,
                        ...savedActionPlans,
                    };

                    // Set submitted flag
                    aggregatedData[role].submitted = submitted;
                }
            });

            console.log('Sending back master responses:', aggregatedData);

            res.json(aggregatedData);
        } else {
            console.log(`No submissions found for ${country} - ${year} - ${month}`);
            res.status(200).json(aggregatedData); // All sections have submitted: false
        }
    } catch (error) {
        console.error('Error fetching master responses:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});



app.get('/dashboard-responses', async (req, res) => {
  const { country, year, month } = req.query;
  console.log('Received dashboard request with:', { country, year, month });

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('country', sql.VarChar, country)
      .input('year',    sql.VarChar, year)
      .input('month',   sql.VarChar, month)
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

    if (submissions.length > 0) {
      // 1) Merge all responses
      const cumulativeResponses = submissions.reduce((acc, s) => {
        return { ...acc, ...JSON.parse(s.responses  || '{}') };
      }, {});
      // 2) Merge all savedActionPlans
      const cumulativeSavedActionPlans = submissions.reduce((acc, s) => {
        const parsed = JSON.parse(s.savedActionPlans || '{}');
        for (const [k, plans] of Object.entries(parsed)) {
          acc[k] = (acc[k] || []).concat(plans);
        }
        return acc;
      }, {});
      // 3) Merge all questionComments
      const cumulativeQuestionComments = submissions.reduce((acc, s) => {
        return { ...acc, ...JSON.parse(s.questionComments || '{}') };
      }, {});

      // 4) Extract and parse your three metrics from the first record
      const { performanceScore: rawPerf, financingNeed: rawNeed, financingMobilized: rawMob } = submissions[0];
      const performanceScore   = rawPerf != null ? parseFloat(rawPerf) : 0;
      const financingNeed      = rawNeed  != null ? parseFloat(rawNeed)  : 0;
      const financingMobilized = rawMob   != null ? parseFloat(rawMob)   : 0;

      console.log('Sending back data for the dashboard:', {
        cumulativeResponses,
        cumulativeSavedActionPlans,
        cumulativeQuestionComments,
        performanceScore,
        financingNeed,
        financingMobilized
      });

      return res.json({
        responses:           cumulativeResponses,
        savedActionPlans:    cumulativeSavedActionPlans,
        questionComments:    cumulativeQuestionComments,
        performanceScore,
        financingNeed,
        financingMobilized
      });
    }

    // No submissions found → return empty objects + zeros
    console.log(`No submissions for ${country} - ${year} - ${month}`);
    return res.status(200).json({
      responses:            {},
      savedActionPlans:     {},
      questionComments:     {},
      performanceScore:     0,
      financingNeed:        0,
      financingMobilized:   0
    });
  } catch (error) {
    console.error('Error fetching dashboard responses:', error);
    return res.status(500).send('Error fetching dashboard responses');
  }
});



// CATCH CORS ERRORS - This should be at the end
app.use((err, req, res, next) => {
  if (err.message && err.message.startsWith('Not allowed by CORS')) {
    console.error('CORS Error Details:', {
      origin: req.get('Origin'),
      method: req.method,
      path: req.path,
      headers: req.headers
    });
    return res.status(403).json({ error: err.message });
  }
  next(err);
});


const apiUrl = process.env.REACT_APP_API_URL || 'https://food-security-back.azurewebsites.net';

const port = process.env.PORT || 5001;

app.listen(port, () => {
    console.log(`Backend is working on port ${port}`);
});
