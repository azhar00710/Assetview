# GeoSoft AssetView

**Intelligent Asset Environment for Oil & Gas Platforms**

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url>
cd assetview
npm run install:all

# 2. Start PostgreSQL
docker compose up -d

# 3. Start development
npm run dev
```

Backend: http://localhost:3001  
Frontend: http://localhost:5173

## Project Structure

```
assetview/
├── CLAUDE.md              ← AI assistant instructions (read this first)
├── docker-compose.yml     ← PostgreSQL service
├── database/
│   ├── schema.sql         ← Full database schema with junction tables
│   └── seed.sql           ← Real project seed data (AD219)
├── backend/
│   ├── prisma/schema.prisma  ← Prisma ORM schema
│   └── src/
│       ├── server.js      ← Fastify entry point
│       └── routes/        ← API route handlers
├── frontend/
│   ├── src/
│   │   ├── App.jsx        ← Main application
│   │   └── components/    ← React components
│   └── public/
│       └── pid-15101.jpg  ← P&ID reference image
└── docs/
    ├── P2.2_api_specification.md
    └── AssetView_v4_WithRegisters.html  ← Working reference POC
```

## For Claude Code

Read `CLAUDE.md` for complete project context, data model, UI patterns, and build order.

## License

Proprietary — GeoSoft 2026
