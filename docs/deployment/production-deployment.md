# Production Deployment Guide

> **Status:** Stub for self-hosted deployment (Ubuntu VPS, AWS EC2,
> DigitalOcean, Hetzner, Coolify, Nginx, PM2, SSL, backups) — not yet
> written. **For Render**, see the complete, ready-to-use
> [Render deployment guide](./render.md) and `render.yaml` at the repo
> root instead (Sprint 19).

## Planned contents

- Docker & Docker Compose production setup
- Nginx reverse proxy configuration
- PM2 process management (for non-containerized deploys)
- SSL via Let's Encrypt
- Managed vs. self-hosted PostgreSQL and Redis
- DNS configuration for custom domains
- Environment variable management per environment
- Database backup & restore procedures
- Centralized logging and monitoring
- Performance optimization checklist
- Security hardening checklist
- GitHub Actions CI/CD pipeline
