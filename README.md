<div align="center">

# VibeNet — End-to-End Encrypted Real-Time Chat Ecosystem

<p>
  <img alt="Architecture" src="https://img.shields.io/badge/Architecture-Multi--Repo%20Submodules-6E56CF?style=for-the-badge&logo=git&logoColor=white" />
  <img alt="Frontend" src="https://img.shields.io/badge/Frontend-React.js-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
  <img alt="Backend" src="https://img.shields.io/badge/Backend-Go-00ADD8?style=for-the-badge&logo=go&logoColor=white" />
</p>
<p>
  <img alt="PostgreSQL" src="https://img.shields.io/badge/Database-PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" />
  <img alt="DynamoDB" src="https://img.shields.io/badge/Database-Amazon%20DynamoDB-4053D6?style=for-the-badge&logo=amazondynamodb&logoColor=white" />
  <img alt="Security" src="https://img.shields.io/badge/Security-E2EE%20TweetNaCl.js-2EA44F?style=for-the-badge&logo=letsencrypt&logoColor=white" />
</p>

**The orchestrator repository for VibeNet — a scalable, WhatsApp-style chat platform with true End-to-End Encryption.**

[Architecture](#-ecosystem-architecture--visualizations) · [Why Submodules?](#-why-multi-repo--submodules) · [Navigation](#-repository-navigation-map) · [Setup](#-local-environment-cloning--setup)

</div>

---

## Overview

**VibeNet-Main** is the **orchestrator repository** that unifies the VibeNet platform into a single, coherent development workspace. It does not host application code directly — instead, it tracks two independent, standalone repositories as **Git Submodules** and centralizes the shared architecture documentation and cloud provisioning guides.

VibeNet itself is a real-time chat application where the server acts strictly as a **blind router**: it authenticates users, relays opaque ciphertext, and stores encrypted payloads — but **never decrypts, inspects, or logs plain-text messages**. Encryption and decryption happen entirely on the client using **TweetNaCl.js**.

> [!NOTE]
> This repository is the *entry point* for the ecosystem. Clone it recursively (see [Setup](#-local-environment-cloning--setup)) to pull the frontend and backend in one unified workspace.

---

## 🏗 Ecosystem Architecture & Visualizations

### Diagram A — Repository Topology (Submodule Orchestration)

This map shows how `VibeNet-Main` orchestrates the ecosystem: it owns the `.gitmodules` manifest and shared docs, while pinning each submodule folder to a specific commit in its own standalone GitHub repository.

```mermaid
flowchart TB
    subgraph MAIN["📦 VibeNet-Main — Orchestrator Repository"]
        direction TB
        GM([".gitmodules<br/><i>submodule manifest</i>"])
        README(["README.md<br/><i>this file</i>"])
        GUIDE(["AWS_SETUP_GUIDE.md<br/><i>infra provisioning</i>"])
        ARCH(["ARCHITECTURE.md<br/><i>system blueprint</i>"])

        subgraph SUBS["Tracked Submodule Pointers (gitlinks)"]
            direction LR
            FE_PTR["frontend/ @commit"]
            BE_PTR["backend/ @commit"]
        end
    end

    FE_REPO[("🌐 VibeNet-frontend<br/>Standalone GitHub Repo<br/>React.js SPA")]
    BE_REPO[("⚙️ VibeNet-backend<br/>Standalone GitHub Repo<br/>Go API + WebSocket Hub")]

    GM -.->|"declares"| FE_PTR
    GM -.->|"declares"| BE_PTR
    FE_PTR ==>|"pinned to commit"| FE_REPO
    BE_PTR ==>|"pinned to commit"| BE_REPO

    style MAIN fill:#1e1b2e,stroke:#6E56CF,color:#fff
    style SUBS fill:#2a2640,stroke:#8b7fd6,color:#fff
    style FE_REPO fill:#20344a,stroke:#61DAFB,color:#fff
    style BE_REPO fill:#123038,stroke:#00ADD8,color:#fff
```

### Diagram B — Structural Runtime View (Client → Edge → Dual-DB State)

This diagram maps the deployed runtime: the browser talks to a Vercel-hosted frontend and an EC2-hosted Go backend, which persists relational metadata and encrypted message history across two purpose-built databases.

```mermaid
flowchart LR
    subgraph CLIENT["🧑‍💻 Client Layer"]
        BROWSER["Browser<br/>React SPA + TweetNaCl.js<br/><i>E2EE happens here</i>"]
    end

    subgraph EDGE["☁️ Hosting / Edge"]
        VERCEL["Vercel<br/><b>VibeNet-frontend</b>"]
        EC2["AWS EC2 · nginx + systemd<br/><b>VibeNet-backend</b><br/>REST + WebSocket Hub"]
    end

    subgraph DATA["🗄 Dual-Database State"]
        PG[("PostgreSQL — AWS RDS<br/>Users · Contacts · Public Keys")]
        DDB[("Amazon DynamoDB<br/>Encrypted Messages")]
    end

    BROWSER -->|"HTTPS (static assets)"| VERCEL
    BROWSER -->|"REST · HTTPS"| EC2
    BROWSER <-->|"WSS · Encrypted Frames"| EC2
    EC2 -->|"Metadata R/W"| PG
    EC2 -->|"Async ciphertext persistence"| DDB

    style CLIENT fill:#1e1b2e,stroke:#6E56CF,color:#fff
    style EDGE fill:#0f2b33,stroke:#00ADD8,color:#fff
    style DATA fill:#14233b,stroke:#4169E1,color:#fff
```

> [!IMPORTANT]
> The backend is intentionally **content-blind**. It routes and stores only ciphertext and cryptographic metadata (`nonce`). Plain-text messages are never stored, logged, or processed server-side.

### Diagram C — Live Production Deployment (AWS EC2 Free Tier)

This is the **actual deployed topology** of the Go backend: a free DuckDNS subdomain resolves to the EC2 public IP, where **nginx** terminates TLS (Let's Encrypt) on `:443` and reverse-proxies to the always-on **systemd**-managed Go binary listening on `localhost:8080`. The backend reaches PostgreSQL and DynamoDB over the private VPC network.

```mermaid
flowchart LR
    subgraph NET["🌐 Public Internet"]
        USER["Client / Browser"]
        DUCK["DuckDNS<br/><i>vibenet-api.duckdns.org</i><br/>A record → EC2 IP"]
    end

    subgraph EC2["🖥 AWS EC2 · t3.micro · Ubuntu 24.04"]
        direction TB
        SG{{"Security Group<br/>SSH 22 → My IP<br/>HTTP 80 · HTTPS 443 → public"}}
        NGINX["nginx<br/>TLS termination :443<br/>Let's Encrypt / certbot<br/>WebSocket upgrade"]
        SVC["systemd: vibenet.service<br/><b>Go binary</b> :8080<br/><i>always-on · auto-restart</i>"]
        ENV[".env<br/><i>secrets · config</i>"]
    end

    subgraph AWS["🗄 AWS Managed Data (private VPC)"]
        RDS[("PostgreSQL — RDS<br/>SG-to-SG inbound")]
        DDB[("DynamoDB<br/>encrypted messages")]
    end

    USER -->|"resolve DNS"| DUCK
    DUCK -->|"HTTPS · WSS"| SG
    SG --> NGINX
    NGINX -->|"proxy_pass · localhost:8080"| SVC
    ENV -.->|"EnvironmentFile"| SVC
    SVC -->|"5432 · metadata"| RDS
    SVC -->|"IAM · ciphertext"| DDB

    style NET fill:#1e1b2e,stroke:#6E56CF,color:#fff
    style EC2 fill:#0f2b33,stroke:#00ADD8,color:#fff
    style AWS fill:#14233b,stroke:#4169E1,color:#fff
```

### Deployment Pipeline — What Ships the Backend

The provisioning path below reflects the exact sequence used to take the Go backend from a fresh EC2 instance to a public HTTPS endpoint. The full walkthrough lives in [`backend/docs/DEPLOYMENT.si.md`](backend/docs/DEPLOYMENT.si.md) (Sinhala) and [`backend/docs/DEPLOYMENT.md`](backend/docs/DEPLOYMENT.md) (English).

```mermaid
flowchart LR
    S1["1 · Launch EC2<br/>t3.micro · Ubuntu"]
    S2["2 · Security Group<br/>SSH · 80 · 443"]
    S3["3 · SSH in<br/>+ Go build<br/><i>2G swap for OOM</i>"]
    S4["4 · .env<br/>prod secrets"]
    S5["5 · RDS SG-to-SG<br/>connectivity"]
    S6["6 · systemd<br/>always-on"]
    S7["7 · DuckDNS<br/>+ nginx + certbot<br/>HTTPS 🔒"]

    S1 --> S2 --> S3 --> S4 --> S5 --> S6 --> S7

    style S1 fill:#20344a,stroke:#61DAFB,color:#fff
    style S2 fill:#20344a,stroke:#61DAFB,color:#fff
    style S3 fill:#123038,stroke:#00ADD8,color:#fff
    style S4 fill:#123038,stroke:#00ADD8,color:#fff
    style S5 fill:#14233b,stroke:#4169E1,color:#fff
    style S6 fill:#1e1b2e,stroke:#6E56CF,color:#fff
    style S7 fill:#123821,stroke:#2EA44F,color:#fff
```

| # | Stage | What happens | Result |
|---|-------|--------------|--------|
| **1** | **EC2 launch** | `t3.micro` (free tier), Ubuntu 24.04, RSA `.pem` key | Always-on host with public IP |
| **2** | **Security group** | SSH `22` → *My IP*; HTTP `80` + HTTPS `443` → public; `8080` closed after HTTPS | Locked-down inbound surface |
| **3** | **Build** | `apt` Go + git, `go build ./cmd/api`; **2 GB swap** added to survive the compiler OOM on 1 GB RAM | `vibenet-api` binary |
| **4** | **Config** | Production `.env` — fresh `JWT_SECRET`, RDS creds, IAM keys, `APP_ENV=production` | Runtime configured |
| **5** | **RDS connectivity** | Security-group-to-security-group rule (EC2 SG → RDS SG, port `5432`) | DB reachable privately, never public |
| **6** | **systemd service** | `vibenet.service` — `Restart=always`, `EnvironmentFile=.env`, enabled on boot | 24/7 auto-healing backend |
| **7** | **Domain + HTTPS** | Free **DuckDNS** subdomain → EC2 IP; **nginx** reverse proxy + **Let's Encrypt** (certbot) with auto-renewal & WebSocket upgrade headers | `https://vibenet-api.duckdns.org` 🔒 |

> [!TIP]
> Health is verifiable end-to-end at **`https://vibenet-api.duckdns.org/health`** — a single JSON payload reports liveness plus per-dependency status and latency for both PostgreSQL and DynamoDB.

---

## 🤔 Why Multi-Repo + Submodules?

VibeNet deliberately adopts a **multi-repository architecture stitched together with Git Submodules**, rather than a single flat monolith. This is a considered architectural decision, not an accident of history:

- **Separation of Concerns** — The React frontend and the Go backend have fundamentally different toolchains, dependency graphs, test suites, and release cadences. Isolating them into standalone repositories keeps each codebase focused, navigable, and free of cross-domain noise.

- **Decoupled Deployment Pipelines** — Each repository owns its own CI/CD. A push to `VibeNet-frontend` triggers a **Vercel** deployment; a push to `VibeNet-backend` triggers a **Docker image build deployed to AWS EC2**. Neither pipeline blocks or contaminates the other, enabling truly independent release velocity.

- **Efficient Repository Boundaries** — Contributors can clone, build, and iterate on a single component without downloading the entire ecosystem. Access, issues, and versioning are scoped cleanly per repository.

- **Unified Local Workspace** — Despite living in separate repositories, `VibeNet-Main` reassembles the full stack into **one coherent local checkout** via submodules. Developers get the best of both worlds: strict boundaries in the cloud, a single integrated workspace on their machine.

> [!TIP]
> Submodule pointers are **commit-pinned**. `VibeNet-Main` always references an exact, reproducible commit of each component — so a fresh recursive clone yields a known-good, buildable snapshot of the entire platform.

---

## 🗺 Repository Navigation Map

```text
VibeNet-Main/
├── .gitmodules              # Submodule manifest — declares URLs & paths
├── README.md               # This orchestrator overview
├── ARCHITECTURE.md         # Deep system design & E2EE blueprint
├── AWS_SETUP_GUIDE.md      # Step-by-step cloud infrastructure provisioning
│
├── backend/  → (Git Submodule)  ➜  VibeNet-backend
└── frontend/ → (Git Submodule)  ➜  VibeNet-frontend
```

| Path | Type | Responsibility |
|------|------|----------------|
| **`/backend`** | Git Submodule | Go core — REST APIs, JWT + Google OAuth, WebSocket Hub, and the dual PostgreSQL / DynamoDB persistence handlers. |
| **`/frontend`** | Git Submodule | React single-page application — E2EE key generation & management (TweetNaCl.js), real-time chat UI, and Tailwind CSS layout. |
| **`AWS_SETUP_GUIDE.md`** | Document | Beginner-friendly, step-by-step provisioning for JWT, Google OAuth, AWS RDS (PostgreSQL), DynamoDB, and IAM credentials. |
| **`ARCHITECTURE.md`** | Document | The system blueprint: dual-database strategy, E2EE message flow, and anti-spam design. |

---

## 🚀 Local Environment Cloning & Setup

### 1. Recursive Clone (recommended)

Fetch the orchestrator **and** both submodules in a single command:

```bash
git clone --recursive https://github.com/ChamathDilshanC/VibeNet-Main.git
cd VibeNet-Main
```

> [!NOTE]
> The `--recursive` flag ensures `frontend/` and `backend/` are populated in the same operation. Without it, those folders would clone as empty placeholders.

### 2. Already cloned without `--recursive`?

If you cloned the main repo first and the submodule folders are empty, initialize them:

```bash
git submodule update --init --recursive
```

### 3. Keeping submodules in sync

To pull the latest commits for every submodule from their respective remotes:

```bash
git submodule update --init --recursive --remote
```

> [!WARNING]
> After `--remote` advances a submodule to a newer commit, that change appears as a modified gitlink in `VibeNet-Main`. Commit it here to **pin the ecosystem to the updated versions** — otherwise collaborators will still resolve the older pinned commits.

### 4. Configure & run each component

Each submodule ships its own README with detailed instructions. In brief:

```bash
# Backend — provision your .env first (see AWS_SETUP_GUIDE.md)
cd backend && cp .env.example .env && go run ./cmd/api

# Frontend
cd ../frontend && npm install && npm run dev
```

---

<div align="center">

### Architected and developed by **Chamath Dilshan** ([@ChamathDilshanC](https://github.com/ChamathDilshanC))

<sub>VibeNet — Secure by design. Encrypted end-to-end. Built to scale on the AWS Free Tier.</sub>

</div>
