// Who is asking. serve.mjs runs every API handler inside `run({ user, tenantId, instance })`, so code deep in a store
// (the audit log naming its actor, the engine stamping an owner) can ask without the value being threaded through.
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();
export const run = (context, fn) => als.run(context, fn);
export const current = () => als.getStore() || null;
export const currentUser = () => current()?.user || null;
