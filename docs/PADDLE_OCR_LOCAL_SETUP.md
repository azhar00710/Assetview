# Local Paddle OCR Setup

This project now includes a local Paddle OCR service you can reuse in future sessions.

## Saved Location

- Service code: `services/paddle-ocr/`
- Docker service: `docker-compose.yml` under `paddle-ocr`
- Backend env wiring: `docker-compose.yml` (`PADDLE_OCR_URL` defaults to `http://paddle-ocr:8000/ocr`)

## Files Added

- `services/paddle-ocr/app.py`
- `services/paddle-ocr/Dockerfile`
- `services/paddle-ocr/requirements.txt`

## Start It

From repo root:

```bash
docker compose up -d --build paddle-ocr backend
```

The Paddle service is exposed on host:

- Health: `http://localhost:8010/health`
- OCR endpoint: `http://localhost:8010/ocr`

Backend (inside docker network) calls:

- `http://paddle-ocr:8000/ocr`

## Optional API Key

Set in `.env`:

```bash
PADDLE_OCR_API_KEY=your_key_here
```

If set, callers must send either:

- `x-api-key: <key>`, or
- `Authorization: Bearer <key>`

## Test Quickly

```bash
docker compose ps
```

Then:

```bash
curl http://localhost:8010/health
```

And verify OCR provider config from API:

```bash
curl http://localhost:3001/api/v1/ocr-pipeline/platforms/<platformId>/ocr-provider
```

Expected: `options` includes `paddle` and `paddleReady: true` when backend runs in docker with default URL.
