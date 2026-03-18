# Contributing to Ralph

Ralph evolves itself. Contributions are made by writing task files and running the ralph loop — not by manual PRs.

## How It Works

1. Write or update task files in `docs/tasks/`
2. Run `ralph loop` — it picks up the next eligible task and implements it via TDD
3. Ralph commits the work automatically

## Getting Started

```bash
git clone https://github.com/mabulu-inc/simplicity-ralph.git
cd simplicity-ralph
pnpm install
pnpm dlx @smplcty/ralph loop
```

## Quality Gates

All changes must pass `pnpm check` (lint, format, typecheck, build, test:coverage). The loop enforces this automatically.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
