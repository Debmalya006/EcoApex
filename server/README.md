# EcoApex Step 5 (Inference Boundary + Auth + Ledger)

Step 4 introduces a dedicated inference boundary:

- `server/inference-service.js` (model service)
- `server/inference-client.js` (edge adapter with fallback)
- `server/index.js` now calls inference via the adapter

Step 5 adds:

- persistent token ledger (`server/data/ledger.json`)
- auth + wing-scoped sessions (`server/data/users.json`)
- redeem/mint transaction history APIs
- multi-tier role actions (`student`, `wing_manager`, `operator`, `admin`)
- admin global override endpoint (`/api/actions/global-nudge`)

## Run inference service (separate process)

```powershell
node .\server\inference-service.js
```

Default URL:

```text
http://localhost:8790
```

## Run edge server

```powershell
node .\server\index.js
```

Server starts at:

```text
http://localhost:8787
```

This serves both:

- `hostelharmony.html` frontend
- API endpoints under `/api/*`

You can override inference endpoint for edge server:

```powershell
$env:ECOAPEX_INFERENCE_URL = "http://localhost:8790"
node .\server\index.js
```

## API endpoints

- `GET /api/health`
- `GET /api/config`
- `GET /api/state`
- `GET /api/stream` (Server-Sent Events)
- `POST /api/auth/guest`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/ingest`
- `POST /api/actions/accept-trade`
- `POST /api/actions/spend`
- `POST /api/actions/global-nudge`
- `GET /api/inference/status`
- `GET /api/ledger/balances`
- `GET /api/ledger/transactions`

## Demo users (created on first run)

File: `server/data/users.json`

- `admin / admin123` (`admin`, all wings)
- `operator / operator123` (`operator`, all wings)
- `alpha_manager / alpha123` (`wing_manager`, Alpha only)
- `beta_manager / beta123` (`wing_manager`, Beta only)
- `student_alpha / stu_alpha123` (`student`, Alpha only)
- `student_beta / stu_beta123` (`student`, Beta only)
- `student_gamma / stu_gamma123` (`student`, Gamma only)

## Auth flow (PowerShell)

```powershell
$guest = Invoke-RestMethod -Method Post -Uri "http://localhost:8787/api/auth/guest" -ContentType "application/json" -Body "{}"
$token = $guest.token
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Method Get -Uri "http://localhost:8787/api/auth/me" -Headers $headers
```

## Test ingest with PowerShell (authenticated)

```powershell
$guest = Invoke-RestMethod -Method Post -Uri "http://localhost:8787/api/auth/guest" -ContentType "application/json" -Body "{}"
$headers = @{ Authorization = "Bearer $($guest.token)" }

$payload = @{
  source = "manual"
  records = @(
    @{ wing = "Alpha"; occupancyPct = 0.42; loadNowKw = 520; baselineLoadKw = 310; tempC = 30.2 },
    @{ wing = "Gamma"; occupancyPct = 0.36; loadNowKw = 540; baselineLoadKw = 320; tempC = 31.0 }
  )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post -Uri "http://localhost:8787/api/ingest" -Headers $headers -ContentType "application/json" -Body $payload
```

## Optional sensor simulator

```powershell
node .\server\simulator.js
```

This continuously posts randomized telemetry batches to `/api/ingest`.

## Ledger history query

```powershell
$guest = Invoke-RestMethod -Method Post -Uri "http://localhost:8787/api/auth/guest" -ContentType "application/json" -Body "{}"
$headers = @{ Authorization = "Bearer $($guest.token)" }
Invoke-RestMethod -Method Get -Uri "http://localhost:8787/api/ledger/transactions?limit=20&type=redeem" -Headers $headers
```

## Quick integration check

1. Start inference service.
2. Start edge server.
3. Request:

```powershell
Invoke-RestMethod -Uri "http://localhost:8787/api/inference/status"
```

`status.mode` should be `remote` when inference service is reachable.
