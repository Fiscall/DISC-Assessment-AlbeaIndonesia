# DISC Assessment App

This repository contains a full DISC Assessment web application with:

- Token-based candidate access
- 3-day expiry logic
- Used-token blocking with message: `This code has already been used.`
- No login required for candidates
- Admin dashboard for candidate reporting

## Features

- Candidate enters a token to begin the assessment
- Token must be valid and `UNUSED`
- Token expires automatically after 3 days
- Candidate cannot reuse a used token
- Admin can generate tokens and view candidate completion reports

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the app:
   ```bash
   npm start
   ```

3. Open the app in your browser:
   - Candidate page: `http://localhost:3000/`
   - Admin page: `http://localhost:3000/admin.html`

## Admin access

The default admin access key is:

```text
admin123
```

You can override it in the environment:

```bash
ADMIN_KEY=mysecretkey npm start
```

## Notes

- This uses a local SQLite database in `data/disc.db`
- The app is meant for local deployment or hosting on a Node runtime environment
- GitHub Pages alone cannot host the token validation backend securely

## Production note

For production deployment, use a real web host with a backend and database, such as:

- Render
- Railway
- Fly.io
- Heroku
- Azure App Service
- VPS with Node.js
