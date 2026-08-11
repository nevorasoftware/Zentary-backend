# Zentary Backend API

Backend infrastructure for **Zentary** (Residential & Access Control Platform).

## 🚀 Tech Stack
- **Node.js** + **TypeScript**
- **Express.js** (REST API)
- **Prisma ORM** + **PostgreSQL**
- **JWT** Authentication & bcrypt password hashing
- **Deployment Ready for Railway** via Git (`nixpacks.toml` included)

---

## 🛠️ Setup & Local Execution

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and set your PostgreSQL connection string:
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/zentary_db?schema=public"
PORT=3000
JWT_SECRET="zentary_super_secret_jwt_key_2026"
```

### 3. Database Migrations & Prisma Client
```bash
# Generate Prisma Client
npm run prisma:generate

# Run DB Migrations
npm run prisma:migrate

# Seed Demo Data (Optional)
npm run prisma:seed
```

### 4. Development Server
```bash
npm run dev
```

---

## ☁️ Deploying to Railway via Git

1. Push this repository (`ZENTARY/BACKEND`) to GitHub:
   ```bash
   git add .
   git commit -m "Initial Zentary Backend Setup"
   git push origin main
   ```
2. On **Railway.app**:
   - Click **New Project** -> **Deploy from GitHub repo**.
   - Add a **PostgreSQL Database** plugin in Railway.
   - Connect the database `DATABASE_URL` variable to your Express backend service.
   - Set environment variables (`JWT_SECRET`, `NODE_ENV=production`).
   - Railway will automatically detect `nixpacks.toml`, run `prisma generate`, `build`, and start the app on port `3000` (or `PORT` provided by Railway).

---

## 💳 Payment Gateway Module
The payment module is prepared in:
- `src/controllers/payment.controller.ts`
- `src/routes/payment.routes.ts`
- Webhook endpoint `/api/payments/webhook` for external API integration (Stripe, Wompi, etc.).
