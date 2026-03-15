---
title: PRD
description: How to write an effective PRD for ralph.
---

The PRD (Product Requirements Document) at `docs/PRD.md` is ralph's source of truth for what to build. Tasks reference PRD sections, and ralph injects the relevant section content into each agent's boot prompt.

## Structure

Use numbered sections so tasks can reference them precisely:

```markdown
# My Project — Product Requirements Document

A CLI tool that does X.

## 1. Authentication

The system must support email/password authentication.

### 1.1 Registration

Users register with email and password. Passwords are hashed with bcrypt.
Email must be unique and validated.

### 1.2 Login

Users authenticate with email and password. Returns a JWT token
valid for 24 hours.

## 2. API Endpoints

### 2.1 User Profile

GET /api/profile returns the authenticated user's profile data.
```

## How Ralph Uses It

1. Each task file has a `PRD Reference` field (e.g., `§1.1`)
2. At boot time, ralph parses the PRD and extracts the referenced section
3. The section content is injected into the boot prompt as `{{task.prdContent}}`
4. The agent gets the exact requirements without reading the entire PRD

## Best Practices

**Be specific and testable.** Every requirement should be verifiable in code:

```markdown
# Good
Users register with email and password. Passwords must be at least 8 characters
and hashed with bcrypt. Duplicate emails return a 409 status.

# Vague
The system should handle user registration properly.
```

**Use numbered sections consistently.** Tasks reference sections by number — renumbering breaks references.

**Keep sections focused.** Each section should map to one or a few tasks. If a section requires more than 3-4 tasks, split it into subsections.

**Include constraints.** Performance targets, security requirements, and compatibility notes belong in the PRD — they inform the agent's implementation decisions.
