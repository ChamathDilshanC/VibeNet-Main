# VibeNet — Environment & Cloud Setup Guide

This guide walks you **step-by-step** through obtaining every value in the backend `.env` file. It is written for beginners — no prior AWS or Google Cloud experience required.

Create your `.env` from the template first:

```bash
cd backend
cp .env.example .env
```

Then fill in each value using the sections below.

```dotenv
# Server
APP_ENV=development
APP_PORT=8080
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000

# JWT Authentication
JWT_SECRET=your_super_secret_jwt_key_change_in_production
JWT_EXPIRY_HOURS=72

# Google OAuth 2.0
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URL=http://localhost:8080/api/auth/google/callback

# PostgreSQL (AWS RDS)
POSTGRES_HOST=your-rds-endpoint.region.rds.amazonaws.com
POSTGRES_PORT=5432
POSTGRES_USER=vibenet_admin
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=vibenet
POSTGRES_SSLMODE=require

# Amazon DynamoDB
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
DYNAMODB_MESSAGES_TABLE=vibenet-messages
```

> ⚠️ **SECURITY WARNING:** Never commit your real `.env` file to git. Confirm `.env` is listed in `.gitignore`. Only `.env.example` (with placeholder values) belongs in version control.

The `APP_ENV`, `APP_PORT`, `CORS_ALLOWED_ORIGINS`, and `JWT_EXPIRY_HOURS` values above are safe local defaults — leave them as-is for development. The remaining secrets are covered below.

---

## Table of Contents

1. [JWT Setup](#1-jwt-setup)
2. [Google Cloud Console Setup (OAuth 2.0)](#2-google-cloud-console-setup-oauth-20)
3. [AWS RDS (PostgreSQL) Free Tier Setup](#3-aws-rds-postgresql-free-tier-setup)
4. [AWS DynamoDB Setup](#4-aws-dynamodb-setup)
5. [AWS IAM Setup (Access Keys)](#5-aws-iam-setup-access-keys)

---

## 1. JWT Setup

`JWT_SECRET` is the private key used to cryptographically sign authentication tokens. It must be a **long, unpredictable, random string**. Anyone who obtains it can forge valid logins for any user.

### Generate a secure secret

Pick whichever command matches your machine:

**macOS / Linux (OpenSSL):**

```bash
openssl rand -base64 48
```

**macOS / Linux (no OpenSSL):**

```bash
head -c 48 /dev/urandom | base64
```

**Windows (PowerShell):**

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

**Cross-platform (Node.js):**

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Copy the output into your `.env`:

```dotenv
JWT_SECRET=Xk9v2...your_generated_value...q7Rf=
JWT_EXPIRY_HOURS=72
```

> ⚠️ **SECURITY WARNING:** Use a **different** `JWT_SECRET` in production than in development. Never reuse the placeholder value. If a secret is ever leaked, rotate it immediately — all existing tokens become invalid, forcing users to log in again (this is expected and safe).

---

## 2. Google Cloud Console Setup (OAuth 2.0)

This enables the **Sign in with Google** button. You will produce a `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### 2.1 Create a project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Click the **project dropdown** at the top of the page, then click **New Project**.
3. Name it `VibeNet` and click **Create**.
4. Make sure the new **VibeNet** project is selected in the dropdown before continuing.

### 2.2 Configure the OAuth Consent Screen

1. In the left menu, go to **APIs & Services → OAuth consent screen**.
2. Choose **External** as the User Type, then click **Create**.
3. Fill in the required fields:
   - **App name:** `VibeNet`
   - **User support email:** your email
   - **Developer contact email:** your email
4. Click **Save and Continue** through the **Scopes** step (defaults are fine).
5. On the **Test users** step, click **Add Users** and add your own Google email. Click **Save and Continue**.

> 📝 **NOTE:** While the app is in **Testing** mode, only the emails you add as *Test users* can log in. This is perfect for development. Publishing the app is only needed for public production use.

### 2.3 Create Web Application credentials

1. Go to **APIs & Services → Credentials**.
2. Click **+ Create Credentials → OAuth client ID**.
3. For **Application type**, select **Web application**.
4. Name it `VibeNet Web Client`.
5. Under **Authorized redirect URIs**, click **+ Add URI** and enter **exactly**:

   ```
   http://localhost:8080/api/auth/google/callback
   ```

   > ⚠️ **IMPORTANT:** This must match `GOOGLE_REDIRECT_URL` in your `.env` **character-for-character**, or Google will reject the login with a `redirect_uri_mismatch` error. For production, add your deployed HTTPS callback URL here too.
6. Click **Create**.

### 2.4 Copy your Client ID & Secret

A dialog appears showing **Your Client ID** and **Your Client Secret**. Copy both into your `.env`:

```dotenv
GOOGLE_CLIENT_ID=1234567890-abcdefg.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your_secret_here
GOOGLE_REDIRECT_URL=http://localhost:8080/api/auth/google/callback
```

> ⚠️ **SECURITY WARNING:** The Client Secret is confidential. Never expose it in frontend code or public repositories — it belongs only in the backend `.env`.

---

## 3. AWS RDS (PostgreSQL) Free Tier Setup

This provisions the relational database that stores users, contacts, and public keys.

### 3.1 Create the database

1. Sign in to the [AWS Management Console](https://console.aws.amazon.com/) and open the **RDS** service.
2. Confirm your region (top-right corner) matches your intended `AWS_REGION`, e.g. **US East (N. Virginia) / us-east-1**.
3. Click **Create database**.
4. Choose **Standard create**.
5. **Engine type:** select **PostgreSQL**.
6. **Templates:** select **Free tier**.

   > 💰 **FREE TIER NOTE:** The Free tier automatically restricts you to a `db.t3.micro` (or `db.t4g.micro`) instance, 20 GB storage, and single-AZ — all within the 12-month AWS Free Tier. Avoid enabling Multi-AZ or larger instances to stay free.

### 3.2 Set credentials & identifiers

Under **Settings**:

- **DB instance identifier:** `vibenet-db`
- **Master username:** `vibenet_admin` → this becomes `POSTGRES_USER`
- **Master password:** choose a strong password → this becomes `POSTGRES_PASSWORD`

Under **Additional configuration** (near the bottom):

- **Initial database name:** `vibenet` → this becomes `POSTGRES_DB`

  > ⚠️ **IMPORTANT:** If you skip *Initial database name*, RDS will **not** create the `vibenet` database and the backend will fail to connect. Do not leave it blank.

### 3.3 Configure Public Access & Security Group (Port 5432)

Under **Connectivity**:

1. Set **Public access** to **Yes** (required so you can connect from your local machine during development).
2. Under **VPC security group**, choose **Create new** and name it `vibenet-db-sg`.
3. Click **Create database** and wait a few minutes until **Status** shows **Available**.

Now open port **5432** to your machine:

1. Open your database, go to the **Connectivity & security** tab, and click the **VPC security group** link.
2. Select the security group, open the **Inbound rules** tab, and click **Edit inbound rules**.
3. Click **Add rule**:
   - **Type:** `PostgreSQL` (this auto-fills **Port 5432**)
   - **Source:** **My IP** (recommended for development)
4. Click **Save rules**.

> ⚠️ **SECURITY WARNING:** Do **not** set the source to `0.0.0.0/0` (Anywhere). That exposes your database to the entire internet. Always restrict to **My IP**, or to your application server's security group in production.

### 3.4 Find the Endpoint

1. Open your `vibenet-db` database in the RDS console.
2. On the **Connectivity & security** tab, copy the **Endpoint** value (it looks like `vibenet-db.abc123xyz.us-east-1.rds.amazonaws.com`).

Fill in your `.env`:

```dotenv
POSTGRES_HOST=vibenet-db.abc123xyz.us-east-1.rds.amazonaws.com
POSTGRES_PORT=5432
POSTGRES_USER=vibenet_admin
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=vibenet
POSTGRES_SSLMODE=require
```

> 🔐 **TLS NOTE:** Keep `POSTGRES_SSLMODE=require`. AWS RDS supports encrypted connections by default, and requiring SSL prevents credentials from traveling in plain text.

---

## 4. AWS DynamoDB Setup

DynamoDB stores the high-volume, encrypted chat messages.

### 4.1 Create the table

1. In the AWS Console, open the **DynamoDB** service (ensure you are in the **same region** as your RDS, e.g. `us-east-1`).
2. Click **Create table**.
3. **Table name:** enter exactly

   ```
   vibenet-messages
   ```

   > ⚠️ **IMPORTANT:** This must match `DYNAMODB_MESSAGES_TABLE` in your `.env` exactly.

### 4.2 Define the keys

Set the primary key schema **exactly** as follows — this matches the backend data model:

| Key | Attribute name | Type |
|-----|----------------|------|
| **Partition key** | `chat_room_id` | **String** |
| **Sort key** | `timestamp` | **Number** |

- **Partition key:** `chat_room_id`, type **String**
- Check **Add sort key**, then enter `timestamp`, type **Number**

### 4.3 Capacity settings

1. Under **Table settings**, keep **Default settings**.
2. This defaults to **On-demand** capacity mode.
3. Click **Create table** and wait until the status is **Active**.

> 💰 **FREE TIER NOTE:** DynamoDB includes 25 GB of storage always free. On-demand mode means you only pay for what you use beyond the free allowance — ideal for a low-traffic development project.

Set the value in your `.env`:

```dotenv
DYNAMODB_MESSAGES_TABLE=vibenet-messages
AWS_REGION=us-east-1
```

---

## 5. AWS IAM Setup (Access Keys)

The backend needs programmatic credentials to read and write DynamoDB. You will create a dedicated IAM user and generate `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

### 5.1 Create the IAM user

1. In the AWS Console, open the **IAM** service.
2. Go to **Users** in the left menu and click **Create user**.
3. **User name:** `vibenet-backend`
4. Click **Next**.

### 5.2 Attach the DynamoDB policy

1. On the permissions step, select **Attach policies directly**.
2. In the search box, type `AmazonDynamoDBFullAccess`.
3. Check the box next to **AmazonDynamoDBFullAccess**.
4. Click **Next**, then **Create user**.

> ⚠️ **SECURITY WARNING:** `AmazonDynamoDBFullAccess` is broad and convenient for development. For production, follow the **principle of least privilege** — create a custom policy that grants only `GetItem`, `PutItem`, `Query`, and `BatchWriteItem` on the `vibenet-messages` table ARN.

### 5.3 Generate the Access Key ID & Secret Access Key

1. Click the newly created **vibenet-backend** user to open it.
2. Go to the **Security credentials** tab.
3. Under **Access keys**, click **Create access key**.
4. Select the use case **Application running outside AWS** (or **Command Line Interface (CLI)**), acknowledge the recommendation, and click **Next**, then **Create access key**.
5. You will now see:
   - **Access key** → this becomes `AWS_ACCESS_KEY_ID`
   - **Secret access key** → this becomes `AWS_SECRET_ACCESS_KEY`
6. Click **Download .csv file** to save a backup, then **Done**.

> ⚠️ **CRITICAL SECURITY WARNING:** The **Secret access key is shown only once**. If you lose it, you must delete the key and create a new one. **Never** commit these keys to git, hardcode them in source, or share them. If a key is ever exposed publicly, **deactivate and delete it immediately** in the IAM console.

Fill in your `.env`:

```dotenv
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

---

## ✅ Final Checklist

Before running the backend, confirm every value is filled in:

- [ ] `JWT_SECRET` — generated random string (not the placeholder)
- [ ] `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from Google Cloud Console
- [ ] `GOOGLE_REDIRECT_URL` — matches the Authorized redirect URI exactly
- [ ] `POSTGRES_HOST` — RDS endpoint, with inbound rule allowing your IP on port 5432
- [ ] `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` — RDS master credentials + initial DB
- [ ] `AWS_REGION` — same region for RDS, DynamoDB, and IAM
- [ ] `DYNAMODB_MESSAGES_TABLE` — `vibenet-messages` table is **Active**
- [ ] `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — from the `vibenet-backend` IAM user

Then start the server:

```bash
cd backend
go run ./cmd/api
# API available at http://localhost:8080
curl http://localhost:8080/health   # -> ok
```

> ⚠️ **FINAL REMINDER:** Double-check that your real `.env` is **git-ignored** and never pushed to any repository. Rotate any credential the moment you suspect it has been exposed.
