# AI Agent Workflow Builder — Full-Stack Assignment Submission

## 1) Overview

This document provides a comprehensive overview of the **AI Agent Workflow Builder**—a multi-tenant, full-stack application built using **Next.js**, **Nhost (Auth & Storage)**, and **Hasura GraphQL Engine** over **PostgreSQL**.

The application manages complete end-to-end workflow execution, step approvals, multi-tenant workspace isolation, and automated database synchronization.

---

## 2) Key Features & Architecture

* **Multi-Tenant Access**: Workspaces are isolated via `public.org_members` using Hasura Role-Based Access Control (RBAC).
* **Automated Data Sync**: Custom PostgreSQL triggers handle third-party auth payload synchronization (`auth.users.locale` fallback logic).
* **GraphQL Actions & Handlers**: Business logic handled via Nhost Serverless Functions wired directly to Hasura Mutations (`triggerWorkflowRun` and `approveStep`).
* **Interactive Frontend UI**: Fully responsive Next.js application with Apollo Client for GraphQL caching, real-time auth integration, and boundary guards for non-member states.

---
## 📁 Repository Directory Structure

```text
AI-AGENT-WORKFLOW-BUILDER/
├── 📁 frontend/                      # Next.js Application Root
│   ├── 📁 app/                       # Next.js App Router Pages & Configuration
│   │   ├── favicon.ico
│   │   ├── global.d.ts
│   │   ├── globals.css
│   │   ├── layout.tsx                # Root layout with application wrappers
│   │   └── page.tsx                  # Main workspace / dashboard landing page
│   │
│   ├── 📁 components/                # Modular React UI Components
│   │   ├── AuthGate.tsx              # Authentication boundary guard component
│   │   ├── LiveExecutionViewer.tsx   # Real-time workflow execution updates viewer
│   │   ├── Providers.tsx             # Nhost & Apollo Client React context providers
│   │   ├── QuotaBar.tsx              # Organization quota tracking progress bar
│   │   ├── WorkflowBuilder.tsx       # Interactive workflow creation canvas
│   │   └── WorkflowDetail.tsx        # Workflow execution details & step inspector
│   │
│   ├── 📁 contexts/                  # React State Contexts
│   │   └── OrgContext.tsx            # Active organization context manager
│   │
│   ├── 📁 lib/                       # Helpers & Utilities
│   │   └── constants.ts              # API endpoints, roles, and global constants
│   │
│   ├── 📁 public/                    # Static public web assets
│   ├── .env.local                    # Local environment secrets & endpoint keys
│   ├── .gitignore                    # Version control ignore list
│   ├── AGENTS.md                     # Agent workflow documentation
│   ├── CLAUDE.md                     # LLM development instructions
│   ├── eslint.config.mjs             # ESLint code style rules
│   ├── next-env.d.ts                 # Next.js TypeScript definitions
│   ├── next.config.ts                # Next.js build configuration
│   ├── package-lock.json             # Locked npm dependencies
│   ├── package.json                  # Frontend dependencies & scripts
│   ├── postcss.config.mjs            # PostCSS / Tailwind CSS configuration
│   ├── README.md                     # Full-stack assignment documentation
│   └── tsconfig.json                 # TypeScript compiler options
│
└── 📁 nhost/                         # Nhost Backend & Serverless Configuration
    ├── 📁 functions/                 # Nhost Serverless Action Handlers
    │   ├── 📁 approveStep/
    │   │   └── index.ts              # Step approval logic & state transition handler
    │   └── 📁 triggerWorkflowRun/
    │       └── index.ts              # Workflow execution trigger & quota handler
    │
    ├── config.toml                   # Nhost environment & service configuration
    ├── package-lock.json             # Serverless backend locked dependencies
    └── package.json                  # Backend package dependencies
```

## 3) System Endpoints & Configuration

### Environment Setup (`.env.local`)

```env
# Nhost & Hasura Endpoints
NEXT_PUBLIC_NHOST_SUBDOMAIN=kntgpedziywsbdheflul
NEXT_PUBLIC_NHOST_REGION=ap-south-1

# GraphQL & Admin Endpoints
NEXT_PUBLIC_HASURA_GRAPHQL_URL=[https://kntgpedziywsbdheflul.hasura.ap-south-1.nhost.run/v1/graphql](https://kntgpedziywsbdheflul.hasura.ap-south-1.nhost.run/v1/graphql)
HASURA_ADMIN_SECRET=nhost-admin-secret

```
### Serverless Action Handlers

- **Hasura GraphQL API**: `https://kntgpedziywsbdheflul.hasura.ap-south-1.nhost.run/v1/graphql`
- **Nhost Functions Base**: `https://kntgpedziywsbdheflul.functions.ap-south-1.nhost.run/v1`
- **`triggerWorkflowRun` Handler**: `https://kntgpedziywsbdheflul.functions.ap-south-1.nhost.run/v1/triggerWorkflowRun`
- **`approveStep` Handler**: `https://kntgpedziywsbdheflul.functions.ap-south-1.nhost.run/v1/approveStep`

---

## 4) Hasura Action Definitions (SDL)

### 4.1 `triggerWorkflowRun`

```graphql
type Mutation {
  triggerWorkflowRun(
    workflow_id: uuid!
    trigger_type: String
    input: jsonb
  ): TriggerWorkflowRunResponse!
}

type TriggerWorkflowRunResponse {
  ok: Boolean!
  message: String!
  workflow_run_id: uuid
  step_count: Int
}
```
### 4.2 `approveStep`

```graphql
type Mutation {
  approveStep(
    step_run_id: uuid!
    decision: String!
    comment: String
  ): ApproveStepResponse!
}

type ApproveStepResponse {
  ok: Boolean!
  message: String!
  step_run_id: uuid
  workflow_run_id: uuid
  workflow_status: String
}
```
---

## 5) Business Logic Implementation

### 5.1 `triggerWorkflowRun`
- Validates incoming `workflow_id`.
- Extracts caller identity from session headers (`x-hasura-user-id`).
- Verifies organization membership and authorization (`owner` / `editor`).
- Checks organization quota thresholds (`organizations.quota_used` vs `quota_allowed`).
- Creates a new `workflow_runs` row (status: `running`) and populates corresponding `step_runs` rows (status: `pending`).

### 5.2 `approveStep`
- Validates target `step_run_id` and decision (`approved` / `rejected`).
- Verifies caller permissions against the organization owning the run.
- Updates `step_runs` with approver metadata, timestamp, and optional execution comments.
- Evaluates parent workflow state:
  - Any step **rejected** -> Workflow status becomes `failed`.
  - All required steps **approved** -> Workflow status becomes `completed`.

---

## 6) Database Triggers & Automations

To prevent `NOT NULL` constraint violations on `auth.users` (e.g., missing `locale` during registration flows), a custom PostgreSQL trigger automatically populates defaults:

```sql
CREATE OR REPLACE FUNCTION public.set_default_user_locale()
RETURNS TRIGGER AS $$  BEGIN      IF NEW.locale IS NULL THEN          NEW.locale := 'en';      END IF;      RETURN NEW;  END;  $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_set_default_user_locale ON auth.users;

CREATE TRIGGER tr_set_default_user_locale
BEFORE INSERT OR UPDATE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.set_default_user_locale();
```
---

## 7) Screenshots & Verification Highlights

### 1. Nhost Auth User Management
Users register via the Next.js frontend application. Credentials and session tokens are generated cleanly via Nhost Auth.


<img width="1600" height="864" alt="image" src="https://github.com/user-attachments/assets/67fb6c9c-9e2f-44dc-a261-6fd593236183" />


### 2. Hasura PostgreSQL Schema Synchronization
The custom trigger automatically sanitizes user inserts in `auth.users` without throwing constraint violations.


<img width="1600" height="860" alt="image" src="https://github.com/user-attachments/assets/9bf9bb61-15e0-4ad1-b346-889baa3b74ae" />


### 3. Multi-Tenant Organization Membership (`org_members`)
Users are assigned to organization workspaces alongside role permissions (`owner`, `editor`, `viewer`).


<img width="1600" height="852" alt="image" src="https://github.com/user-attachments/assets/b636d9d0-dffa-46b9-a201-30927e7f3f8f" />


### 4. Client-Side Access Guards
If an authenticated user is not assigned to an active organization, the frontend intercepts the render and displays an access boundary card.


<img width="1600" height="840" alt="image" src="https://github.com/user-attachments/assets/ae85b931-89fd-4b5c-9fea-633a605ad07f" />


---

## 8) Test Credentials & Matrix

| Role | Email | Password | Default Locale |
| :--- | :--- | :--- | :--- |
| **Organization Owner** | `keshriroshan44@gmail.com` | `Password123!` | `en` |
| **Demo Owner** | `demo-owner@example.com` | `Password123!` | `en` |
| **Demo Viewer** | `demo-viewer@example.com` | `Password123!` | `en` |

---

## 9) Verification SQL Queries

```sql
-- View recent workflow runs
SELECT id, workflow_id, org_id, status, trigger_type, started_by, created_at
FROM workflow_runs
ORDER BY created_at DESC
LIMIT 10;

-- View recent step runs and approvers
SELECT id, workflow_run_id, workflow_step_id, status, attempt_count, approved_by, approved_at, created_at
FROM step_runs
ORDER BY created_at DESC
LIMIT 20;

-- Inspect workspace members
SELECT om.id, om.org_id, om.user_id, om.role, u.email
FROM public.org_members om
JOIN auth.users u ON u.id = om.user_id;
```
---

## 10) Local Development Instructions

1. **Clone Repository & Install Dependencies**:
   ```bash
   git clone <repository-url>
   cd ai-agent-workflow-builder
   npm install
   ```
   Configure Environment Variables:
   Create a .env.local file in the root directory using the values specified in Section 3.

   Start Development Server:
   npm run dev
   Navigate to http://localhost:3000 to test the application locally.
   ```
   ---

## 👤 Author & Maintainer

<p align="left">
  <b>Built with ❤️ by Roshan Keshri</b><br/>
  <i>Full Stack Developer | AI & Workflow Automation Engineer</i>
</p>

* **GitHub**: [github.com/roshankeshri](https://github.com/roshankeshri)
* **LinkedIn**: [linkedin.com/in/roshankeshri](https://linkedin.com/in/roshankeshri)
* **Email**: `keshriroshan44@gmail.com`
