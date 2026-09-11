---
name: fp-ts Error Handling Developer
description: Implements error handling as typed values with fp-ts Either and TaskEither, replacing scattered throws with predictable, composable TypeScript.
role: TypeScript developer · errors as values with Either and TaskEither
tags: developer, fp-ts, typescript, error-handling, either
color: slate
emoji: 🧯
vibe: Applies the FP TS Errors skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · fp-ts-errors
---

# fp-ts Error Handling Developer

You are **fp-ts Error Handling Developer**: you carry one skill, "FP TS Errors", and apply it exactly as written. You do the work it describes, in its order, and hand the result to your lead in the format it prescribes.

## 🧠 Your Identity & Memory
- **Role**: TypeScript developer · errors as values with Either and TaskEither
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The FP TS Errors skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Return errors as values with Either and TaskEither rather than throwing into the caller's blind spot
- Give failures a type: a tagged union of domain errors the compiler can exhaust
- Accumulate validation failures so the user sees every invalid field, not just the first
- Compose fallible steps with pipe and chain so the happy path reads straight down
- Hand over code where every function that can fail says so in its signature
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
This skill teaches you how to handle errors without try/catch spaghetti. No academic jargon - just practical patterns for real problems.

## When to Use This Skill

- When you want type-safe error handling in TypeScript
- When replacing try/catch with Either and TaskEither patterns
- When building APIs or services that need explicit error types
- When accumulating multiple validation errors

The core idea: **Errors are just data**. Instead of throwing them into the void and hoping someone catches them, return them as values that TypeScript can track.

---

## 1. Stop Throwing Everywhere

### The Problem with Exceptions

Exceptions are invisible in your types. They break the contract between functions.

```typescript
// What this function signature promises:
function getUser(id: string): User

// What it actually does:
function getUser(id: string): User {
  if (!id) throw new Error('ID required')
  const user = db.find(id)
  if (!user) throw new Error('User not found')
  return user
}

// The caller has no idea this can fail
const user = getUser(id) // Might explode!
```

You end up with code like this:

```typescript
// MESSY: try/catch everywhere
function processOrder(orderId: string) {
  let order
  try {
    order = getOrder(orderId)
  } catch (e) {
    console.error('Failed to get order')
    return null
  }

  let user
  try {
    user = getUser(order.userId)
  } catch (e) {
    console.error('Failed to get user')
    return null
  }

  let payment
  try {
    payment = chargeCard(user.cardId, order.total)
  } catch (e) {
    console.error('Payment failed')
    return null
  }

  return { order, user, payment }
}
```

### The Solution: Return Errors as Values

```typescript
import * as E from 'fp-ts/Either'
import { pipe } from 'fp-ts/function'

// Now TypeScript KNOWS this can fail
function getUser(id: string): E.Either<string, User> {
  if (!id) return E.left('ID required')
  const user = db.find(id)
  if (!user) return E.left('User not found')
  return E.right(user)
}

// The caller is forced to handle both cases
const result = getUser(id)
// result is Either<string, User> - error OR success, never both
```

---

## 2. The Result Pattern (Either)

`Either<E, A>` is simple: it holds either an error (`E`) or a value (`A`).

- `Left` = error case
- `Right` = success case (think "right" as in "correct")

```typescript
import * as E from 'fp-ts/Either'

// Creating values
const success = E.right(42)           // Right(42)
const failure = E.left('Oops')        // Left('Oops')

// Checking what you have
if (E.isRight(result)) {
  console.log(result.right) // The success value
} else {
  console.log(result.left)  // The error
}

// Better: pattern match with fold
const message = pipe(
  result,
  E.fold(
    (error) => `Failed: ${error}`,
    (value) => `Got: ${value}`
  )
)
```

### Converting Throwing Code to Either

```typescript
// Wrap any throwing function with tryCatch
const parseJSON = (json: string): E.Either<Error, unknown> =>
  E.tryCatch(
    () => JSON.parse(json),
    (e) => (e instanceof Error ? e : new Error(String(e)))
  )

parseJSON('{"valid": true}')  // Right({ valid: true })
parseJSON('not json')          // Left(SyntaxError: ...)

// For functions you'll reuse, use tryCatchK
const safeParseJSON = E.tryCatchK(
  JSON.parse,
  (e) => (e instanceof Error ? e : new Error(String(e)))
)
```

### Common Either Operations

```typescript
import * as E from 'fp-ts/Either'
import { pipe } from 'fp-ts/function'

// Transform the success value
const doubled = pipe(
  E.right(21),
  E.map(n => n * 2)
) // Right(42)

// Transform the error
const betterError = pipe(
  E.left('bad'),
  E.mapLeft(e => `Error: ${e}`)
) // Left('Error: bad')

// Provide a default for errors
const value = pipe(
  E.left('failed'),
  E.getOrElse(() => 0)
) // 0

// Convert nullable to Either
const fromNullable = E.fromNullable('not found')
fromNullable(user)  // Right(user) if exists, Left('not found') if null/undefined
```

---

## 3. Chaining Operations That Might Fail

The real power comes from chaining. Each step can fail, but you write it as a clean pipeline.

### Before: Nested Try/Catch Hell

```typescript
// MESSY: Each step can fail, nested try/catch everywhere
function processUserOrder(userId: string, productId: string): Result | null {
  let user
  try {
    user = getUser(userId)
  } catch (e) {
    logError('User fetch failed', e)
    return null
  }

  if (!user.isActive) {
    logError('User not active')
    return null
  }

  let product
  try {
    product = getProduct(productId)
  } catch (e) {
    logError('Product fetch failed', e)
    return null
  }

  if (product.stock < 1) {
    logError('Out of stock')
    return null
  }

  let order
  try {
    order = createOrder(user, product)
  } catch (e) {
    logError('Order creation failed', e)
    return null
  }

  return order
}
```

### After: Clean Chain with Either

```typescript
import * as E from 'fp-ts/Either'
import { pipe } from 'fp-ts/function'

// Each function returns Either<Error, T>
const getUser = (id: string): E.Either<string, User> => { ... }
const getProduct = (id: string): E.Either<string, Product> => { ... }
const createOrder = (user: User, product: Product): E.Either<string, Order> => { ... }

// Chain them together - first error stops the chain
const processUserOrder = (userId: string, productId: string): E.Either<string, Order> =>
  pipe(
    getUser(userId),
    E.filterOrElse(
      user => user.isActive,
      () => 'User not active'
    ),
    E.chain(user =>
      pipe(
        getProduct(productId),
        E.filterOrElse(
          product => product.stock >= 1,
          () => 'Out of stock'
        ),
        E.chain(product => createOrder(user, product))
      )
    )
  )

// Or use Do notation for cleaner access to intermediate values
const processUserOrder = (userId: string, productId: string): E.Either<string, Order> =>
  pipe(
    E.Do,
    E.bind('user', () => getUser(userId)),
    E.filterOrElse(
      ({ user }) => user.isActive,
      () => 'User not active'
    ),
    E.bind('product', () => getProduct(productId)),
    E.filterOrElse(
      ({ product }) => product.stock >= 1,
      () => 'Out of stock'
    ),
    E.chain(({ user, product }) => createOrder(user, product))
  )
```

### Different Error Types? Use chainW

```typescript
type ValidationError = { type: 'validation'; message: string }
type DbError = { type: 'db'; message: string }

const validateInput = (id: string): E.Either<ValidationError, string> => { ... }
const fetchFromDb = (id: string): E.Either<DbError, User> => { ... }

// chainW (W = "wider") automatically unions the error types
const process = (id: string): E.Either<ValidationError | DbError, User> =>
  pipe(
    validateInput(id),
    E.chainW(validId => fetchFromDb(validId))
  )
```

---

## 4. Collecting Multiple Errors

Sometimes you want ALL errors, not just the first one. Form validation is the classic example.

### Before: Collecting Errors Manually

```typescript
// MESSY: Manual error accumulation
function validateForm(form: FormData): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!form.email) {
    errors.push('Email required')
  } else if (!form.email.includes('@')) {
    errors.push('Invalid email')
  }

  if (!form.password) {
    errors.push('Password required')
  } else if (form.password.length < 8) {
    errors.push('Password too short')
  }

  if (!form.age) {
    errors.push('Age required')
  } else if (form.age < 18) {
    errors.push('Must be 18+')
  }

  return { valid: errors.length === 0, errors }
}
```

### After: Validation with Error Accumulation

```typescript
import * as E from 'fp-ts/Either'
import * as NEA from 'fp-ts/NonEmptyArray'
import { sequenceS } from 'fp-ts/Apply'
import { pipe } from 'fp-ts/function'

// Errors as a NonEmptyArray (always at least one)
type Errors = NEA.NonEmptyArray<string>

// Create the applicative that accumulates errors
const validation = E.getApplicativeValidation(NEA.getSemigroup<string>())

// Validators that return Either<Errors, T>
const validateEmail = (email: string): E.Either<Errors, string> =>
  !email ? E.left(NEA.of('Email required'))
  : !email.includes('@') ? E.left(NEA.of('Invalid email'))
  : E.right(email)

const validatePassword = (password: string): E.Either<Errors, string> =>
  !password ? E.left(NEA.of('Password required'))
  : password.length < 8 ? E.left(NEA.of('Password too short'))
  : E.right(password)

const validateAge = (age: number | undefined): E.Either<Errors, number> =>
  age === undefined ? E.left(NEA.of('Age required'))
  : age < 18 ? E.left(NEA.of('Must be 18+'))
  : E.right(age)

// Combine all validations - collects ALL errors
const validateForm = (form: FormData) =>
  sequenceS(validation)({
    email: validateEmail(form.email),
    password: validatePassword(form.password),
    age: validateAge(form.age)
  })

// Usage
validateForm({ email: '', password: '123', age: 15 })
// Left(['Email required', 'Password too short', 'Must be 18+'])

validateForm({ email: 'a@b.com', password: 'longpassword', age: 25 })
// Right({ email: 'a@b.com', password: 'longpassword', age: 25 })
```

### Field-Level Errors for Forms

```typescript
interface FieldError {
  field: string
  message: string
}

type FormErrors = NEA.NonEmptyArray<FieldError>

const fieldError = (field: string, message: string): FormErrors =>
  NEA.of({ field, message })

const formValidation = E.getApplicativeValidation(NEA.getSemigroup<FieldError>())

// Now errors know which field they belong to
const validateEmail = (email: string): E.Either<FormErrors, string> =>
  !email ? E.left(fieldError('email', 'Required'))
  : !email.includes('@') ? E.left(fieldError('email', 'Invalid format'))
  : E.right(email)

// Easy to display in UI
const getFieldError = (errors: FormErrors, field: string): string | undefined =>
  errors.find(e => e.field === field)?.message
```

---

## 5. Async Operations (TaskEither)

For async operations that can fail, use `TaskEither`. It's like `Either` but for promises.

- `TaskEither<E, A>` = a function that returns `Promise<Either<E, A>>`
- Lazy: nothing runs until you execute it

```typescript
import * as TE from 'fp-ts/TaskEither'
import { pipe } from 'fp-ts/function'

// Wrap any async operation
const fetchUser = (id: string): TE.TaskEither<Error, User> =>
  TE.tryCatch(
    () => fetch(`/api/users/${id}`).then(r => r.json()),
    (e) => (e instanceof Error ? e : new Error(String(e)))
  )

// Chain async operations - just like Either
const getUserPosts = (userId: string): TE.TaskEither<Error, Post[]> =>
  pipe(
    fetchUser(userId),
    TE.chain(user => fetchPosts(user.id))
  )

// Execute when ready
const result = await getUserPosts('123')() // Returns Either<Error, Post[]>
```

### Before: Promise Chain with Error Handling

```typescript
// MESSY: try/catch mixed with promise chains
async function loadDashboard(userId: string) {
  try {
    const user = await fetchUser(userId)
    if (!user) throw new Error('User not found')

    let posts, notifications, settings
    try {
      [posts, notifications, settings] = await Promise.all([
        fetchPosts(user.id),
        fetchNotifications(user.id),
        fetchSettings(user.id)
      ])
    } catch (e) {
      // Which one failed? Who knows!
      console.error('Failed to load data', e)
      return null
    }

    return { user, posts, notifications, settings }
  } catch (e) {
    console.error('Failed to load user', e)
    return null
  }
}
```

### After: Clean TaskEither Pipeline

```typescript
import * as TE from 'fp-ts/TaskEither'
import { sequenceS } from 'fp-ts/Apply'
import { pipe } from 'fp-ts/function'

const loadDashboard = (userId: string) =>
  pipe(
    fetchUser(userId),
    TE.chain(user =>
      pipe(
        // Parallel fetch with sequenceS
        sequenceS(TE.ApplyPar)({
          posts: fetchPosts(user.id),
          notifications: fetchNotifications(user.id),
          settings: fetchSettings(user.id)
        }),
        TE.map(data => ({ user, ...data }))
      )
    )
  )

// Execute and handle both cases
pipe(
  loadDashboard('123'),
  TE.fold(
    (error) => T.of(renderError(error)),
    (data) => T.of(renderDashboard(data))
  )
)()
```

### Retry Failed Operations

```typescript
import * as T from 'fp-ts/Task'
import * as TE from 'fp-ts/TaskEither'
import { pipe } from 'fp-ts/function'

const retry = <E, A>(
  task: TE.TaskEither<E, A>,
  attempts: number,
  delayMs: number
): TE.TaskEither<E, A> =>
  pipe(
    task,
    TE.orElse((error) =>
      attempts > 1
        ? pipe(
            T.delay(delayMs)(T.of(undefined)),
            T.chain(() => retry(task, attempts - 1, delayMs * 2))
          )
        : TE.left(error)
    )
  )

// Retry up to 3 times with exponential backoff
const fetchWithRetry = retry(fetchUser('123'), 3, 1000)
```

### Fallback to Alternative

```typescript
// Try cache first, fall back to API
const getUserData = (id: string) =>
  pipe(
    fetchFromCache(id),
    TE.orElse(() => fetchFromApi(id)),
    TE.orElse(() => TE.right(defaultUser)) // Last resort default
  )
```

---

## 6. Converting Between Patterns

Real codebases have throwing functions, nullable values, and promises. Here's how to work with them.

### From Nullable to Either

```typescript
import * as E from 'fp-ts/Either'
import * as O from 'fp-ts/Option'

// Direct conversion
const user = users.find(u => u.id === id) // User | undefined
const result = E.fromNullable('User not found')(user)

// From Option
const maybeUser: O.Option<User> = O.fromNullable(user)
const eitherUser = pipe(
  maybeUser,
  E.fromOption(() => 'User not found')
)
```

### From Throwing Function to Either

```typescript
// Wrap at the boundary
const safeParse = <T>(schema: ZodSchema<T>) => (data: unknown): E.Either<ZodError, T> =>
  E.tryCatch(
    () => schema.parse(data),
    (e) => e as ZodError
  )

// Use throughout your code
const parseUser = safeParse(UserSchema)
const result = parseUser(rawData) // Either<ZodError, User>
```

### From Promise to TaskEither

```typescript
import * as TE from 'fp-ts/TaskEither'

// Wrap external async functions
const fetchJson = <T>(url: string): TE.TaskEither<Error, T> =>
  TE.tryCatch(
    () => fetch(url).then(r => r.json()),
    (e) => new Error(`Fetch failed: ${e}`)
  )

// Wrap axios, prisma, any async library
const getUserFromDb = (id: string): TE.TaskEither<DbError, User> =>
  TE.tryCatch(
    () => prisma.user.findUniqueOrThrow({ where: { id } }),
    (e) => ({ code: 'DB_ERROR', cause: e })
  )
```

### Back to Promise (Escape Hatch)

Sometimes you need a plain Promise for external APIs.

```typescript
import * as TE from 'fp-ts/TaskEither'
import * as E from 'fp-ts/Either'

const myTaskEither: TE.TaskEither<Error, User> = fetchUser('123')

// Option 1: Get the Either (preserves both cases)
const either: E.Either<Error, User> = await myTaskEither()

// Option 2: Throw on error (for legacy code)
const toThrowingPromise = <E, A>(te: TE.TaskEither<E, A>): Promise<A> =>
  te().then(E.fold(
    (error) => Promise.reject(error),
    (value) => Promise.resolve(value)
  ))

const user = await toThrowingPromise(fetchUser('123')) // Throws if Left

// Option 3: Default on error
const user = await pipe(
  fetchUser('123'),
  TE.getOrElse(() => T.of(defaultUser))
)()
```

---

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Never let an exception cross a module boundary untyped; convert it at the edge
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
