const express = require('express');
const cors = require('cors');
const sql = require('mssql');

const app = express();

const allowedOrigins = [
    'http://localhost:3000',
    'https://food-security-front.azurewebsites.net'
  ];

  app.use(cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (e.g., mobile apps, Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,  // Allow credentials (cookies, authorization headers, etc.)
  }));
  
app.use(express.json());

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

// Middleware for verifying master role / to be implemented later
// const verifyMasterRole = (req, res, next) => {
//     if (req.user) {
//         console.log(`User role: ${req.user.role}`);
//         if (req.user.role === 'master') {
//             next();
//         } else {
//             console.log('User is not a master');
//             res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
//         }
//     } else {
//         console.log('No user found in request');
//         res.status(403).json({ message: 'Forbidden: No user information' });
//     }
// };

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
    const { country, year, month } = req.query; // No need for role in the dashboard

    console.log('Received dashboard request with:', { country, year, month });

    try {
        const pool = await sql.connect(config);
        const result = await pool.request()
            .input('country', sql.VarChar, country)
            .input('year', sql.VarChar, year)
            .input('month', sql.VarChar, month)
            .query('SELECT * FROM Submissions WHERE country = @country AND year = @year AND month = @month');

        const submissions = result.recordset;

        if (submissions.length > 0) {
            // Aggregate responses from all submissions
            const cumulativeResponses = submissions.reduce((acc, submission) => {
                const parsedResponses = JSON.parse(submission.responses || '{}');
                return {
                    ...acc,
                    ...parsedResponses // Merge responses using question indices
                };
            }, {});

            // Aggregate savedActionPlans from all submissions
            const cumulativeSavedActionPlans = submissions.reduce((acc, submission) => {
                const parsedSavedActionPlans = JSON.parse(submission.savedActionPlans || '{}');
                // Iterate through each question's saved action plans
                for (const [questionKey, plans] of Object.entries(parsedSavedActionPlans)) {
                    if (!acc[questionKey]) {
                        acc[questionKey] = [];
                    }
                    acc[questionKey].push(...plans);
                }
                return acc;
            }, {});

            // **Aggregate questionComments from all submissions**
            const cumulativeQuestionComments = submissions.reduce((acc, submission) => {
                const parsedQuestionComments = JSON.parse(submission.questionComments || '{}');
                return {
                    ...acc,
                    ...parsedQuestionComments
                };
            }, {});

            // Optionally, aggregate actionPlanPerQuestion if needed
            const cumulativeActionPlanPerQuestion = submissions.reduce((acc, submission) => {
                const parsedActionPlan = JSON.parse(submission.actionPlanPerQuestion || '{}');
                for (const [questionKey, plans] of Object.entries(parsedActionPlan)) {
                    if (!acc[questionKey]) {
                        acc[questionKey] = [];
                    }
                    acc[questionKey].push(...plans);
                }
                return acc;
            }, {});

            console.log('Sending back data for the dashboard:', {
                cumulativeResponses,
                cumulativeSavedActionPlans,
                cumulativeQuestionComments
            });

            res.json({
                responses: cumulativeResponses,
                savedActionPlans: cumulativeSavedActionPlans,
                questionComments: cumulativeQuestionComments // **Include questionComments**
                // actionPlanPerQuestion: cumulativeActionPlanPerQuestion, // Uncomment if needed
            });
        } else {
            console.log(`No submissions found for ${country} - ${year} - ${month}`);
            res.status(200).json({ responses: {}, savedActionPlans: {}, questionComments: {} }); // Respond with empty objects
        }
    } catch (error) {
        console.error('Error fetching dashboard responses:', error);
        res.status(500).send('Error fetching dashboard responses');
    }
});



const apiUrl = process.env.REACT_APP_API_URL || 'https://food-security-back.azurewebsites.net';

const port = process.env.PORT || 5001;
app.listen(port, () => {
    console.log(`Backend is working on port ${port}`);
});
