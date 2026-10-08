const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123';
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'disc.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

function initDatabase() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        status TEXT NOT NULL DEFAULT 'UNUSED',
        candidate_name TEXT,
        created_at TEXT NOT NULL,
        used_at TEXT,
        expires_at TEXT NOT NULL,
        notes TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_code TEXT NOT NULL,
        candidate_name TEXT,
        profile_type TEXT NOT NULL,
        scores TEXT NOT NULL,
        answers TEXT,
        completed_at TEXT NOT NULL,
        FOREIGN KEY(token_code) REFERENCES tokens(code)
      )
    `);

    // Seed demo tokens if none exist
    db.get(`SELECT COUNT(*) as count FROM tokens`, (err, row) => {
      if (err) return;
      if (row.count === 0) {
        const now = new Date().toISOString();
        const demoTokens = [
          { code: 'DISC001', status: 'UNUSED', created_at: now, expires_at: makeExpiryDate(3), candidate_name: null },
          { code: 'DISC002', status: 'UNUSED', created_at: now, expires_at: makeExpiryDate(3), candidate_name: null },
          { code: 'DISC003', status: 'UNUSED', created_at: now, expires_at: makeExpiryDate(3), candidate_name: null },
          { code: 'DISC004', status: 'USED', created_at: now, used_at: now, expires_at: makeExpiryDate(3), candidate_name: 'Sample Candidate' }
        ];

        const stmt = db.prepare(`INSERT INTO tokens (code, status, candidate_name, created_at, used_at, expires_at, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        demoTokens.forEach((token) => {
          stmt.run(token.code, token.status, token.candidate_name, token.created_at, token.used_at || null, token.expires_at, 'Demo token');
        });
        stmt.finalize();
      }
    });
  });
}

function makeExpiryDate(days = 3) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function isExpired(expiresAt) {
  const now = new Date();
  const expiry = new Date(expiresAt);
  return now > expiry;
}

function statusMessageForToken(tokenRow) {
  if (!tokenRow) return { valid: false, message: 'Invalid token.' };
  const now = new Date();
  const expiry = new Date(tokenRow.expires_at);
  if (tokenRow.status === 'USED') {
    return { valid: false, message: 'This code has already been used.' };
  }
  if (tokenRow.status === 'EXPIRED') {
    return { valid: false, message: 'This token has expired.' };
  }
  if (now > expiry) {
    db.run(`UPDATE tokens SET status = 'EXPIRED' WHERE code = ?`, [tokenRow.code]);
    return { valid: false, message: 'This token has expired.' };
  }
  return { valid: true, message: 'Token valid.' };
}

function getTokenRow(code, callback) {
  db.get(`SELECT * FROM tokens WHERE code = ?`, [code], callback);
}

function getDashboardData(callback) {
  db.all(`
    SELECT * FROM tokens ORDER BY created_at DESC
  `, (err, tokens) => {
    if (err) return callback(err);
    db.all(`
      SELECT * FROM results ORDER BY completed_at DESC
    `, (resErr, results) => {
      if (resErr) return callback(resErr);
      callback(null, { tokens, results });
    });
  });
}

app.use(bodyParser.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'DISC Assessment API is running.' });
});

app.post('/api/validate-token', (req, res) => {
  const { token, candidateName } = req.body || {};
  const normalizedToken = String(token || '').trim().toUpperCase();

  if (!normalizedToken) {
    return res.status(400).json({ valid: false, message: 'Token is required.' });
  }

  getTokenRow(normalizedToken, (err, tokenRow) => {
    if (err) {
      return res.status(500).json({ valid: false, message: 'Database error.' });
    }

    const validation = statusMessageForToken(tokenRow);
    if (!validation.valid) {
      return res.status(403).json({ valid: false, message: validation.message });
    }

    const safeName = (candidateName || tokenRow.candidate_name || 'Anonymous').trim() || 'Anonymous';

    db.run(
      `UPDATE tokens SET candidate_name = ? WHERE code = ?`,
      [safeName, normalizedToken],
      function (updateErr) {
        if (updateErr) {
          return res.status(500).json({ valid: false, message: 'Failed to store candidate name.' });
        }

        return res.json({
          valid: true,
          token: normalizedToken,
          candidateName: safeName,
          expiresAt: tokenRow.expires_at,
          message: 'Token accepted. You may begin the assessment.'
        });
      }
    );
  });
});

app.post('/api/submit-assessment', (req, res) => {
  const { token, candidateName, scores, profileType, answers } = req.body || {};
  const normalizedToken = String(token || '').trim().toUpperCase();

  if (!normalizedToken) {
    return res.status(400).json({ valid: false, message: 'Token is required.' });
  }

  getTokenRow(normalizedToken, (err, tokenRow) => {
    if (err) {
      return res.status(500).json({ valid: false, message: 'Database error.' });
    }

    const validation = statusMessageForToken(tokenRow);
    if (!validation.valid) {
      return res.status(403).json({ valid: false, message: validation.message });
    }

    const safeName = (candidateName || tokenRow.candidate_name || 'Anonymous').trim() || 'Anonymous';
    const completedAt = new Date().toISOString();

    db.run(
      `INSERT INTO results (token_code, candidate_name, profile_type, scores, answers, completed_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [normalizedToken, safeName, profileType || 'D', JSON.stringify(scores || {}), JSON.stringify(answers || {}), completedAt],
      function (resultErr) {
        if (resultErr) {
          return res.status(500).json({ valid: false, message: 'Unable to save assessment results.' });
        }

        db.run(
          `UPDATE tokens SET status = 'USED', candidate_name = ?, used_at = ? WHERE code = ?`,
          [safeName, completedAt, normalizedToken],
          function (updErr) {
            if (updErr) {
              return res.status(500).json({ valid: false, message: 'Failed to finalize token.' });
            }

            return res.json({
              valid: true,
              message: 'Assessment completed successfully.',
              token: normalizedToken,
              candidateName: safeName,
              profileType: profileType || 'D'
            });
          }
        );
      }
    );
  });
});

app.post('/api/admin/token', (req, res) => {
  const { adminKey } = req.body || {};
  if (String(adminKey || '') !== ADMIN_KEY) {
    return res.status(401).json({ valid: false, message: 'Unauthorized admin access.' });
  }

  const code = `DISC${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const createdAt = new Date().toISOString();
  const expiresAt = makeExpiryDate(3);

  db.run(
    `INSERT INTO tokens (code, status, candidate_name, created_at, expires_at, notes) VALUES (?, 'UNUSED', NULL, ?, NULL, ?, 'Generated by admin')`,
    [code, createdAt, expiresAt],
    function (err) {
      if (err) {
        return res.status(500).json({ valid: false, message: 'Failed to generate token.' });
      }

      return res.json({ valid: true, token: code, createdAt, expiresAt });
    }
  );
});

app.get('/api/admin/report', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (String(adminKey || '') !== ADMIN_KEY) {
    return res.status(401).json({ valid: false, message: 'Unauthorized admin access.' });
  }

  getDashboardData((err, data) => {
    if (err) {
      return res.status(500).json({ valid: false, message: 'Database error while fetching report.' });
    }

    const total = data.tokens.length;
    const used = data.tokens.filter((t) => t.status === 'USED').length;
    const unused = data.tokens.filter((t) => t.status === 'UNUSED').length;
    const expired = data.tokens.filter((t) => t.status === 'EXPIRED').length;
    const completed = data.results.length;

    const summary = {
      total,
      used,
      unused,
      expired,
      completed,
      completionRate: total ? ((completed / total) * 100).toFixed(1) : '0.0'
    };

    return res.json({ valid: true, summary, tokens: data.tokens, results: data.results });
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  initDatabase();
  console.log(`DISC Assessment server running on http://localhost:${PORT}`);
  console.log(`Admin key: ${ADMIN_KEY}`);
});

module.exports = app;
