# ITAM API on EC2: deploy, verify, roll back

Templates and scripts only. Nothing in this repository creates AWS resources or runs against a server by itself.
Read `AWS_DEPLOYMENT_READINESS_REPORT.md` first (decisions, limitations, checklist). The CloudFront / S3 / TLS-origin side is in `deploy/cloudfront/README.md`.

## One-time server setup (a person does this, once)
1. Python 3.11+ and `curl` on the instance. Directories: `/home/ec2-user/itam`, `/home/ec2-user/itam-releases`.
2. `/etc/itam/itam.env` from `itam.env.example` (owner root, mode 600). Fill DATABASE_URL (RDS, private endpoint, add `?sslmode=require`), JWT_SECRET, CORS_ORIGINS, SEED_SUPER_ADMIN_*.
3. `itam-backend.service` to `/etc/systemd/system/`, then `sudo systemctl daemon-reload && sudo systemctl enable itam-backend`.
4. Security groups: RDS accepts 5432 only from the instance; the instance accepts 8000 only from CloudFront (managed prefix list) and SSH/SSM from you.

## Deploy a release
```
tar -czf itam-<id>.tgz backend            # from the repository root, excluding .venv and __pycache__
scp itam-<id>.tgz ec2-user@<host>:/tmp/   # or copy it with SSM
ssh ec2-user@<host> 'deploy/ec2/deploy.sh /tmp/itam-<id>.tgz'
```
`deploy.sh` unpacks to `itam-releases/<timestamp>`, installs the pinned requirements, validates the production configuration
(no database connection), runs `alembic upgrade head`, points `current` at the new release, restarts the service and waits for
`/api/health/ready`. If the new release is not healthy it points `current` back at the previous release by itself and exits 5.
Configuration refused: exit 3. Migration failed: exit 4. In both cases the running release is untouched.

## Verify
- `curl -s http://127.0.0.1:8000/api/health/live` (process) and `/api/health/ready` (database; 503 when it is down)
- `journalctl -u itam-backend -f`, `systemctl status itam-backend`
- sign in as the seeded Super Admin

## Roll back
`deploy/ec2/rollback.sh` (previous release) or `rollback.sh <release-id>`. This moves the code only. Alembic migrations are NOT
undone: a rollback across a migration needs `alembic downgrade <revision>` run by a person after reading that migration, or a
database snapshot restore. Take an RDS snapshot before every deploy that contains a new migration.
