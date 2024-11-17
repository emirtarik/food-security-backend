// app.js

const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const dotenv = require('dotenv');

dotenv.config(); // Load environment variables from .env file

const app = express();

// CORS Configuration
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

// JSON Parsing Middleware
app.use(express.json());

// Database Configuration
const config = {
    user: process.env.DB_USER || 'admin',  // Replace with your RDS master username
    password: process.env.DB_PASSWORD || 'XEqbUunu1P0vTyJH873y',  // Replace with your RDS master user password
    server: process.env.DB_SERVER || 'food-security-backend.cf6smoo0edix.eu-north-1.rds.amazonaws.com',  // Your AWS RDS endpoint
    database: process.env.DB_DATABASE || 'backend',  // The name of your database in RDS
    port: parseInt(process.env.DB_PORT, 10) || 1433,
    options: {
        encrypt: true,  // Required for AWS RDS
        trustServerCertificate: true  // Recommended for production environments
    }
};

// Middleware for verifying master role
const verifyMasterRole = (req, res, next) => {
    // TODO: Implement authentication middleware that sets req.user
    // For example, using JWT and setting req.user based on the token
    // Ensure that req.user is populated before this middleware runs

    if (req.user && req.user.role === 'master') {
        next();
    } else {
        res.status(403).json({ error: 'Access denied. Master role required.' });
    }
};

// -----------------------------------
// Routes
// -----------------------------------

// 1. Login Route: Authenticate users based on MSSQL Users table
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    console.log(`Received login request for username: ${username}`);

    try {
        const pool = await sql.connect(config);
        const result = await pool.request()
            .input('username', sql.VarChar, username)
            .query('SELECT * FROM Users WHERE username = @username');

        const user = result.recordset[0];

        if (user) {
            // TODO: Implement password hashing comparison
            // Example using bcrypt:
            // const bcrypt = require('bcrypt');
            // const isPasswordValid = await bcrypt.compare(password, user.password);
            // if (isPasswordValid) { ... }

            if (user.password === password) {  // In production, compare hashed passwords
                console.log('Login successful, sending country and role to client');
                // TODO: Generate and send a JWT token for authenticated sessions
                res.status(200).json({ message: 'Login successful', country: user.country, role: user.role });
            } else {
                console.log('Login failed: Invalid credentials');
                res.status(401).json({ message: 'Invalid credentials' });
            }
        } else {
            console.log('Login failed: User not found');
            res.status(401).json({ message: 'Invalid credentials' });
        }
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ message: 'Login failed' });
    }
});

// 2. Submit Route: Store or update the questionnaire responses
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

    console.log(`Received submission for country: ${country}, role: ${role}, year: ${year}, month: ${month}, submitted: ${submitted}`);

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

// 3. Available Countries Route: Get distinct countries from Submissions
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

// 4. Available Months Route: Get distinct months for a given country and year
app.get('/available-months', async (req, res) => {
    const { country, year } = req.query;

    if (!country || !year) {
        return res.status(400).json({ error: 'country and year are required' });
    }

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

// 5. Responses Route: Get responses based on country, year, month, and role
app.get('/responses', async (req, res) => {
    const { country, year, month, role } = req.query; // Include role in the query params

    if (!country || !year || !month || !role) {
        return res.status(400).json({ error: 'country, year, month, and role are required' });
    }

    console.log('Received /responses request with:', { country, year, month, role });

    try {
        const pool = await sql.connect(config);
        const result = await pool.request()
            .input('country', sql.VarChar, country)
            .input('year', sql.VarChar, year)
            .input('month', sql.VarChar, month)
            .input('role', sql.VarChar, role)
            .query('SELECT * FROM Submissions WHERE country = @country AND year = @year AND month = @month AND role = @role');

        const submissions = result.recordset;

        if (submissions.length > 0) {
            const submission = submissions[0]; // Expecting one submission per role

            // Parse the 'responses' JSON string
            let parsedResponses = {};
            try {
                parsedResponses = JSON.parse(submission.responses);
            } catch (parseError) {
                console.error('Error parsing responses JSON:', parseError);
                return res.status(500).send('Error parsing responses data');
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

            // Construct the full response object
            const responseData = {
                responses: parsedResponses, // Flat object mapping question keys to scores
                submitted: submission.submitted, // Assuming 'submitted' is a boolean
                comments: submission.comments || '',
                performanceScore: submission.performanceScore || 0,
                financingNeed: submission.financingNeed || 0,
                financingMobilized: submission.financingMobilized || 0,
                actionPlanPerQuestion: parsedActionPlanPerQuestion, // Parsed per-question action plans
                savedActionPlans: parsedSavedActionPlans, // Parsed saved action plans
                // actionPlan: parsedActionPlan, // Optional: If you need to include this
            };

            console.log('Sending /responses data:', responseData);

            res.json(responseData);
        } else {
            res.status(200).json({}); // No submission found
        }
    } catch (error) {
        console.error('Error fetching stored responses:', error);
        res.status(500).send('Error fetching stored responses');
    }
});

// 6. Master Responses Route: Get aggregated responses for master user
app.get('/master-responses', verifyMasterRole, async (req, res) => {
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

        if (submissions.length > 0) {
            // Initialize aggregation objects
            const aggregatedData = {
                section1: { responses: {}, comments: {}, actionPlans: {}, savedActionPlans: {} },
                section2: { responses: {}, comments: {}, actionPlans: {}, savedActionPlans: {} },
                section3: { responses: {}, comments: {}, actionPlans: {}, savedActionPlans: {} },
                section4: { responses: {}, comments: {}, actionPlans: {}, savedActionPlans: {} },
            };

            submissions.forEach(submission => {
                const role = submission.role; // e.g., 'section1'
                if (aggregatedData[role]) {
                    const responses = JSON.parse(submission.responses || '{}');
                    const comments = JSON.parse(submission.comments || '{}');
                    const actionPlans = JSON.parse(submission.actionPlanPerQuestion || '{}');
                    const savedActionPlans = JSON.parse(submission.savedActionPlans || '{}');

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
                }
            });

            console.log('Sending back master responses:', aggregatedData);

            res.json(aggregatedData);
        } else {
            console.log(`No submissions found for ${country} - ${year} - ${month}`);
            res.status(200).json({
                section1: { responses: {}, comments: {}, actionPlans: {}, savedActionPlans: {} },
                section2: { responses: {}, comments: {}, actionPlans: {}, savedActionPlans: {} },
                section3: { responses: {}, comments: {}, actionPlans: {}, savedActionPlans: {} },
                section4: { responses: {}, comments: {}, actionPlans: {}, savedActionPlans: {} },
            });
        }
    } catch (error) {
        console.error('Error fetching master responses:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 7. Dashboard Responses Route: Get aggregated data for the dashboard
app.get('/dashboard-responses', async (req, res) => {
    const { country, year, month } = req.query; // No need for role in the dashboard

    console.log('Received /dashboard-responses request with:', { country, year, month });

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

            console.log('Sending back data for the dashboard:', { cumulativeResponses, cumulativeSavedActionPlans });

            res.json({
                responses: cumulativeResponses,
                savedActionPlans: cumulativeSavedActionPlans,
                // actionPlanPerQuestion: cumulativeActionPlanPerQuestion, // Uncomment if needed
            });
        } else {
            console.log(`No submissions found for ${country} - ${year} - ${month}`);
            res.status(200).json({ responses: {}, savedActionPlans: {} }); // Respond with empty objects
        }
    } catch (error) {
        console.error('Error fetching dashboard responses:', error);
        res.status(500).send('Error fetching dashboard responses');
    }
});

const apiUrl = process.env.REACT_APP_API_URL || 'https://food-security-back.azurewebsites.net';


// -----------------------------------
// Start the Server
// -----------------------------------

const port = process.env.PORT || 5001;
app.listen(port, () => {
    console.log(`Backend is working on port ${port}`);
});
