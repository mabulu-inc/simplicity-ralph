---
title: Introduction
description: What is Ralph and why stateless loops beat persistent agents.
---

Ralph is a CLI tool that implements the **Ralph Methodology** — stateless, PRD-driven AI development automated by AI coding agents.

## The Problem

Ad-hoc AI prompting produces inconsistent results. Without structure, AI agents wander — exploring too much, skipping tests, making changes that break existing code, or losing context mid-task.

## The Solution

Ralph gives your AI agent a repeatable, disciplined workflow:

1. **You write a PRD** — numbered sections describing what to build
2. **You decompose it into tasks** — small, dependency-ordered units of work
3. **Ralph drives the loop** — each iteration boots an agent, assigns a task, enforces red/green TDD, runs quality gates, and commits

Each iteration is **stateless**: the agent boots from disk, reads the task, implements it with TDD, and commits. No persistent state to corrupt, no context window to overflow.

## Why Stateless?

Persistent agents accumulate stale context, drift from instructions, and degrade over long sessions. Ralph's stateless approach means:

- **Every iteration starts clean** — the agent reads current state from files, not memory
- **Crashes are recoverable** — just re-run, the agent picks up where the last commit left off
- **Quality is enforced every time** — the boot prompt includes TDD rules and quality gates that can't be forgotten

## What You Get

- **Automated TDD** — failing tests first, then minimum implementation
- **Task-driven development** — clear progress tracking through task files
- **Multi-agent support** — works with Claude Code, Gemini CLI, Codex CLI, Continue, and Cursor
- **Cost tracking** — token usage and dollar costs per task and milestone
- **Quality gates** — lint, format, typecheck, build, and test must all pass before every commit
