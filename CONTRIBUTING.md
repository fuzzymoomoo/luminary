# Contributing To Luminary

Thanks for taking a look at Luminary.

This project is still early, so the most valuable contributions are the ones that make the extension safer, clearer, and easier for someone else to use on their own collection.

## Ground Rules

- keep Luminary local-first
- avoid hardcoded machine paths, usernames, or workspace-specific assumptions
- prefer portable defaults over environment-specific behavior
- make destructive actions explicit and reversible where possible
- document changes that affect storage, import behavior, or setup requirements

## Development Workflow

1. Run `npm install`.
2. Open the repo in VS Code.
3. Press `F5` to launch an Extension Development Host.
4. Point Luminary at a test media folder with `Luminary: Set Root Media Folder`.
5. Exercise the feature you changed against a clean collection and, if relevant, a messy real-world one.

## What To Call Out In PRs

- user-facing behavior changes
- new configuration settings
- changes to `.luminary` storage
- changes that affect import, export, duplicate handling, or face recognition setup

## Good First Improvements

- setup and install clarity
- better error messages
- safer duplicate review flows
- importer edge cases
- performance improvements that preserve portability

## Before Opening A Large Change

If the change alters Luminary's storage model, interaction model, or project direction, open an issue or discussion first so we can align before the implementation grows.
