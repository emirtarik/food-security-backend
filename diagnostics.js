// diagnostics.js  (CommonJS version)
const express = require('express');
const os = require('os');
const process = require('process');
const sql = require('mssql'); // make sure it's in dependencies

function diagnosticsRouter() {
  const r = express.Router();

  r.get('/healthz', (req, res) => {
    res.json({
      ok: true,
      message: 'App is running',
      node: process.version,
      pid: process.pid,
      platform: process.platform,
      uptime_sec: Math.round(process.uptime()),
      hostname: os.hostname(),
      port_env: process.env.PORT || '(not set)',
    });
  });

  r.get('/env-check', (req, res) => {
    const keys = [
      'PORT',
      'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASS', 'DB_NAME',
      'JWT_SECRET', 'NODE_ENV'
    ];
    const present = Object.fromEntries(keys.map(k => [k, Boolean(process.env[k])]));
    res.json({ ok: true, present });
  });

  r.get('/db-ping', async (req, res) => {
    const config = {
      server: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '1433', 10),
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      options: { encrypt: true, trustServerCertificate: false },
      pool: { max: 5, min: 0, idleTimeoutMillis: 30000 }
    };

    try {
      const pool = await sql.connect(config);
      const rs = await pool.request().query('SELECT 1 AS ok');
      res.json({ ok: true, result: rs.recordset });
    } catch (e) {
      console.error('DB PING ERROR:', e);
      res.status(500).json({ ok: false, error: e.message, code: e.code, name: e.name });
    }
  });

  return r;
}

module.exports = { diagnosticsRouter };
