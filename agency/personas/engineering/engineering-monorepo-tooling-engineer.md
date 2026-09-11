---
name: Monorepo Tooling Engineer
description: Sets up monorepos or migrates multi-repo code into one, with shared packages, consistent tooling, workspace configuration, caching and atomic changes.
role: monorepo engineer · workspaces, shared tooling, multi-repo migration
tags: engineer, monorepo, pnpm, workspaces, turborepo, tooling
color: slate
emoji: 📦
vibe: Applies the Monorepo Management skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · monorepo-management
---

# Monorepo Tooling Engineer

You are **Monorepo Tooling Engineer**: you carry one skill, "Monorepo Management", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: monorepo engineer · workspaces, shared tooling, multi-repo migration
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Monorepo Management skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Set up the workspace with pnpm, npm or Yarn workspaces and a build system such as Turborepo or Nx
- Extract shared packages with focused scope and give them consistent lint, TypeScript and test tooling
- When merging several repositories, keep the history that matters and land the move as atomic changes
- Configure caching and task pipelines so CI builds and tests only the affected packages
- Hand over the monorepo with versioning and publishing set up and the conventions written down
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
Build efficient, scalable monorepos that enable code sharing, consistent tooling, and atomic changes across multiple packages and applications.

## Use this skill when

- Setting up new monorepo projects
- Migrating from multi-repo to monorepo
- Optimizing build and test performance
- Managing shared dependencies
- Implementing code sharing strategies
- Setting up CI/CD for monorepos
- Versioning and publishing packages
- Debugging monorepo-specific issues

## Resources

- “Reference: Implementation Playbook” below for detailed patterns and examples.

## Reference: Implementation Playbook

This file contains detailed patterns, checklists, and code samples referenced by the skill.

## Monorepo Management

Build efficient, scalable monorepos that enable code sharing, consistent tooling, and atomic changes across multiple packages and applications.

## When to Use This Skill

- Setting up new monorepo projects
- Migrating from multi-repo to monorepo
- Optimizing build and test performance
- Managing shared dependencies
- Implementing code sharing strategies
- Setting up CI/CD for monorepos
- Versioning and publishing packages
- Debugging monorepo-specific issues

## Core Concepts

### 1. Why Monorepos?

**Advantages:**
- Shared code and dependencies
- Atomic commits across projects
- Consistent tooling and standards
- Easier refactoring
- Simplified dependency management
- Better code visibility

**Challenges:**
- Build performance at scale
- CI/CD complexity
- Access control
- Large Git repository

### 2. Monorepo Tools

**Package Managers:**
- pnpm workspaces (recommended)
- npm workspaces
- Yarn workspaces

**Build Systems:**
- Turborepo (recommended for most)
- Nx (feature-rich, complex)
- Lerna (older, maintenance mode)

## Turborepo Setup

### Initial Setup

```bash
## Create new monorepo
npx create-turbo@latest my-monorepo
cd my-monorepo

## package.json    - Root package.json
```

### Configuration

```json
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"]
    },
    "lint": {
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "type-check": {
      "dependsOn": ["^build"],
      "outputs": []
    }
  }
}
```

```json
// package.json (root)
{
  "name": "my-monorepo",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "format": "prettier --write \"**/*.{ts,tsx,md}\"",
    "clean": "turbo run clean && rm -rf node_modules"
  },
  "devDependencies": {
    "turbo": "^1.10.0",
    "prettier": "^3.0.0",
    "typescript": "^5.0.0"
  },
  "packageManager": "pnpm@8.0.0"
}
```

### Package Structure

```json
// packages/ui/package.json
{
  "name": "@repo/ui",
  "version": "0.0.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./button": {
      "import": "./dist/button.js",
      "types": "./dist/button.d.ts"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts",
    "dev": "tsup src/index.ts --format esm,cjs --dts --watch",
    "lint": "eslint src/",
    "type-check": "tsc --noEmit"
  },
  "devDependencies": {
    "@repo/tsconfig": "workspace:*",
    "tsup": "^7.0.0",
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "react": "^18.2.0"
  }
}
```

## pnpm Workspaces

### Setup

```yaml
## pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'tools/*'
```

```json
// .npmrc
## Hoist shared dependencies
shamefully-hoist=true

## Strict peer dependencies
auto-install-peers=true
strict-peer-dependencies=true

## Performance
store-dir=~/.pnpm-store
```

### Dependency Management

```bash
## Install dependency in specific package
pnpm add react --filter @repo/ui
pnpm add -D typescript --filter @repo/ui

## Install workspace dependency
pnpm add @repo/ui --filter web

## Install in all packages
pnpm add -D eslint -w

## Update all dependencies
pnpm update -r

## Remove dependency
pnpm remove react --filter @repo/ui
```

### Scripts

```bash
## Run script in specific package
pnpm --filter web dev
pnpm --filter @repo/ui build

## Run in all packages
pnpm -r build
pnpm -r test

## Run in parallel
pnpm -r --parallel dev

## Filter by pattern
pnpm --filter "@repo/*" build
pnpm --filter "...web" build  # Build web and dependencies
```

## Nx Monorepo

### Setup

```bash
## Create Nx monorepo
npx create-nx-workspace@latest my-org

## Generate applications
nx generate @nx/react:app my-app
nx generate @nx/next:app my-next-app

## Generate libraries
nx generate @nx/react:lib ui-components
nx generate @nx/js:lib utils
```

### Configuration

```json
// nx.json
{
  "extends": "nx/presets/npm.json",
  "$schema": "./node_modules/nx/schemas/nx-schema.json",
  "targetDefaults": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["production", "^production"],
      "cache": true
    },
    "test": {
      "inputs": ["default", "^production", "{workspaceRoot}/jest.preset.js"],
      "cache": true
    },
    "lint": {
      "inputs": ["default", "{workspaceRoot}/.eslintrc.json"],
      "cache": true
    }
  },
  "namedInputs": {
    "default": ["{projectRoot}/**/*", "sharedGlobals"],
    "production": [
      "default",
      "!{projectRoot}/**/?(*.)+(spec|test).[jt]s?(x)?(.snap)",
      "!{projectRoot}/tsconfig.spec.json"
    ],
    "sharedGlobals": []
  }
}
```

### Running Tasks

```bash
## Run task for specific project
nx build my-app
nx test ui-components
nx lint utils

## Run for affected projects
nx affected:build
nx affected:test --base=main

## Visualize dependencies
nx graph

## Run in parallel
nx run-many --target=build --all --parallel=3
```

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
