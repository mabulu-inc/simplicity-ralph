---
title: Customizing Prompts
description: How to tune boot prompts and rules for your project.
---

Ralph's behavior is driven by two editable files: the boot prompt template and the project rules file.

## Boot Prompt Template

Located at `docs/prompts/boot.md`, this is the full prompt sent to the agent at the start of each iteration. You can edit it to:

- Change TDD methodology rules
- Add project-specific instructions
- Modify commit message format
- Adjust quality gate behavior
- Add debugging guidance

### Template Variables

Use `{{variable}}` syntax for dynamic values. Ralph replaces these before sending the prompt:

```markdown
You are working on task {{task.id}}: {{task.title}}.

The project uses {{config.language}} with {{config.packageManager}}.

Run `{{config.qualityCheck}}` to verify your changes.
```

See the [Prompts](/ralph/core-concepts/prompts/) page for the full variable reference.

### Example Customizations

**Add a code style rule:**

```markdown
When writing TypeScript, always use explicit return types on exported functions.
```

**Change test behavior:**

```markdown
Write integration tests that hit the real database — do not mock database calls.
```

**Add domain context:**

```markdown
This is a financial application. All monetary values must use integer cents,
never floating-point dollars.
```

## Project Rules

Located at `docs/prompts/rules.md`, this file contains project-specific constraints that apply to every task:

```markdown
- All code goes under `src/myapp/`
- Tests go in `__tests__/` directories
- Use kebab-case for file names
- Do not use library X — we had issues with it in production
- All API endpoints must validate input with zod
```

Rules are injected as `{{project.rules}}` in the boot prompt. Edit this file to add conventions, restrictions, or guidance specific to your project.

### When to Use Rules vs. Boot Prompt

| Use Rules (`rules.md`)              | Use Boot Prompt (`boot.md`)            |
| ----------------------------------- | -------------------------------------- |
| Project-specific conventions        | Methodology changes                    |
| File organization rules             | TDD workflow adjustments               |
| Library restrictions                | Commit format changes                  |
| Naming conventions                  | Quality gate modifications             |

Rules are for "what" constraints. The boot prompt is for "how" methodology.
