---
title: Prompts
description: Boot prompt templating, template variables, and customization.
---

Ralph uses a Markdown template system to build the prompt sent to each agent iteration. The template lives at `docs/prompts/boot.md` in your project.

## Template Variables

Ralph replaces `{{variable}}` placeholders before sending the prompt:

| Variable                      | Value                                              |
| ----------------------------- | -------------------------------------------------- |
| `{{task.id}}`                 | Task ID (e.g., `T-005`)                            |
| `{{task.title}}`              | Task title                                         |
| `{{task.description}}`        | Task description                                   |
| `{{task.prdReference}}`       | PRD section reference (e.g., `§3.2`)               |
| `{{task.prdContent}}`         | Extracted PRD section content                      |
| `{{task.touches}}`            | Comma-separated file paths from Touches field      |
| `{{task.hints}}`              | Content of the task's Hints section                |
| `{{config.language}}`         | Project language                                   |
| `{{config.packageManager}}`   | Package manager                                    |
| `{{config.testingFramework}}` | Testing framework                                  |
| `{{config.qualityCheck}}`     | Quality check command                              |
| `{{config.testCommand}}`      | Test command                                       |
| `{{config.fileNaming}}`       | File naming convention                             |
| `{{config.database}}`         | Database info                                      |
| `{{project.rules}}`           | Contents of `docs/prompts/rules.md`                |
| `{{codebaseIndex}}`           | Auto-generated file/export index                   |
| `{{retryContext}}`            | Context from a previous failed attempt             |

## Prompt Layers

The boot prompt is organized into layers for maximum API cache efficiency:

| Layer        | Content                                | Changes              |
| ------------ | -------------------------------------- | -------------------- |
| **System**   | TDD methodology, tool rules, quality   | Never (cacheable)    |
| **Project**  | Config values, file naming, commands   | Rarely (cacheable)   |
| **Rules**    | Project-specific rules                 | Rarely (cacheable)   |
| **Codebase** | File/export index                      | When files change    |
| **Task**     | Task description, PRD content, hints   | Every iteration      |
| **Retry**    | Previous failure context               | Only on retries      |

For agents that support `--system-prompt`, the stable layers are passed as the system prompt to maximize prompt caching.

## Project Rules

Project-specific rules live in `docs/prompts/rules.md`:

```markdown
- All code goes under `src/myapp/`
- Tests go in `__tests__/` directories
- Do not use library X
- File naming: kebab-case
```

These are injected as `{{project.rules}}` and apply to every task. Edit this file to add your project's conventions.

## Customization

You can freely edit `docs/prompts/boot.md` to:

- Adjust TDD rules
- Add project-specific instructions
- Change commit message format
- Modify quality gate behavior

Changes take effect on the next `ralph loop` iteration.
