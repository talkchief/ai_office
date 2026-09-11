---
name: Clerk Auth Developer
description: Implements Clerk authentication with middleware, organisations, webhooks and user sync to the application database.
role: auth developer · Clerk middleware, organisations, webhooks, user sync
tags: developer, clerk, authentication, next-js, webhooks
color: slate
emoji: 🔑
vibe: Applies the Clerk Auth skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · clerk-auth
---

# Clerk Auth Developer

You are **Clerk Auth Developer**: you carry one skill, "Clerk Auth", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: auth developer · Clerk middleware, organisations, webhooks, user sync
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Clerk Auth skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Wrap the app in ClerkProvider and set the publishable and secret keys and the sign-in, sign-up and redirect URLs in the environment
- Use the pre-built SignIn, SignUp and UserButton components before building custom auth screens
- Protect routes in middleware, listing public and protected paths explicitly
- Model multi-tenancy with Clerk organizations, roles and permissions, and wire SSO where the customer needs it
- Sync users into the application database through Clerk webhooks, handling created, updated and deleted events
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
Expert patterns for Clerk auth implementation, middleware, organizations, webhooks, and user sync

## When to Use
- User mentions or implies: adding authentication
- User mentions or implies: clerk auth
- User mentions or implies: user authentication
- User mentions or implies: sign in
- User mentions or implies: sign up
- User mentions or implies: user management
- User mentions or implies: multi-tenancy
- User mentions or implies: organizations
- User mentions or implies: sso
- User mentions or implies: single sign-on

## Detailed Guide

> This file contains the detailed procedure and reference material extracted from `SKILL.md` for focused loading. The root skill defines activation, examples, safety constraints, and limitations.

## Patterns

### Next.js App Router Setup

Complete Clerk setup for Next.js 14/15 App Router.

Includes ClerkProvider, environment variables, and basic
sign-in/sign-up components.

Key components:
- ClerkProvider: Wraps app for auth context
- <SignIn />, <SignUp />: Pre-built auth forms
- <UserButton />: User menu with session management

## Environment variables (.env.local)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/onboarding

// app/layout.tsx
import { ClerkProvider } from '@clerk/nextjs';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}

// app/sign-in/[[...sign-in]]/page.tsx
import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="flex justify-center items-center min-h-screen">
      <SignIn />
    </div>
  );
}

// app/sign-up/[[...sign-up]]/page.tsx
import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <div className="flex justify-center items-center min-h-screen">
      <SignUp />
    </div>
  );
}

// components/Header.tsx
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/nextjs';

export function Header() {
  return (
    <header className="flex justify-between p-4">
      <h1>My App</h1>
      <SignedOut>
        <SignInButton />
      </SignedOut>
      <SignedIn>
        <UserButton afterSignOutUrl="/" />
      </SignedIn>
    </header>
  );
}

### Anti_patterns

- Pattern: ClerkProvider inside page component | Why: Provider must wrap entire app in root layout | Fix: Move ClerkProvider to app/layout.tsx
- Pattern: Using auth() without middleware | Why: auth() requires clerkMiddleware to be configured | Fix: Set up middleware.ts with clerkMiddleware

### References

- https://clerk.com/docs/nextjs/getting-started/quickstart

### Middleware Route Protection

Protect routes using clerkMiddleware and createRouteMatcher.

Best practices:
- Single middleware.ts file at project root
- Use createRouteMatcher for route groups
- auth.protect() for explicit protection
- Centralize all auth logic in middleware

### Code Example

// middleware.ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Define protected route patterns
const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/settings(.*)',
  '/api/private(.*)',
]);

// Define public routes (optional, for clarity)
const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  // Protect matched routes
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Match all routes except static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};

// Advanced: Role-based protection
export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }

  // Admin routes require admin role
  if (req.nextUrl.pathname.startsWith('/admin')) {
    await auth.protect({
      role: 'org:admin',
    });
  }

  // Premium routes require premium permission
  if (req.nextUrl.pathname.startsWith('/premium')) {
    await auth.protect({
      permission: 'org:premium:access',
    });
  }
});

### Anti_patterns

- Pattern: Multiple middleware.ts files | Why: Causes conflicts and redirect loops | Fix: Use single middleware.ts with route matchers
- Pattern: Manual redirects in components | Why: Double redirects, missed routes | Fix: Handle all redirects in middleware
- Pattern: Missing matcher config | Why: Middleware won't run on all routes | Fix: Add comprehensive matcher pattern

### References

- https://clerk.com/docs/reference/nextjs/clerk-middleware

### Server Component Authentication

Access auth state in Server Components using auth() and currentUser().

Key functions:
- auth(): Returns userId, sessionId, orgId, claims
- currentUser(): Returns full User object
- Both require clerkMiddleware to be configured

### Code Example

// app/dashboard/page.tsx (Server Component)
import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  // Full user data (counts toward rate limits)
  const user = await currentUser();

  return (
    <div>
      <h1>Welcome, {user?.firstName}!</h1>
      <p>Email: {user?.emailAddresses[0]?.emailAddress}</p>
    </div>
  );
}

// Using auth() for quick checks
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, orgId, orgRole } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  // Check organization access
  if (!orgId) {
    redirect('/select-org');
  }

  return (
    <div>
      <p>Organization Role: {orgRole}</p>
      {children}
    </div>
  );
}

// Server Action with auth check
// app/actions/posts.ts
'use server';
import { auth } from '@clerk/nextjs/server';

export async function createPost(formData: FormData) {
  const { userId } = await auth();

  if (!userId) {
    throw new Error('Unauthorized');
  }

  const title = formData.get('title') as string;

  // Create post with userId
  const post = await prisma.post.create({
    data: {
      title,
      authorId: userId,
    },
  });

  return post;
}

### Anti_patterns

- Pattern: Not awaiting auth() | Why: auth() is async in App Router | Fix: Use await auth() or const { userId } = await auth()
- Pattern: Using currentUser() for simple checks | Why: Counts toward rate limits, slower than auth() | Fix: Use auth() for userId checks, currentUser() for user data

### References

- https://clerk.com/docs/references/n

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Never expose the Clerk secret key to the client; only the publishable key goes to the browser
- Verify every webhook signature before acting on its payload
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
