# Shop Inventory

Full-stack shop inventory application with separate backend and frontend projects.

## Backend

```powershell
cd backend
npm install
npm start
```

The backend runs at `http://localhost:8000`.

## Frontend

```powershell
cd frontend
npm install
npm start
```

The frontend runs at `http://localhost:5173` and proxies `/api` to the backend.

## Production Environment

For a deployed frontend, set this Vercel environment variable:

```env
VITE_API_BASE_URL=https://your-backend-domain.com/api
```

For a deployed backend, set these backend environment variables:

```env
MONGO_URI=your_mongodb_connection_string
FRONTEND_ORIGIN=https://shop-inventory-gamma.vercel.app
```

The Vite dev proxy only works locally. In production, the frontend must know the real backend API URL through `VITE_API_BASE_URL`.
