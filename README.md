# Warehouse Management App — FastAPI + MySQL

This build turns your existing frontend into a single FastAPI app that:
- serves the frontend itself
- stores the shared warehouse layout in MySQL as one JSON document
- auto-saves the full JSON every 2 seconds after changes
- syncs changes from other users every 3 seconds
- uses Google Sign-In on the frontend and verifies the credential on the backend
- stores users and roles in MySQL

## Folder structure

```text
warehouse_app/
  main.py
  requirements.txt
  .env.example
  README.md
  static/
    index.html
    style.css
    app.js
```

## What changed from your old build

Your old version saved the layout and user roles only inside the browser.
This version moves both to MySQL.

### Shared layout behavior
- one shared layout for all users
- last write wins
- every change saves the whole layout JSON to the database
- other users see updates after the next poll cycle

### Roles
- first Google account that signs in becomes `admin`
- every next account becomes `viewer`
- admin can change users to `editor` or `admin`
- `editor` and `admin` can save layout changes
- `viewer` can only view

## 1) Create the MySQL database

Example in MySQL:

```sql
CREATE DATABASE warehouse_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## 2) Create and fill `.env`

Copy `.env.example` to `.env` and edit it.

Minimum required values:
- `DATABASE_URL`
- `SESSION_SECRET`
- `GOOGLE_CLIENT_ID`

Example:

```env
DATABASE_URL=mysql+pymysql://root:yourpassword@127.0.0.1:3306/warehouse_app?charset=utf8mb4
SESSION_SECRET=super-long-random-secret-here
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
CORS_ORIGINS=http://127.0.0.1:8000,http://localhost:8000
```

## 3) Install Python dependencies

```bash
pip install -r requirements.txt
```

## 4) Run the server

```bash
uvicorn main:app --reload
```

Run that command from inside the `warehouse_app` folder.

## 5) Open the app

Open:

```text
http://127.0.0.1:8000
```

Do not open `index.html` by double-clicking anymore.
Open the app through FastAPI so login, API calls, and cookies all work correctly.

## 6) Google setup you still need to do

You still need your own Google OAuth Web Client ID.
Use the value in `.env` as `GOOGLE_CLIENT_ID`.
For local development, your Google OAuth web app should allow your localhost / 127.0.0.1 app origin.

## Main API routes

- `GET /api/config`
- `POST /api/auth/google`
- `POST /api/logout`
- `GET /api/me`
- `GET /api/users`
- `PATCH /api/users/{email}/role`
- `GET /api/layout`
- `GET /api/layout/meta`
- `PUT /api/layout`

## Notes

- The top bar `Save` button still exports a JSON file backup.
- The top bar `Load` button still imports a JSON file.
- Auto-save to MySQL is separate and happens automatically.
- Tent tab selection is kept locally per browser so switching tabs does not force every other user into the same tent.
