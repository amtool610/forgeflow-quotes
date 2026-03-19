# ForgeFlow Quotes

ForgeFlow Quotes is a machine shop estimating MVP designed for two phases:

1. Start with a rules-based estimator for uploaded STP files, material, and quantity.
2. Collect real-world machining records so a trained model can replace or augment the estimator later.

## What the app includes

- Customer landing page with instant estimate preview.
- Customer signup/login and account page.
- Customer quote request submission with uploaded STP file.
- Admin-only dashboard.
- Admin training-data intake with STP file, material, quantity, actual price, machine type, and notes.
- Local JSON storage so the workflow works without a database.
- Estimator service isolated in `lib/estimator.js` so a trained model can be plugged in later.

## Seed admin login

- Email: `admin@machineshop.local`
- Password: `admin123`

## Run the app

```bash
node server.js
```

Then open [http://localhost:3000](http://localhost:3000).

## Data storage

- App data: `data/db.json`
- Uploaded files: `uploads/`

## Future model integration

Today the app calls `estimateQuote()` in `lib/estimator.js`.

When your trained model is ready, replace that function with one that:

- Parses STP-derived features.
- Uses historical jobs in `trainingRecords`.
- Returns the same response shape used by the UI.

## Cloud deployment

This repo is now ready for container-based deployment.

### Option 1: Render

1. Push this repo to GitHub.
2. In Render, create a new Blueprint instance from the repo.
3. Render will detect `render.yaml` and build from `Dockerfile`.
4. The blueprint mounts a persistent disk at `/var/forgeflow` so training data and uploads survive restarts.
5. After deploy, open the generated Render URL.

### Option 2: Any container host

Build and run:

```bash
docker build -t forgeflow-quotes .
docker run -p 3000:3000 forgeflow-quotes
```

Suitable targets include Render, Railway, Fly.io, Azure Container Apps, AWS App Runner, and any VPS with Docker.
