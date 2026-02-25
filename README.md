# ⚡ EcoApex — Autonomous Eco-Orchestrator

> **Predictive Digital Twin · AMD Ryzen™ AI Edge Inference · Harmony Token Economy**

EcoApex is a real-time hostel energy management platform that uses a digital twin simulation, AI-powered nudge engine, and a circular token economy ($HARMONY) to reduce campus energy consumption. Built for edge deployment on AMD hardware — no cloud GPU required.

🌐 **Live Demo:** [https://ecoapex.onrender.com](https://ecoapex.onrender.com)

---

## 📸 Screenshots

| Energy Overview | AI Nudges | Hardware Status |
|----------------|-----------|-----------------|
| Live kWh tracking across 5 wings | Context-aware micro-interventions | AMD Ryzen™ AI edge detection |

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    BROWSER (Any Device)                     │
│   hostelharmony.html — Single-page dashboard                │
│   src/js/ — ES Module frontend (no build step needed)       │
└─────────────────────┬───────────────────────────────────────┘
                      │  HTTP + Server-Sent Events (SSE)
┌─────────────────────▼───────────────────────────────────────┐
│              EcoApex Edge Server (Node.js)                  │
│              server/index.js — Port 8787                    │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Digital Twin │  │  AI Nudge    │  │ Harmony Ledger   │  │
│  │ Simulator    │  │  Engine      │  │ Token Economy    │  │
│  └─────────────┘  └──────────────┘  └──────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Inference Layer                         │   │
│  │  Remote TFT Model → Local Heuristic Fallback        │   │
│  │  (Never goes down — always has a fallback)          │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│              AMD Edge Hardware Layer                        │
│  check_amd_edge.py — Hardware probe diagnostic tool        │
│  Detects: ROCm · DirectML · Ryzen™ AI NPU · XDNA          │
└─────────────────────────────────────────────────────────────┘
```

---

## ✨ Features

### 🔋 Energy Management
- **Real-time digital twin** — simulates all 5 hostel wings every 4 seconds
- **Live energy tracking** — total kWh, CO2 saved, active rooms, wings over quota
- **Hourly usage heatmap** — 7-day × 24-hour grid with thermal colour mapping
- **Digital twin forecast** — predicts end-of-day energy budget usage

### 🤖 AI Nudge Engine
- **Context-aware micro-interventions** — detects over-quota and vampire load patterns
- **Deep Freeze nudges** — triggered when wing is in class and load is high
- **Vampire load detection** — catches standby power waste in low-occupancy rooms
- **Cooldown system** — prevents nudge fatigue with configurable cooldown periods
- **Coverage rotation** — ensures all wings get nudge attention fairly

### 💰 Harmony Token Economy ($HARMONY)
- Wings **earn tokens** by accepting energy nudges and beating quota
- Students **spend tokens** on real hostel utilities:
  - 🧺 Priority Laundry — 40 tokens
  - ❄️ Extended AC +1hr — 65 tokens
  - 🍽️ Cafeteria Voucher — 30 tokens
- Full **audit ledger** — every mint, redeem, and adjust transaction is recorded

### 🔐 Role-Based Access Control (RBAC)
| Role | Permissions |
|------|-------------|
| **Admin** | All wings · Global nudge override · Ingest sensor data |
| **Operator** | All wings · Monitor · Push overrides |
| **Wing Manager** | Own wing only · Monitor |
| **Student** | Own wing · Accept nudges · Spend tokens |

### ⚡ Hardware Status
- Live AMD Ryzen™ AI edge detection display
- NPU utilisation · CPU load · RAM budget · Inference latency
- Real-time runtime log scrolling
- Hardware probe diagnostic tool (`check_amd_edge.py`)

---

## 🧠 Inference Architecture

EcoApex uses a **two-layer inference system** that never goes offline:

```
Layer 1 — Remote TFT Model
  Temporal Fusion Transformer at port 8790
  Time-series energy forecasting
         ↓ (if unavailable)
Layer 2 — Local Heuristic Fallback
  Circadian rhythm modelling
  Class schedule factor (08:00–16:00 = 0.88x load)
  Temperature pressure coefficient
  Occupancy-weighted baseline
  → Always operational, zero external dependencies
```

---

## 📁 Project Structure

```
EcoApex/
│
├── hostelharmony.html          # Main single-page dashboard
├── package.json                # Node.js project config
├── check_amd_edge.py           # AMD hardware probe tool
│
├── server/
│   ├── index.js                # Edge server (Node built-in http only)
│   ├── auth-store.js           # RBAC session management
│   ├── inference-client.js     # TFT remote + local fallback
│   ├── inference-service.js    # Inference service layer
│   ├── ledger-store.js         # Token transaction ledger
│   ├── simulator.js            # Wing state simulator
│   └── data/
│       ├── users.json          # User credentials (gitignored)
│       └── ledger.json         # Token ledger (gitignored)
│
└── src/
    ├── config/
    │   └── wings.json          # Wing configuration
    └── js/
        ├── main.js             # App bootstrap + edge/local mode
        ├── api-client.js       # REST + SSE client
        ├── ui.js               # All DOM rendering
        ├── twin.js             # Digital twin engine
        ├── nudges.js           # Nudge generation logic
        ├── economy.js          # Token economy logic
        ├── config-loader.js    # Config loading
        └── default-config.js   # Default wing config
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18 or higher
- **Python** 3.8+ (for hardware diagnostic only)

### Installation

**1. Clone the repository**
```bash
git clone https://github.com/Debmalya006/EcoApex.git
cd EcoApex
```

**2. Install dependencies**
```bash
npm install
```

**3. Start the edge server**
```bash
npm start
```

**4. Open in browser**
```
http://localhost:8787
```

---

## 🔑 Demo Login Credentials

### Student Accounts
| Student ID | Wing | Username | Password |
|-----------|------|----------|----------|
| STU-ALPHA-2026 | Alpha Wing | student_alpha | stu_alpha123 |
| STU-BETA-2026 | Beta Wing | student_beta | stu_beta123 |
| STU-GAMMA-2026 | Gamma Wing | student_gamma | stu_gamma123 |
| STU-DELTA-2026 | Delta Wing | student_delta | stu_delta123 |
| STU-EPSILON-2026 | Epsilon Wing | student_epsilon | stu_epsilon123 |

### Admin Account
| Username | Password | Role |
|----------|----------|------|
| admin | admin123 | Full access |
| operator | operator123 | Operator access |

> ⚠️ These are demo credentials for development only. Change all passwords before any production deployment.

---

## ⚡ AMD Edge Hardware Diagnostic

Run the hardware probe tool to detect AMD acceleration capabilities:

```bash
python check_amd_edge.py
```

**Example output on AMD Ryzen machine:**
```
+======================================================+
|     EcoApex Edge-Ready Diagnostic Tool v1.1          |
|     AMD Ryzen™ AI Hardware Probe Layer               |
+======================================================+

--- CPU Architecture Detection ---
[✅] AMD Processor Confirmed: AMD64 Family 23, AuthenticAMD
[✅] AMD Ryzen Generation: Zen+ / Zen2 Architecture Detected
     - Logical Cores: 8 (available for parallel edge inference)

--- EcoApex Edge Server Health ---
[✅] Edge server is LIVE on localhost:8787

--- System Memory ---
[✅] RAM available: 2906 MB free of 15610 MB total
[✅] Sufficient memory for EcoApex edge inference runtime

--- Inference Mode Summary ---
  | Hardware : AMD x86_64 (AuthenticAMD)    |
  | Mode     : Local Heuristic Fallback     |
  | Cores    : 8 logical cores              |
  | Status   : OPERATIONAL                  |
```

**What the tool detects:**
| Check | Technology | Platform |
|-------|-----------|----------|
| ROCm GPU | AMD GPU acceleration | Linux |
| DirectML | Windows ML stack | Windows |
| NPU Driver | Ryzen™ AI XDNA chip | Windows |
| XRT Runtime | XDNA on Linux servers | Linux |
| Edge Server | localhost:8787 health | Both |
| System RAM | Available inference budget | Both |

---

## 🌐 API Reference

All endpoints require a Bearer token except `/api/auth/*` and `/api/config`.

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | Public | Login with username/password |
| POST | `/api/auth/guest` | Public | Get guest session token |
| GET | `/api/auth/me` | Any | Get current user info |
| GET | `/api/state` | Any | Get full system snapshot |
| GET | `/api/stream` | Any | SSE real-time event stream |
| GET | `/api/config` | Public | Get wing configuration |
| POST | `/api/ingest` | Admin | Push sensor data |
| POST | `/api/actions/accept-trade` | Student | Accept nudge + mint tokens |
| POST | `/api/actions/spend` | Student | Spend tokens on utility |
| POST | `/api/actions/global-nudge` | Admin | Push campus-wide override |
| GET | `/api/ledger/balances` | Any | Get wing token balances |
| GET | `/api/ledger/transactions` | Any | Get transaction history |
| GET | `/api/health` | Public | Server + inference health |

---

## ⚙️ Environment Variables

Set these in your deployment platform (Render, Railway, etc.):

| Variable | Default | Description |
|----------|---------|-------------|
| `ECOAPEX_PORT` | `8787` | Server port |
| `ECOAPEX_INFERENCE_URL` | `http://localhost:8790` | Remote TFT model URL |
| `ECOAPEX_NUDGE_COOLDOWN_SEC` | `30` | Nudge cooldown in seconds |
| `ECOAPEX_ALLOWED_ORIGINS` | `*` | CORS allowed origins |
| `ECOAPEX_INFERENCE_TIMEOUT_MS` | `1500` | Remote inference timeout |

---

## 🏠 Hostel Wings Configuration

| Wing | Rooms | Initial Load | Initial Tokens |
|------|-------|-------------|----------------|
| Alpha | 124 | 470 kW | 98 |
| Beta | 110 | 498 kW | 84 |
| Gamma | 98 | 525 kW | 71 |
| Delta | 88 | 510 kW | 59 |
| Epsilon | 127 | 545 kW | 38 |

All wing parameters are configurable via `src/config/wings.json`.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML · CSS · ES Modules (no framework, no build) |
| Backend | Node.js 18+ · Built-in `http` module only (zero dependencies) |
| Real-time | Server-Sent Events (SSE) |
| Auth | Crypto-based session tokens (Node built-in `crypto`) |
| Storage | In-memory state + JSON file persistence |
| Inference | Temporal Fusion Transformer (remote) + Heuristic fallback (local) |
| Hardware | AMD Ryzen™ AI · ROCm · DirectML · XDNA NPU |
| Hosting | Render (cloud) · localhost:8787 (edge) |
| Diagnostics | Python 3.8+ hardware probe |

---

## 📊 Data Flow

```
IoT Sensors / Simulator
        ↓  (POST /api/ingest every 4s)
Edge Server State (in-memory)
        ↓
Inference Engine (TFT or Heuristic)
        ↓
Nudge Engine (over-quota + vampire detection)
        ↓
SSE Broadcast → All connected browsers
        ↓
UI renders: stats · chart · heatmap · nudges · ledger
        ↓
Student accepts nudge → Tokens minted → Ledger updated
```

---

## 🚢 Deployment

### Deploy to Render (Recommended)

1. Fork this repository
2. Go to [render.com](https://render.com) → New Web Service
3. Connect your GitHub repo
4. Set build command: `npm install`
5. Set start command: `node server/index.js`
6. Add environment variables (see table above)
7. Click Deploy

### Deploy to Railway

1. Go to [railway.app](https://railway.app) → New Project
2. Deploy from GitHub → Select this repo
3. Add environment variables
4. Railway auto-detects Node.js and deploys

---

## 👥 Team

**Debmalya** — [github.com/Debmalya006](https://github.com/Debmalya006)

Built for the AMD Hackathon — Edge AI on AMD Ryzen™ AI hardware.

---

## 📄 License

This project is built for educational and demonstration purposes.

---

## 🙏 Acknowledgements

- **AMD** — Ryzen™ AI NPU architecture and edge inference documentation
- **Render** — Cloud hosting platform
- **Node.js** — Zero-dependency edge server runtime
- **UptimeRobot** — Free uptime monitoring

---

<div align="center">
  <strong>EcoApex — Making every kWh count, one nudge at a time. ⚡</strong>
</div>
