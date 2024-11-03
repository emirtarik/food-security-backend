const express = require('express');
const cors = require('cors');
const sql = require('mssql');

const app = express();

app.use(cors()); // To allow cross-origin requests from the React app
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
    const { country, role, year, month, responses, comments, performanceScore, financingNeed, financingMobilized, actionPlan, submitted } = req.body;

    console.log('Received submission for country:', country);
    console.log('Received submission for role:', role);
    console.log('Received year:', year);
    console.log('Received month:', month);
    console.log('Submitted status:', submitted);
    console.log('Action Plan:', actionPlan); // Log the action plan data

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
                .input('performanceScore', sql.VarChar, performanceScore)
                .input('financingNeed', sql.VarChar, financingNeed)
                .input('financingMobilized', sql.VarChar, financingMobilized)
                .input('actionPlan', sql.NVarChar, JSON.stringify(actionPlan)) // Add the action plan to the query
                .input('submitted', sql.Bit, submitted) // Update submitted status
                .input('country', sql.VarChar, country)
                .input('role', sql.VarChar, role)
                .input('year', sql.VarChar, year)
                .input('month', sql.VarChar, month)
                .query(`
                    UPDATE Submissions 
                    SET responses = @responses, comments = @comments, performanceScore = @performanceScore, 
                        financingNeed = @financingNeed, financingMobilized = @financingMobilized, actionPlan = @actionPlan, submitted = @submitted
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
                .input('performanceScore', sql.VarChar, performanceScore)
                .input('financingNeed', sql.VarChar, financingNeed)
                .input('financingMobilized', sql.VarChar, financingMobilized)
                .input('actionPlan', sql.NVarChar, JSON.stringify(actionPlan)) // Insert the action plan
                .input('submitted', sql.Bit, submitted) // Insert submitted status
                .query(`
                    INSERT INTO Submissions (country, role, year, month, responses, comments, performanceScore, financingNeed, financingMobilized, actionPlan, submitted)
                    VALUES (@country, @role, @year, @month, @responses, @comments, @performanceScore, @financingNeed, @financingMobilized, @actionPlan, @submitted)
                `);
        }

        console.log(`Submission saved/updated for country: ${country}, role: ${role}, year: ${year}, month: ${month}`);
        res.status(200).send('Responses saved/updated in the database');
    } catch (error) {
        console.error('Error saving submission:', error);
        res.status(500).send('Error saving submission');
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
        res.json(submission);
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
            // Combine only the responses from different roles
            const cumulativeResponses = submissions.reduce((acc, submission) => {
                const parsedResponses = JSON.parse(submission.responses);
                return {
                    ...acc,
                    ...parsedResponses,  // Merge responses from all roles
                };
            }, {});

            // We can also return other fields like performanceScore, financingNeed, etc.
            // if needed for specific role submissions in the dashboard, but for now
            // we are focusing on responses.
            console.log('Sending back combined responses for the dashboard:', cumulativeResponses);
            res.json({
                responses: cumulativeResponses,
                comments: "", // Optionally include empty or concatenated comments if needed
                performanceScore: "", // Optionally include score if needed
                financingNeed: "", // Optionally include financingNeed if needed
                financingMobilized: "" // Optionally include financingMobilized if needed
            });
        } else {
            // No submissions found
            console.log(`No submissions found for ${country} - ${year} - ${month}`);
            res.status(200).json({}); // Respond with an empty object instead of 404
        }
    } catch (error) {
        console.error('Error fetching dashboard responses:', error);
        res.status(500).send('Error fetching dashboard responses');
    }
});

const port = process.env.PORT || 5001;
app.listen(port, () => {
    console.log(`Backend is working on port ${port}`);
});