# ITAM production requirements mapping

## Roles

| Role | Scope | UI workspace/pages |
|---|---|---|
| Super Admin | All tenants | `/super-admin/*` |
| IT Admin | One company; all ITAM modules + configuration | `/dashboard`, `/users`, `/settings`, all ITAM modules |
| HAM Sub-Admin | Hardware | `/assets` + reports |
| SAM Sub-Admin | Software | `/software` + reports |
| Cloud Sub-Admin | Cloud resources | `/cloud` + reports |
| Discovery Sub-Admin | Discovery/scanning | `/discovery` + reports |
| Reporting User | Reports only | `/reports` |

The canonical role and permission model lives in `src/lib/roles.ts`.

## Functional requirement coverage

- Centralized asset repository: Assets and asset detail routes.
- Lifecycle management: Dashboard lifecycle coverage plus asset records.
- Hardware asset management: Assets, assignments, status, lifecycle and physical audit UI.
- Software asset management: Software catalog, licensing and compliance UI.
- Automated discovery: Discovery route with scan targets, methods and discovered endpoints.
- Cloud resource management: Cloud route with provider/resource/utilization views.
- Financial and contract management: Financial route with depreciation, vendors and purchase orders.
- Reporting: Reports route with templates, schedules and exports.
- Super Admin: Companies, subscriptions, tenants, platform admins, audit and platform settings.
- IT Admin: Users & Roles and Organization Settings.
- Tenant hand-off: Super Admin can open a tenant IT Admin route with a tenant context query parameter.

## Security requirements to enforce in the backend

The frontend role model is a UX contract, not an authorization boundary. Production APIs must enforce:

1. Tenant isolation on every tenant-scoped query.
2. Server-side role/permission checks on every mutation and protected read.
3. Super Admin checks before company/subscription/tenant operations.
4. IT Admin checks before user, role and organization configuration changes.
5. Module-admin checks for HAM/SAM/Cloud/Discovery operations.
6. Reporting-user checks for report read/export only.
7. SSO using SAML 2.0 and/or OpenID Connect.
8. MFA enforcement for privileged roles.
9. Encryption at rest using the cloud/database key-management service and TLS in transit.
10. Immutable audit events for asset, license, assignment, role, tenant, subscription and configuration changes.
11. Short-lived sessions/access tokens, secure refresh-token rotation, CSRF protection where cookie auth is used, and rate limits for authentication and sensitive APIs.
12. Object-level authorization for asset, report, tenant and user identifiers; never trust client-provided tenant IDs.

## Backend API contract expected by this UI

The frontend should consume a versioned API such as `/api/v1` with resources including:

- `/me`
- `/companies`
- `/companies/{companyId}/members`
- `/companies/{companyId}/roles`
- `/assets`
- `/software`
- `/licenses`
- `/discovery/scans`
- `/discovery/agents`
- `/cloud/accounts`
- `/cloud/resources`
- `/financial/assets`
- `/vendors`
- `/purchase-orders`
- `/reports`
- `/audit-events`
- `/subscriptions`
- `/tenants`

Use idempotency keys for provisioning, invitations, subscription changes and other retryable mutations.

## Deployment

Recommended runtime:

- Next.js frontend in a container.
- API service in NestJS or FastAPI.
- PostgreSQL as the system of record.
- Redis for cache, sessions where appropriate, rate limiting and job queues.
- Discovery workers separated from the API process.
- Object storage for exports/evidence.
- Queue-based background processing for discovery, report generation, notifications and reconciliation.
- CI/CD should run install, lint, typecheck, production build, unit/integration tests and dependency/security scans before deployment.

The current repository contains the frontend/admin UI and local fixture data. It is not a substitute for the backend authorization, tenant isolation, billing, discovery workers or persistence layers described above.


## IT Agent workspace

The frontend includes a dedicated operational IT Agent workspace for Bold And Wise Ventures Pvt Ltd. It provides ticket operations, asset lookup, inventory visibility, user lookup, approved reports and agent profile settings. The `IT_AGENT` role is intentionally narrower than IT Admin and must be enforced server-side.
