# Shop Inventory Backend

This backend is built with Express and stores data in a local JSON file (`db.json`). It is designed to work with the frontend in the parent repository.

## Install

```bash
cd backend
npm install
```

## Start server

```bash
npm start
```

If port `8000` is already in use in PowerShell:

```powershell
$env:PORT=8001; npm start
```

## Development

```bash
npm run dev
```

## Default API base URL

`http://localhost:8000/api`

The frontend development server proxies `/api` to this URL by default.
