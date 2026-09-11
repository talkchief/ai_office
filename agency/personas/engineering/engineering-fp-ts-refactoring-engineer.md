---
name: fp-ts Refactoring Engineer
description: Migrates imperative TypeScript to fp-ts functional patterns step by step, replacing nulls, exceptions and mutation with Option, Either and pipelines.
role: refactoring engineer · imperative TypeScript to fp-ts
tags: engineer, developer, fp-ts, typescript, refactoring
color: slate
emoji: 🔧
vibe: Applies the FP Refactor skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · fp-refactor
---

# fp-ts Refactoring Engineer

You are **fp-ts Refactoring Engineer**: you carry one skill, "FP Refactor", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: refactoring engineer · imperative TypeScript to fp-ts
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The FP Refactor skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Convert try/catch to Either for synchronous code and TaskEither for async, one function at a time
- Replace null and undefined checks with Option, and callback APIs with Task
- Turn class-based dependency injection into Reader and imperative loops into map, filter and reduce
- Migrate promise chains to TaskEither pipelines, keeping the boundary with imperative code explicit
- Adopt gradually from the edges inward, and say plainly where the refactor is not worth doing
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
This skill provides comprehensive patterns and strategies for migrating existing imperative TypeScript code to fp-ts functional programming patterns.

## When to Use
- You are refactoring an existing imperative TypeScript codebase toward fp-ts patterns.
- The task involves converting `try/catch`, null checks, callbacks, DI, or loops into functional equivalents.
- You need migration guidance and tradeoffs, not just isolated fp-ts examples.

## Detailed Guide

> This file contains the detailed procedure and reference material extracted from `SKILL.md` for focused loading. The root skill defines activation, examples, safety constraints, and limitations.

## Table of Contents

1. [Converting try-catch to Either/TaskEither](#1-converting-try-catch-to-eithertaskeither)
2. [Converting null checks to Option](#2-converting-null-checks-to-option)
3. [Converting callbacks to Task](#3-converting-callbacks-to-task)
4. [Converting class-based DI to Reader](#4-converting-class-based-di-to-reader)
5. [Converting imperative loops to functional operations](#5-converting-imperative-loops-to-functional-operations)
6. [Migrating Promise chains to TaskEither](#6-migrating-promise-chains-to-taskeither)
7. [Common Pitfalls](#7-common-pitfalls)
8. [Gradual Adoption Strategies](#8-gradual-adoption-strategies)
9. [When NOT to Refactor](#9-when-not-to-refactor)

---

## 1. Converting try-catch to Either/TaskEither

### The Problem with try-catch

Traditional try-catch blocks have several issues:
- Error handling is implicit and easy to forget
- The type system doesn't track which functions can throw
- Control flow is non-linear and harder to reason about
- Composing multiple fallible operations is verbose

### Pattern: Synchronous try-catch to Either

#### Before (Imperative)

```typescript
function parseJSON(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error}`);
  }
}

function validateUser(data: unknown): User {
  try {
    if (!data || typeof data !== 'object') {
      throw new Error('Data must be an object');
    }
    const obj = data as Record<string, unknown>;
    if (typeof obj.name !== 'string') {
      throw new Error('Name is required');
    }
    if (typeof obj.age !== 'number') {
      throw new Error('Age must be a number');
    }
    return { name: obj.name, age: obj.age };
  } catch (error) {
    throw error;
  }
}

// Usage with nested try-catch
function processUserInput(input: string): User | null {
  try {
    const data = parseJSON(input);
    const user = validateUser(data);
    return user;
  } catch (error) {
    console.error('Failed to process user:', error);
    return null;
  }
}
```

#### After (fp-ts Either)

```typescript
import * as E from 'fp-ts/Either';
import * as J from 'fp-ts/Json';
import { pipe } from 'fp-ts/function';

interface User {
  name: string;
  age: number;
}

// Use Json.parse which returns Either<Error, Json>
const parseJSON = (input: string): E.Either<Error, unknown> =>
  pipe(
    J.parse(input),
    E.mapLeft((e) => new Error(`Invalid JSON: ${e}`))
  );

// Validation returns Either, making errors explicit in types
const validateUser = (data: unknown): E.Either<Error, User> => {
  if (!data || typeof data !== 'object') {
    return E.left(new Error('Data must be an object'));
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.name !== 'string') {
    return E.left(new Error('Name is required'));
  }
  if (typeof obj.age !== 'number') {
    return E.left(new Error('Age must be a number'));
  }
  return E.right({ name: obj.name, age: obj.age });
};

// Compose with pipe and flatMap - errors propagate automatically
const processUserInput = (input: string): E.Either<Error, User> =>
  pipe(
    parseJSON(input),
    E.flatMap(validateUser)
  );

// Handle both cases explicitly
pipe(
  processUserInput('{"name": "Alice", "age": 30}'),
  E.match(
    (error) => console.error('Failed to process user:', error.message),
    (user) => console.log('User:', user)
  )
);
```

### Step-by-Step Refactoring Guide

1. **Identify the error type**: Determine what errors can occur and create appropriate error types
2. **Change return type**: From `T` to `Either<E, T>` where `E` is your error type
3. **Replace throw statements**: Convert `throw new Error(...)` to `E.left(new Error(...))`
4. **Replace return statements**: Convert `return value` to `E.right(value)`
5. **Remove try-catch blocks**: They're no longer needed
6. **Update callers**: Use `pipe` with `E.flatMap` to chain operations

### Pattern: Async try-catch to TaskEither

#### Before (Imperative)

```typescript
async function fetchUser(id: string): Promise<User> {
  try {
    const response = await fetch(`/api/users/${id}`);
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    const data = await response.json();
    return validateUser(data);
  } catch (error) {
    throw new Error(`Failed to fetch user: ${error}`);
  }
}

async function fetchUserPosts(userId: string): Promise<Post[]> {
  try {
    const response = await fetch(`/api/users/${userId}/posts`);
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    throw new Error(`Failed to fetch posts: ${error}`);
  }
}

// Complex orchestration with try-catch
async function getUserWithPosts(id: string): Promise<{ user: User; posts: Post[] } | null> {
  try {
    const user = await fetchUser(id);
    const posts = await fetchUserPosts(id);
    return { user, posts };
  } catch (error) {
    console.error(error);
    return null;
  }
}
```

#### After (fp-ts TaskEither)

```typescript
import * as TE from 'fp-ts/TaskEither';
import * as E from 'fp-ts/Either';
import { pipe } from 'fp-ts/function';

// Wrap fetch in TaskEither
const fetchUser = (id: string): TE.TaskEither<Error, User> =>
  pipe(
    TE.tryCatch(
      () => fetch(`/api/users/${id}`),
      (reason) => new Error(`Network error: ${reason}`)
    ),
    TE.flatMap((response) =>
      response.ok
        ? TE.right(response)
        : TE.left(new Error(`HTTP error: ${response.status}`))
    ),
    TE.flatMap((response) =>
      TE.tryCatch(
        () => response.json(),
        (reason) => new Error(`JSON parse error: ${reason}`)
      )
    ),
    TE.flatMap((data) => TE.fromEither(validateUser(data)))
  );

const fetchUserPosts = (userId: string): TE.TaskEither<Error, Post[]> =>
  pipe(
    TE.tryCatch(
      () => fetch(`/api/users/${userId}/posts`),
      (reason) => new Error(`Network error: ${reason}`)
    ),
    TE.flatMap((response) =>
      response.ok
        ? TE.right(response)
        : TE.left(new Error(`HTTP error: ${response.status}`))
    ),
    TE.flatMap((response) =>
      TE.tryCatch(
        () => response.json(),
        (reason) => new Error(`JSON parse error: ${reason}`)
      )
    )
  );

// Clean composition with automatic error propagation
const getU

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Do not convert code that is stable, performance-critical or about to be deleted
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
