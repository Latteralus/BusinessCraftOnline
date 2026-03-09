# AI Working Guide

Read this file before touching code.

## Rules
- Read target domain DOMAIN.md before editing domain files.
- If a task touches multiple domains, call it out first.
- Import across domains only through @/domains/<domain>/index.
- Use migration files for schema changes. Never mutate schema in dashboard.
- Keep business logic in domain services or tick functions, not route handlers/components.
- Keep economy constants in src/config/*.
