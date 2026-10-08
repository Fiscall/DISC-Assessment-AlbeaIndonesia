const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'disc.db');
const HR_EMAIL = process.env.HR_EMAIL || 'fiscall.aditama@albea-group.com';
const COMPANY_NAME = process.env.COMPANY_NAME || 'Albea Indonesia';
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = process.env.SMTP_PORT || '587';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';

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
      CREATE TABLE IF NOT EXISTS assessments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        gender TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        position_applied TEXT NOT NULL,
        education TEXT NOT NULL,
        campus TEXT NOT NULL,
        profile_type TEXT NOT NULL,
        scores TEXT NOT NULL,
        answers TEXT,
        submitted_at TEXT NOT NULL
      )
    `);
  });
}

function buildEmailHtml(data) {
  return `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
      <h2 style="color: #1e3a8a;">DISC Assessment Submission</h2>
      <p><strong>Company:</strong> ${COMPANY_NAME}</p>
      <p><strong>Candidate Name:</strong> ${data.full_name}</p>
      <p><strong>Gender:</strong> ${data.gender}</p>
      <p><strong>Email:</strong> ${data.email}</p>
      <p><strong>Phone/WhatsApp:</strong> ${data.phone}</p>
      <p><strong>Position Applied:</strong> ${data.position_applied}</p>
      <p><strong>Education:</strong> ${data.education}</p>
      <p><strong>Campus:</strong> ${data.campus}</p>
      <p><strong>DISC Profile Type:</strong> ${data.profile_type}</p>

      <h3 style="color: #1e3a8a;">Scores</h3>
      <ul>
        <li>D: ${data.scores.D || 0}</li>
        <li>I: ${data.scores.I || 0}</li>
        <li>S: ${data.scores.S || 0}</li>
        <li>C: ${data.scores.C || 0}</li>
      </ul>

      <h3 style="color: #1e3a8a;">Submission Time</h3>
      <p>${new Date(data.submitted_at).toLocaleString()}</p>
    </div>
  `;
}

async function sendSubmissionEmail(candidateData) {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log('SMTP configuration is not set. Email was not sent.');
    console.log('Candidate submission saved locally.');
    return { ok: true, fallback: true };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: `"${COMPANY_NAME} DISC Assessment" <${SMTP_USER}>`,
    to: HR_EMAIL,
    subject: `DISC Assessment Submission - ${candidateData.full_name}`,
    html: buildEmailHtml(candidateData),
  });

  return { ok: true, fallback: false };
}

app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    message: 'DISC Assessment API is running.',
    hr_email: HR_EMAIL,
    company_name: COMPANY_NAME,
  });
});

app.post('/api/submit-assessment', async (req, res) => {
  const payload = req.body || {};

  const requiredFields = [
    'fullName',
    'gender',
    'email',
    'phone',
    'position',
    'education',
    'campus',
    'profileType',
    'scores',
    'answers',
  ];

  const missing = requiredFields.filter((field) => {
    const value = payload[field];
    return value === undefined || value === null || String(value).trim() === '';
  });

  if (missing.length > 0) {
    return res.status(400).json({
      ok: false,
      message: 'Please complete all required fields before submitting.',
      missing,
    });
  }

  const submittedAt = new Date().toISOString();
  const candidateData = {
    full_name: String(payload.fullName).trim(),
    gender: String(payload.gender).trim(),
    email: String(payload.email).trim(),
    phone: String(payload.phone).trim(),
    position_applied: String(payload.position).trim(),
    education: String(payload.education).trim(),
    campus: String(payload.campus).trim(),
    profile_type: String(payload.profileType).trim(),
    scores: payload.scores || {},
    answers: payload.answers || {},
    submitted_at: submittedAt,
  };

  db.run(
    `
      INSERT INTO assessments (
        full_name,
        gender,
        email,
        phone,
        position_applied,
        education,
        campus,
        profile_type,
        scores,
        answers,
        submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      candidateData.full_name,
      candidateData.gender,
      candidateData.email,
      candidateData.phone,
      candidateData.position_applied,
      candidateData.education,
      candidateData.campus,
      candidateData.profile_type,
      JSON.stringify(candidateData.scores),
      JSON.stringify(candidateData.answers),
      candidateData.submitted_at,
    ],
    async function (err) {
      if (err) {
        console.error('Insert assessment error:', err.message);
        return res.status(500).json({ ok: false, message: 'Unable to save the assessment.' });
      }

      try {
        await sendSubmissionEmail(candidateData);
      } catch (emailError) {
        console.error('Email failed:', emailError.message);
      }

      return res.json({
        ok: true,
        message: 'Your assessment has been submitted successfully.',
      });
    }
  );
});

app.get('/admin.html', (req, res) => {
  res.redirect('/');
});

app.get('/admin', (req, res) => {
  res.redirect('/');
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  initDatabase();
  console.log(`DISC Assessment server running on http://localhost:${PORT}`);
  console.log(`HR email: ${HR_EMAIL}`);
});

module.exports = app;

