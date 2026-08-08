# Infrastructure

Deployment-time configuration that isn't part of the application images
themselves: reverse proxy config, provisioning notes, etc.

- `nginx/` — reverse proxy configuration for production deployments
  (terminates TLS, proxies `/` to the web container and `/api` to the API
  container). See `docs/deployment/production-deployment.md` for how this
  fits into a full VPS deployment.

Dockerfiles and Compose files live in `../docker/`, not here — this
directory is for infrastructure that sits _outside_ the containers.
