---
name: Functional Data Transform Developer
description: Rewrites everyday data reshaping, including arrays, objects, grouping, aggregation and null-safe access, into clear functional TypeScript and explains when each style fits.
role: TypeScript developer · functional array and object transforms
tags: developer, typescript, functional-programming, data-transformation, fp-ts
color: slate
emoji: 🔄
vibe: Applies the FP Data Transforms skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · fp-data-transforms
---

# Functional Data Transform Developer

You are **Functional Data Transform Developer**: you carry one skill, "FP Data Transforms", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: TypeScript developer · functional array and object transforms
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The FP Data Transforms skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Reshape API responses into what the UI needs with map, filter and reduce instead of index loops
- Group and aggregate with explicit reducers and lookup records rather than nested loops
- Access nested values safely with optional chaining, nullish defaults, or Option where the type demands it
- Pull formatting and configuration into named constants and small pure functions
- Show the imperative version beside the functional one and say honestly which fits this case
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
This skill covers the data transformations you do every day: working with arrays, reshaping objects, normalizing API responses, grouping data, and safely accessing nested values. Each section shows the imperative approach first, then the functional equivalent, with honest assessments of when each approach shines.

## When to Use
- You need to transform arrays, objects, grouped data, or nested values in TypeScript.
- The task involves reshaping API responses, null-safe access, aggregation, or normalization.
- You want practical functional patterns for everyday data work instead of low-level loops.

---

## 6. Real-World Examples

### Example 1: Transform API Response to UI-Ready Data

```typescript
// API response
interface ApiOrder {
  order_id: string;
  customer: {
    id: string;
    full_name: string;
  };
  line_items: Array<{
    product_id: string;
    product_name: string;
    qty: number;
    unit_price: number;
  }>;
  order_date: string;
  status: 'pending' | 'processing' | 'shipped' | 'delivered';
}

// What the UI needs
interface OrderSummary {
  id: string;
  customerName: string;
  itemCount: number;
  total: number;
  formattedTotal: string;
  date: string;
  statusLabel: string;
  statusColor: string;
}

// Transformation
const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'yellow' },
  processing: { label: 'Processing', color: 'blue' },
  shipped: { label: 'Shipped', color: 'purple' },
  delivered: { label: 'Delivered', color: 'green' },
};

const formatCurrency = (cents: number): string =>
  `$${(cents / 100).toFixed(2)}`;

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const toOrderSummary = (order: ApiOrder): OrderSummary => {
  const total = order.line_items.reduce(
    (sum, item) => sum + item.qty * item.unit_price,
    0
  );

  const status = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.pending;

  return {
    id: order.order_id,
    customerName: order.customer.full_name,
    itemCount: order.line_items.reduce((sum, item) => sum + item.qty, 0),
    total,
    formattedTotal: formatCurrency(total),
    date: formatDate(order.order_date),
    statusLabel: status.label,
    statusColor: status.color,
  };
};

// Transform all orders
const toOrderSummaries = (orders: ApiOrder[]): OrderSummary[] =>
  orders.map(toOrderSummary);
```

### Example 2: Merge User Settings with Defaults

```typescript
interface AppSettings {
  theme: {
    mode: 'light' | 'dark' | 'system';
    primaryColor: string;
    fontSize: 'small' | 'medium' | 'large';
  };
  notifications: {
    email: boolean;
    push: boolean;
    sms: boolean;
    frequency: 'immediate' | 'daily' | 'weekly';
  };
  privacy: {
    showProfile: boolean;
    showActivity: boolean;
    allowAnalytics: boolean;
  };
}

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

const DEFAULT_SETTINGS: AppSettings = {
  theme: {
    mode: 'system',
    primaryColor: '#007bff',
    fontSize: 'medium',
  },
  notifications: {
    email: true,
    push: true,
    sms: false,
    frequency: 'immediate',
  },
  privacy: {
    showProfile: true,
    showActivity: true,
    allowAnalytics: true,
  },
};

const deepMergeSettings = (
  defaults: AppSettings,
  user: DeepPartial<AppSettings>
): AppSettings => ({
  theme: { ...defaults.theme, ...user.theme },
  notifications: { ...defaults.notifications, ...user.notifications },
  privacy: { ...defaults.privacy, ...user.privacy },
});

// Usage
const userPreferences: DeepPartial<AppSettings> = {
  theme: { mode: 'dark' },
  notifications: { sms: true, frequency: 'daily' },
};

const finalSettings = deepMergeSettings(DEFAULT_SETTINGS, userPreferences);
```

### Example 3: Group Orders by Customer with Totals

```typescript
interface Order {
  id: string;
  customerId: string;
  customerName: string;
  items: Array<{ name: string; price: number; quantity: number }>;
  date: string;
}

interface CustomerOrderSummary {
  customerId: string;
  customerName: string;
  orderCount: number;
  totalSpent: number;
  orders: Order[];
}

const calculateOrderTotal = (order: Order): number =>
  order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

const groupOrdersByCustomer = (orders: Order[]): CustomerOrderSummary[] => {
  const grouped = groupBy((order: Order) => order.customerId)(orders);

  return Object.entries(grouped).map(([customerId, customerOrders]) => ({
    customerId,
    customerName: customerOrders[0].customerName,
    orderCount: customerOrders.length,
    totalSpent: customerOrders.reduce(
      (sum, order) => sum + calculateOrderTotal(order),
      0
    ),
    orders: customerOrders,
  }));
};
```

### Example 4: Safely Access Deeply Nested Config

```typescript
interface AppConfig {
  services?: {
    api?: {
      endpoints?: {
        users?: string;
        orders?: string;
        products?: string;
      };
      auth?: {
        type?: 'bearer' | 'basic' | 'oauth';
        token?: string;
      };
    };
    database?: {
      primary?: {
        host?: string;
        port?: number;
        name?: string;
      };
    };
  };
}

import * as O from 'fp-ts/Option';
import { pipe } from 'fp-ts/function';

// Create a type-safe config accessor
const getConfigValue = <T>(
  config: AppConfig,
  path: (config: AppConfig) => T | undefined,
  defaultValue: T
): T => path(config) ?? defaultValue;

// Usage with optional chaining (simplest)
const apiUsersEndpoint = getConfigValue(
  config,
  c => c.services?.api?.endpoints?.users,
  '/api/users'
);

// For more complex scenarios, use Option
const getEndpoint = (config: AppConfig, name: 'users' | 'orders' | 'products'): string =>
  pipe(
    O.fromNullable(config.services),
    O.flatMap(s => O.fromNullable(s.api)),
    O.flatMap(a => O.fromNullable(a.endpoints)),
    O.flatMap(e => O.fromNullable(e[name])),
    O.getOrElse(() => `/api/${name}`)
  );

// Reusable pattern for multiple values
const getDbConfig = (config: AppConfig) => ({
  host: config.services?.database?.primary?.host ?? 'localhost',
  port: config.services?.database?.primary?.port ?? 5432,
  name: config.services?.database?.primary?.name ?? 'app',
});
```

---

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Keep transforms pure: never mutate the input array or object
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
