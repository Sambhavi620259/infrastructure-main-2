# AssetOps ITAM Admin UI

Production-oriented Next.js frontend foundation for the requested multi-tenant IT Asset Management system.

## Workspaces and roles

### 1. Super Admin — platform owner

- Company provisioning and company status
- Subscription and plan management
- Tenant management
- Tenant-to-IT-Admin workspace hand-off
- Platform administrators
- Immutable-audit UI
- Platform settings

### 2. IT Admin — company administrator

- Organization configuration
- User provisioning
- Sub-admin creation and role assignment
- Hardware Asset Management (HAM)
- Software Asset Management (SAM)
- Cloud Resource Management
- Discovery / scanning
- Financial and contract management
- Reports

### 3. Sub-Admins

The canonical role model supports:

- HAM Sub-Admin
- SAM Sub-Admin
- Cloud Sub-Admin
- Discovery Sub-Admin

Each module role is least-privilege and also receives reporting access.

### 4. Reporting User

- Reports and approved exports only.

The role and permission definitions are centralized in `src/lib/roles.ts` so the frontend and backend can share the same authorization contract.

## Requirement coverage

The UI covers the requested centralized asset repository, lifecycle management, hardware/software management, discovery, cloud resources, financial/contract management, reporting, company subscriptions and tenant management.

See `docs/PRODUCTION_REQUIREMENTS.md` for the detailed requirement-to-route mapping and the backend security contract.

## Run locally

Node.js 20.9+ is required.

```bash
npm ci
npm run lint
npm run typecheck
npm run verify
npm run build
npm run start
```

`npm run verify` is a dependency-free structural verification of required files, routes and package configuration.

## Production boundary

This repository is the frontend/admin UI layer. Fixture records are intentionally local. Before production exposure, connect the UI to an authenticated API and enforce RBAC/ABAC and tenant isolation server-side. Never treat the workspace switcher or `tenant` query parameter as a security boundary.

## IT Agent workspace

A dedicated operational IT Agent workspace is included for **Bold And Wise Ventures Pvt Ltd**, matching the supplied bright IT-operations reference. It includes dashboard, assets, tickets, users, inventory, reports and settings, with an explicit `IT_AGENT` least-privilege role and workspace switching alongside IT Admin and Super Admin.

See `VERIFICATION_REPORT.md` for the verification scope and environment limitation.

# infrastructure

# infrastructure-main-2
