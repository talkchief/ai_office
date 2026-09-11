---
name: Expo Performance Engineer
description: Adds EAS Observe to Expo apps and queries startup, navigation and custom-event metrics, traces and logs to diagnose performance problems in production.
role: mobile performance engineer · EAS Observe, startup and route metrics
tags: engineer, expo, eas-observe, performance, monitoring, react-native
color: slate
emoji: 📈
vibe: Applies the Expo Observe skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · expo-observe
---

# Expo Performance Engineer

You are **Expo Performance Engineer**: you carry one skill, "Expo Observe", and apply it exactly as written. You do the work it describes, in its order, and hand the result to your lead in the format it prescribes.

## 🧠 Your Identity & Memory
- **Role**: mobile performance engineer · EAS Observe, startup and route metrics
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Expo Observe skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Add the observability package and wrap the root layout with the component matching the project's SDK version
- Call the interactive marker where the screen is genuinely usable, not where rendering happens to finish
- Turn on per-route metrics through the router integration so navigation is measured screen by screen
- Query metrics, routes and events from the CLI and read them against the documented thresholds
- Separate slow-but-smooth startup from main-thread contention, and hand over the diagnosis with the numbers
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
## When to Use

Use this skill when you need use for anything related to EAS Observe — adding `expo-observe` to an Expo project (AppMetricsRoot/ObserveRoot HOC, markInteractive, the useObserve hook, and the Expo Router / React Navigation integrations for per-route metrics), querying via the EAS CLI (`eas observe:metrics-summary`,...

EAS Observe tracks startup, navigation, and custom-event performance from production Expo apps.

> **Source of truth:** https://docs.expo.dev/eas/observe/ — always consult the canonical docs when API details matter, especially get-started, configuration, integrations, and the metrics reference. EAS Observe is evolving; this skill's references are written to stay accurate but may lag the docs.

## Which reference to read

The three reference files in `./references/` cover the three things people typically need this skill for:

- **Adding EAS Observe to a project** → “Reference: Setup” below (see “Reference: Setup” below). Install, wrap the root layout (`AppMetricsRoot` on SDK 55, `ObserveRoot` on SDK 56+), call `markInteractive()` (global on SDK 55, via the `useObserve()` hook on SDK 56+), and optional per-route navigation metrics through the Expo Router / React Navigation integrations.
- **Querying metrics from the terminal** → “Reference: Queries” below (see “Reference: Queries” below). The five `eas observe:*` commands — `metrics-summary`, `metrics`, `routes`, `events`, `versions` — with flags, table layouts, JSON shapes, and common workflows.
- **Reading a dashboard or CLI output** → “Reference: Metrics” below (see “Reference: Metrics” below). Target thresholds per metric, what the TTI `frameRate.*` params mean, and diagnostic patterns for telling slow-but-smooth startup apart from main-thread contention or hard blocks.

## Quick links to the docs

- Get started: https://docs.expo.dev/eas/observe/get-started/
- Dashboard guide: https://docs.expo.dev/eas/observe/dashboard/
- Metrics reference: https://docs.expo.dev/eas/observe/reference/metrics/
- Expo Router integration: https://docs.expo.dev/eas/observe/integrations/expo-router/
- React Navigation integration: https://docs.expo.dev/eas/observe/integrations/react-navigation/
- Configuration: https://docs.expo.dev/eas/observe/configuration/

## Limitations

- Verify commands, API behavior, pricing, quotas, credentials, and deployment effects against current official documentation before making changes.
- Do not treat generated examples as a substitute for environment-specific tests, security review, or user approval for destructive or costly actions.

## Reference: Setup

EAS Observe collects app-startup performance metrics (cold launch, warm launch, bundle load, TTR, TTI) from production Expo apps. This reference summarizes the steps to add `expo-observe` to an existing project.

> Source: https://docs.expo.dev/eas/observe/get-started/ — consult this page for the latest guidance.

## SDK 55 vs SDK 56+ at a glance

The library exports differ between SDK versions. Pick the right one for the project's SDK before copying any snippet below.

| Concern | SDK 55 | SDK 56 and later |
|---|---|---|
| Root layout HOC | `AppMetricsRoot.wrap(...)` | `ObserveRoot.wrap(...)` |
| `markInteractive()` API | Global: `AppMetrics.markInteractive()` | Hook: `const { markInteractive } = useObserve()` |
| Import source | `expo-observe` | `expo-observe` (same package) |

Everything else — package name, build process, dashboard, debug-mode behavior — is the same across versions.

## Prerequisites

Before installing, confirm all of the following:

1. **An Expo account.** Sign up at [expo.dev/signup](https://expo.dev/signup) if needed.
2. **Expo SDK 55 or later.** Run `npx expo-doctor` to check, and `npx expo install --fix` to update dependencies. SDK 56+ unlocks the newer `ObserveRoot` / `useObserve` API.
3. **An EAS project.** The app must have `extra.eas.projectId` set in its app config. If not, run `eas init` to create one.

## Step 1 — Install the library

From the project root:

```sh
npx expo install --fix
npx expo install expo-observe
```

## Step 2 — Wrap the root layout

The HOC automatically measures **Time to First Render (TTR)**. Apply it to the file that exports the app's root component. The HOC name depends on the SDK version.

**SDK 55** — use `AppMetricsRoot`:

```tsx
// app/_layout.tsx
import { Stack } from 'expo-router';
import { AppMetricsRoot } from 'expo-observe';

function RootLayout() {
  return <Stack />;
}

export default AppMetricsRoot.wrap(RootLayout);
```

**SDK 56 and later** — use `ObserveRoot`:

```tsx
// app/_layout.tsx
import { Stack } from 'expo-router';
import { ObserveRoot } from 'expo-observe';

function RootLayout() {
  return <Stack />;
}

export default ObserveRoot.wrap(RootLayout);
```

**Without Expo Router** (`App.tsx`): wrap the default-exported `App` component the same way — `export default AppMetricsRoot.wrap(App);` on SDK 55, or `export default ObserveRoot.wrap(App);` on SDK 56+.

## Step 3 — Mark the app as interactive

TTI is **not** collected automatically. Signal it once the screen is genuinely ready for the user — i.e. after splash-screen-blocking work like update checks, authentication, initial data fetching, or splash animations finishes. Place the call in a `useEffect` that runs once that work resolves.

**SDK 55** — call the global `AppMetrics.markInteractive()`:

```tsx
// app/_layout.tsx
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { AppMetrics, AppMetricsRoot } from 'expo-observe';
import { useEffect, useState } from 'react';

SplashScreen.preventAutoHideAsync();

function RootLayout() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    async function prepare() {
      try {
        await authenticateUser();
        await fetchInitialData();
      } catch (e) {
        console.warn(e);
      } finally {
        setIsReady(true);
      }
    }
    prepare();
  }, []);

  useEffect(() => {
    if (isReady) {
      SplashScreen.hide();
      AppMetrics.markInteractive();
    }
  }, [isReady]);

  if (!isReady) return null;
  return <Stack />;
}

export default AppMetricsRoot.wrap(RootLayout);
```

**SDK 56 and later** — use the `useObserve()` hook to get a bound `markInteractive`:

```tsx
// app/_layout.tsx
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { ObserveRoot, useObserve } from 'expo-observe';
import { useEffect, useState } from 'react';

SplashScreen.preventAutoHideAsync();

function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const { markInteractive } = useObserve();

  useEffect(() => {
    async function prepare() {
      try {
        await authenticateUser();
        await fetchInitialData();
      } catch (e) {
        console.warn(e);
      } finally {
        setIsReady(true);
      }
    }
    prepare();
  }, []);

  useEffect(() => {
    if (isReady) {
      SplashScreen.hide();
      markInteractive();
    }
  }, [isReady, markInteractive]);

  if (!isReady) return null;
  return <Stack />;
}

export default ObserveRoot.wrap(RootLayout);
```

**Without Expo Router:** the structure is the same in `App.tsx`. Use `SplashScreen.hideAsync()` instead of `SplashScreen.hide()` and replace `<Stack />` with the app's root tree.

### Multiple entry screens

`markInteractive()` is safe to call repeatedly — only the **first** call per session is recorded. If the app has more than one entry screen (onboarding, login, deep-link targets), call `markInteractive()` on **each one**. Otherwise TTI will be missing for sessions that open via a deep link to a screen without the call.

## Step 4 — Build the app

Metrics are collected from real builds, not from `expo start`:

```sh
eas build
```

> By default, metrics collected from **debug builds** are not dispatched. A build is treated as a debug build when either the native app is a debug build or the JS bundle is a development bundle (`__DEV__` is `true`). To dispatch anyway while testing the integration, set `dispatchInDebug: true` when calling `configure()` — see [Enable metrics in development](https://docs.expo.dev/eas/observe/configuration/#enable-metrics-in-development). This has no effect on release builds.

## Step 5 — View the metrics

Open the **Observe** tab in the EAS dashboard at `https://expo.dev/accounts/[account]/projects/[project]/observe` to view metrics from the app.

To query metrics from the terminal with the EAS CLI, see [`./queries.md`](./queries.md). For interpreting the metrics themselves, see [`./metrics.md`](./metrics.md).

## Optional — per-route navigation metrics (SDK 56+)

By default `expo-observe` records app-wide startup metrics only. To additionally get **per-route / per-screen** navigation metrics (`cold_ttr`, `warm_ttr`, and a per-navigation `tti`, each tagged with the route/screen), enable one of the navigation integrations. These require **SDK 56 or later**; on earlier SDKs they are silent no-ops. Query the resulting data with `eas observe:routes` (see [`./queries.md`](./queries.md)).

Pick the integration that matches the app's router:

### Expo Router

Docs: https://docs.expo.dev/eas/observe/integrations/expo-router/

1. Enable the integration at module scope, **before any screen mounts** (it cannot be toggled at runtime — calling `configure()` after mount throws):

   ```tsx
   // app/_layout.tsx
   import { Observe } from 'expo-observe';

   Observe.configure({
     integrations: { 'expo-router': true },
   });
   ```

2. Call `useObserve()` inside each screen to get a `markInteractive` scoped to the current route, and call it from a `useEffect` once the screen is interactive:

   ```tsx
   import { useObserve } from 'expo-observe';
   import { useEffect } from 'react';

   export default function Home() {
     const { markInteractive } = useObserve();
     useEffect(() => {
       markInteractive();
     }, [markInteractive]);
     return (/* screen content */);
   }
   ```

Events are tagged with the route **pattern** (e.g. `/(tabs)/sessions/[sessionId]`) so the dashboard buckets distinct param values together; the resolved `url` and `routeParams` are also included. Requires `expo-router` installed at runtime, or the integration no-ops.

### React Navigation

Docs: https://docs.expo.dev/eas/observe/integrations/react-navigation/

Requires `@react-navigation/native` 7.0.0 or later. Same `useObserve()` screen usage as above, plus **two** extra changes:

1. Enable the integration at module scope, before mount:

   ```tsx
   // App.tsx
   import { Observe } from 'expo-observe';

   Observe.configure({
     integrations: { 'react-navigation': true },
   });
   ```

2. Replace the top-level `<NavigationContainer>` with `<ObserveNavigationContainer>` — a drop-in replacement that accepts the same props and forwards the same ref. If you pass a `linking` config it is used to resolve a human-readable screen path; otherwise the metric falls back to `route.name`.

   ```tsx
   import { ObserveNavigationContainer } from 'expo-observe/integrations/react-navigation';

   export default function App() {
     return <ObserveNavigationContainer>{/* navigators */}</ObserveNavigationContainer>;
   }
   ```

In both integrations, `useObserve()` is safe to leave in place even when the integration is disabled or the router package is absent — it falls back to the global `markInteractive`.

## Quick checklist

- [ ] SDK ≥ 55, EAS project linked.
- [ ] `expo-observe` installed via `npx expo install`.
- [ ] Root component exported through `AppMetricsRoot.wrap(...)` (SDK 55) or `ObserveRoot.wrap(...)` (SDK 56+).
- [ ] `markInteractive()` called from every entry screen once it is genuinely interactive — global `AppMetrics.markInteractive()` on SDK 55, or `useObserve()` hook on SDK 56+.
- [ ] (Optional, SDK 56+) Per-route metrics enabled via `Observe.configure({ integrations: { ... } })`, plus `<ObserveNavigationContainer>` for React Navigation.
- [ ] New build produced with `eas build` and metrics visible in the Observe dashboard.

## Reference: Queries

EAS Observe collects app performance telemetry and custom events from Expo apps and exposes them through five EAS CLI commands. Pass the `--help` flag to any command for the latest API.

## Commands Overview

| Command | Purpose |
|---------|---------|
| `eas observe:metrics-summary` | Per-version statistical aggregates for app-startup performance metrics (median, p90, etc.) |
| `eas observe:metrics` | Individual performance metric samples ordered by value or timestamp (paginated) |
| `eas observe:routes` | Per-route statistical aggregates for navigation metrics (Cold TTR, Warm TTR, Nav TTI) |
| `eas observe:events` | Custom events emitted by the app via `logEvent` — name summary, all events, or filtered by event name (paginated) |
| `eas observe:versions` | App version hierarchy with build numbers, OTA update IDs, and event counts |

All five commands share these common flags:

- `--platform ios` or `--platform android` — filter by platform (default: both)
- `--start <ISO date>` and `--end <ISO date>` — explicit time range
- `--days <N>` — show data from the last N days (mutually exclusive with `--start`/`--end`)
- `--project-id <id>` — run against a specific project without needing a project directory. When passed, the command will not try to create a new EAS project where one is unneeded.
- `--json` — machine-readable output (implies `--non-interactive`)
- `--non-interactive` — fail instead of prompting

Default time range is the last 60 days when none of `--days`, `--start`, `--end` is given.

## Supported Metrics

### App-startup metrics

Used by `observe:metrics-summary` and `observe:metrics`.

| Alias | Full name | Display |
|-------|-----------|---------|
| `tti` | `expo.app_startup.tti` | Startup TTI (time to interactive) |
| `ttr` | `expo.app_startup.ttr` | Startup TTR (time to render) |
| `cold_launch` | `expo.app_startup.cold_launch_time` | Cold Launch |
| `warm_launch` | `expo.app_startup.warm_launch_time` | Warm Launch |
| `bundle_load` | `expo.app_startup.bundle_load_time` | Bundle Load |
| `update_download` | `expo.updates.download_time` | Update Download |

### Navigation metrics

Used by `observe:routes`. Measured per route name.

| Alias | Full name | Display |
|-------|-----------|---------|
| `cold_ttr` | `expo.navigation.cold_ttr` | Nav Cold TTR |
| `warm_ttr` | `expo.navigation.warm_ttr` | Nav Warm TTR |
| `nav_tti` | `expo.navigation.tti` | Nav TTI |

## `eas observe:metrics-summary`

Shows per-version statistical aggregates for one or more metrics, with separate tables per platform.

```bash
## All default metrics, last 60 days, both platforms
eas observe:metrics-summary

## Single metric
eas observe:metrics-summary --metric tti

## Multiple metrics — each renders as its own table
eas observe:metrics-summary --metric tti --metric cold_launch

## Choose which statistics to display
eas observe:metrics-summary --metric tti --stat median --stat p90 --stat eventCount

## Narrow time range and platform
eas observe:metrics-summary --metric tti --days 14 --platform ios
```

**Stat flags:** `min`, `max`, `median` (alias `med`), `average` (alias `avg`), `p80`, `p90`, `p99`, `eventCount` (alias `count`).

**Default stats:** `median` + `eventCount` in the table; all stats in JSON.

**Table layout:**
- One table per metric (with merged value + event count cells, e.g. `0.45s (150)`)
- Each table shows iOS and Android in separate sections
- App Version column includes build numbers in parentheses (e.g. `1.2.0 (42)`)
- Footer row per platform shows total events per metric
- **Update IDs are omitted from the table** to keep output readable when a version has many updates; they are included in the JSON output as an array per version

**JSON output shape:**
```json
{
  "versions": [
    {
      "appVersion": "1.2.0",
      "platform": "IOS",
      "buildNumbers": ["42"],
      "updateIds": ["abc-def-...", "..."],
      "metrics": {
        "expo.app_startup.tti": { "median": 0.45, "p90": 0.9, "...": "..." }
      }
    }
  ],
  "totalEventCounts": {
    "expo.app_startup.tti": { "IOS": 1234, "ANDROID": 890 }
  }
}
```

## `eas observe:metrics`

Shows individual performance metric samples, paginated. The metric is a positional argument, not a flag. If omitted and running interactively, prompts for selection; in non-interactive mode it throws an error.

```bash
## Interactive: prompts for metric
eas observe:metrics

## Specify metric as positional arg
eas observe:metrics tti

## Filter by version or update, sort by slowest
eas observe:metrics tti --app-version 1.2.0 --sort slowest --limit 20

## Pagination — pass the endCursor from the previous run
eas observe:metrics tti --after <cursor>
```

**Sample-specific flags:**
- `--sort <oldest|newest|slowest|fastest>` — defaults to `oldest`
- `--limit <N>` — samples per page (default 10, max 100)
- `--after <cursor>` — pagination cursor from the previous run
- `--app-version <version>` — filter by app version string
- `--update-id <id>` — filter by EAS update ID

**Table layout:**
- Summary header shows the metric name, time range, and total sample count across all versions (e.g. `TTI samples for the last 60 days — 1,234 total events`)
- Columns: Value, App Version (with build number), Update (only when any sample has one), Platform, Device, Country, Timestamp
- When `hasNextPage` is true, prints `Next page: --after <endCursor>` hint below the table
- JSON output also includes `sessionId`, `easClientId`, and a `customParams` object per sample

## `eas observe:routes`

Shows per-route statistical aggregates for navigation metrics (Cold TTR, Warm TTR, Nav TTI), grouped by route name with separate sections per platform.

```bash
## All three navigation metrics, default stats, last 60 days, both platforms
eas observe:routes

## Single metric, last 7 days, iOS only
eas observe:routes --metric nav_tti --days 7 --platform ios

## Multiple metrics and stats
eas observe:routes --metric cold_ttr --metric warm_ttr --stat median --stat p90 --stat count

## Filter to a single build
eas observe:routes --app-version 1.2.0 --build-number 42

## Narrow to specific routes (repeat the flag for multiple routes)
eas observe:routes --route-name /new --route-name /settings

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Check the canonical documentation whenever API details matter; the product is still changing
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
