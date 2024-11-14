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

// In app.js

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
            
            // Parse the 'responses' JSON string
            let indexedResponses = {};
            try {
                indexedResponses = JSON.parse(submission.responses);
            } catch (parseError) {
                console.error('Error parsing responses JSON:', parseError);
                return res.status(500).send('Error parsing responses data');
            }

            // Creating structured data from indexed responses
            const structuredResponses = {};
            Object.keys(indexedResponses).forEach(index => {
                const sectionNumber = index[0];
                const subsectionNumber = index[1];
                const questionNumber = index[2];
                
                if (!structuredResponses[sectionNumber]) {
                    structuredResponses[sectionNumber] = {};
                }
                
                if (!structuredResponses[sectionNumber][subsectionNumber]) {
                    structuredResponses[sectionNumber][subsectionNumber] = [];
                }
                
                structuredResponses[sectionNumber][subsectionNumber].push({
                    questionNumber,
                    score: indexedResponses[index]
                });
            });

            // Parse 'actionPlan' if it's stored as a JSON string
            let parsedActionPlan = [];
            if (submission.actionPlan) {
                try {
                    parsedActionPlan = JSON.parse(submission.actionPlan);
                } catch (parseError) {
                    console.error('Error parsing actionPlan JSON:', parseError);
                    // Optionally handle the error or set to an empty array
                    parsedActionPlan = [];
                }
            }

            // Construct the full response object
            const responseData = {
                responses: structuredResponses,
                submitted: submission.submitted, // Assuming 'submitted' is a boolean
                comments: submission.comments || '',
                performanceScore: submission.performanceScore || 0,
                financingNeed: submission.financingNeed || 0,
                financingMobilized: submission.financingMobilized || 0,
                actionPlan: parsedActionPlan
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
            // Combine only the responses from different roles using the index
            const cumulativeResponses = submissions.reduce((acc, submission) => {
                const parsedResponses = JSON.parse(submission.responses);
                return {
                    ...acc,
                    ...parsedResponses // Merge responses using indices
                };
            }, {});

            console.log('Sending back indexed responses for the dashboard:', cumulativeResponses);
            res.json({
                responses: cumulativeResponses
            });
        } else {
            console.log(`No submissions found for ${country} - ${year} - ${month}`);
            res.status(200).json({}); // Respond with an empty object instead of 404
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
