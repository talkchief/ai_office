---
name: IT Professional Sveltekit
description: Build full-stack web applications with SvelteKit — file-based routing, SSR, SSG, API routes, and form actions in one framework.
color: slate
emoji: 🛠️
vibe: Applies the Sveltekit skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · sveltekit
---

# IT Professional Sveltekit Agent

You are **IT Professional Sveltekit**: you carry one skill, "Sveltekit", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: Sveltekit specialist (frontend)
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Sveltekit skill from the Agentic Awesome Skills catalogue, frontend

## 🎯 Core Mission
- Apply the Sveltekit skill to the assignment, step by step, without skipping a step
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute
- Cite the skill by name in the report so the lead knows which method was applied

## 📋 The skill, as written
# SvelteKit Full-Stack Development

## Overview

SvelteKit is the official full-stack framework built on top of Svelte. It provides file-based routing, server-side rendering (SSR), static site generation (SSG), API routes, and progressive form actions — all with Svelte's compile-time reactivity model that ships zero runtime overhead to the browser. Use this skill when building fast, modern web apps where both DX and performance matter.

## When to Use This Skill

- Use when building a new full-stack web application with Svelte
- Use when you need SSR or SSG with fine-grained control per route
- Use when migrating a SPA to a framework with server capabilities
- Use when working on a project that needs file-based routing and collocated API endpoints
- Use when the user asks about `+page.svelte`, `+layout.svelte`, `load` functions, or form actions

## How It Works

### Step 1: Project Setup

```bash
npm create svelte@latest my-app
cd my-app
npm install
npm run dev
```

Choose **Skeleton project** + **TypeScript** + **ESLint/Prettier** when prompted.

Directory structure after scaffolding:

```
src/
  routes/
    +page.svelte        ← Root page component
    +layout.svelte      ← Root layout (wraps all pages)
    +error.svelte       ← Error boundary
  lib/
    server/             ← Server-only code (never bundled to client)
    components/         ← Shared components
  app.html              ← HTML shell
static/                 ← Static assets
```

### Step 2: File-Based Routing

Every `+page.svelte` file in `src/routes/` maps directly to a URL:

```
src/routes/+page.svelte          → /
src/routes/about/+page.svelte    → /about
src/routes/blog/[slug]/+page.svelte  → /blog/:slug
src/routes/shop/[...path]/+page.svelte → /shop/* (catch-all)
```

**Route groups** (no URL segment): wrap in `(group)/` folder.
**Private routes** (not accessible as URLs): prefix with `_` or `(group)`.

### Step 3: Loading Data with `load` Functions

Use a `+page.ts` (universal) or `+page.server.ts` (server-only) file alongside the page:

```typescript
// src/routes/blog/[slug]/+page.server.ts
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch }) => {
  const post = await fetch(`/api/posts/${params.slug}`).then(r => r.json());

  if (!post) {
    error(404, 'Post not found');
  }

  return { post };
};
```

```svelte
<!-- src/routes/blog/[slug]/+page.svelte -->
<script lang="ts">
  import type { PageData } from './$types';
  export let data: PageData;
</script>

<h1>{data.post.title}</h1>
<article>{@html data.post.content}</article>
```

### Step 4: API Routes (Server Endpoints)

Create `+server.ts` files for REST-style endpoints:

```typescript
// src/routes/api/posts/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const limit = Number(url.searchParams.get('limit') ?? 10);
  const posts = await db.post.findMany({ take: limit });
  return json(posts);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const post = await db.post.create({ data: body });
  return json(post, { status: 201 });
};
```

### Step 5: Form Actions

Form actions are the SvelteKit-native way to handle mutations — no client-side fetch required:

```typescript
// src/routes/contact/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request }) => {
    const data = await request.formData();
    const email = data.get('email');

    if (!email) {
      return fail(400, { email, missing: true });
    }

    await sendEmail(String(email));
    redirect(303, '/thank-you');
  }
};
```

```svelte
<!-- src/routes/contact/+page.svelte -->
<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData } from './$types';
  export let form: ActionData;
</script>

<form method="POST" use:enhance>
  <input name="email" type="email" />
  {#if form?.missing}<p class="error">Email is required</p>{/if}
  <button type="submit">Subscribe</button>
</form>
```

### Step 6: Layouts and Nested Routes

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import type { LayoutData } from './$types';
  export let data: LayoutData;
</script>

<nav>
  <a href="/">Home</a>
  <a href="/blog">Blog</a>
  {#if data.user}
    <a href="/dashboard">Dashboard</a>
  {/if}
</nav>

<slot />  <!-- child page renders here -->
```

```typescript
// src/routes/+layout.server.ts
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  return { user: locals.user ?? null };
};
```

### Step 7: Rendering Modes

Control per-route rendering with page options:

```typescript
// src/routes/docs/+page.ts
export const prerender = true;   // Static — generated at build time
export const ssr = true;         // Default — rendered on server per request
export const csr = false;        // Disable client-side hydration entirely
```

## Examples

### Example 1: Protected Dashboard Route

```typescript
// src/routes/dashboard/+layout.server.ts
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.user) {
    redirect(303, '/login');
  }
  return { user: locals.user };
};
```

### Example 2: Hooks — Session Middleware

```typescript
// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { verifyToken } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get('session');
  if (token) {
    event.locals.user = await verifyToken(token);
  }
  return resolve(event);
};
```

### Example 3: Preloading and Invalidation

```svelte
<script lang="ts">
  import { invalidateAll } from '$app/navigation';

  async function refresh() {
    await invalidateAll(); // re-runs all load functions on the page
  }
</script>

<button on:click={refresh}>Refresh</button>
```

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
