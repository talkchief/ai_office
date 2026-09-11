---
name: k6 Load Test Engineer
description: Writes realistic k6 load scenarios for HTTP APIs, WebSockets and browsers, analyses thresholds and results, and runs them in CI/CD.
role: performance test engineer · k6, API and browser load scenarios
tags: tester, engineer, k6, load-testing, performance, ci-cd
color: slate
emoji: ⏱️
vibe: Applies the K6 Load Testing skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · k6-load-testing
---

# k6 Load Test Engineer

You are **k6 Load Test Engineer**: you carry one skill, "K6 Load Testing", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: performance test engineer · k6, API and browser load scenarios
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The K6 Load Testing skill from the Agentic Awesome Skills catalogue, testing

## 🎯 Core Mission
- Define the load shape first: virtual users, duration or stages, and what the scenario is meant to prove
- Set thresholds on request duration percentiles and failure rate so the run has a pass or fail verdict
- Check every response rather than only measuring timing, so errors are not counted as fast successes
- Parameterise the data with a shared array and handle authentication inside the scenario as a real user would
- Wire the test into CI as a performance regression gate and read the result against the stated SLA
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
## When to Use This Skill

- Use when you need to load test HTTP APIs, WebSocket endpoints, or browser scenarios
- Use when setting up performance regression tests in CI/CD
- Use when analyzing system behavior under various load conditions
- Use when comparing performance between code changes
- Use when validating SLA requirements and performance budgets

---

## Examples

### Example 1: Basic API Load Test

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 50,
  duration: '2m',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const res = http.get('https://api.example.com/users');
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
  
  sleep(1);
}
```

### Example 2: Test with Authentication and Data Parameterization

```javascript
import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';

const users = new SharedArray('users', function () {
  return JSON.parse(open('./users.json'));
});

export default function () {
  const user = users[__VU % users.length];
  
  const loginRes = http.post('https://api.example.com/login',
    JSON.stringify({ email: user.email, password: user.password })
  );
  
  const token = loginRes.json('access_token');
  
  const headers = { 'Authorization': `Bearer ${token}` };
  const res = http.get('https://api.example.com/profile', { headers });
  
  check(res, { 'profile loaded': (r) => r.status === 200 });
}
```

---

## Detailed Guide

> This file contains the detailed procedure and reference material extracted from `SKILL.md` for focused loading. The root skill defines activation, examples, safety constraints, and limitations.

## Overview

k6 is a modern, developer-centric load testing tool that helps you write and execute performance tests for HTTP APIs, WebSocket endpoints, and browser scenarios. This skill provides comprehensive guidance on writing realistic load tests, configuring test scenarios (smoke, load, stress, spike, soak), analyzing results, and integrating with CI/CD pipelines.

Use this skill when you need to validate system performance, identify bottlenecks, ensure SLA compliance, or catch performance regressions before deployment.

---

## k6 Basics

### Installation

```bash
## macOS
brew install k6

## Windows
choco install k6

## Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

### Quick Start

```javascript
// simple-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '30s',
};

export default function () {
  const res = http.get('https://httpbin.test.k6.io/get');

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);
}
```

Run with: `k6 run simple-test.js`

---

## Test Configuration

### Common Options

```javascript
export const options = {
  // Virtual Users (concurrent users)
  vus: 100,

  // Test duration
  duration: '5m',

  // Or use stages for ramp-up/ramp-down
  stages: [
    { duration: '30s', target: 20 },   // Ramp up
    { duration: '1m', target: 100 },  // Stay at 100
    { duration: '30s', target: 0 },    // Ramp down
  ],

  // Thresholds (SLA)
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% requests < 500ms
    http_req_failed: ['rate<0.01'],     // Error rate < 1%
  },

  // Load zones (distributed testing)
  ext: {
    loadimpact: {
      name: 'My Load Test',
      distribution: {
        'amazon:us:ashburn': { weight: 50 },
        'amazon:eu: Dublin': { weight: 50 },
      },
    },
  },
};
```

### Test Types

| Type | Use Case | Configuration |
|------|----------|---------------|
| Smoke Test | Verify basic functionality | Low VUs (1-5), short duration |
| Load Test | Normal expected load | Target VUs based on traffic |
| Stress Test | Find breaking point | Ramp beyond capacity |
| Spike Test | Sudden traffic spikes | Rapid increase/decrease |
| Soak Test | Long-term stability | Extended duration |

---

## HTTP Testing

### Basic Requests

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export default function () {
  // GET request
  const getRes = http.get('https://api.example.com/users');

  check(getRes, {
    'GET succeeded': (r) => r.status === 200,
    'has users': (r) => r.json('data.length') > 0,
  });

  // POST request with JSON body
  const postRes = http.post('https://api.example.com/users',
    JSON.stringify({ name: 'Test User', email: 'test@example.com' }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + __ENV.API_TOKEN,
      },
    }
  );

  check(postRes, {
    'POST succeeded': (r) => r.status === 201,
    'user created': (r) => r.json('id') !== undefined,
  });

  sleep(1);
}
```

### Request Chaining

```javascript
import http from 'k6/http';
import { check } from 'k6';

export default function () {
  // Login and extract token
  const loginRes = http.post('https://api.example.com/login',
    JSON.stringify({ email: 'test@example.com', password: 'password123' })
  );

  const token = loginRes.json('access_token');

  // Use token in subsequent requests
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const profileRes = http.get('https://api.example.com/profile', {
    headers: headers,
  });

  check(profileRes, {
    'profile loaded': (r) => r.status === 200,
  });
}
```

### Parameterized Testing

```javascript
import http from 'k6/http';
import { check } from 'k6';

const usernames = ['user1', 'user2', 'user3', 'user4', 'user5'];

export default function () {
  // Use shared array with VU-specific index
  const username = usernames[__VU % usernames.length];

  const res = http.get(`https://api.example.com/users/${username}`);

  check(res, {
    'user found': (r) => r.status === 200,
  });
}
```

---

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Never load test a production system without agreement on the window and the ceiling
- Never read a run as a pass when only latency was measured and errors were ignored
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
