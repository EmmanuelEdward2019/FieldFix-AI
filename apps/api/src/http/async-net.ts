import type { Application, Router } from "express";

/**
 * Centralized async safety net.
 *
 * Express 4 forwards *synchronous* handler throws to error middleware, but a
 * rejected promise from an `async` handler becomes an unhandled rejection and
 * never reaches it. `hardenApp` closes that gap for every route mounted in
 * `createApp` — present and future — with no per-route edits.
 */

interface StackLayer {
  handle?: unknown;
  route?: { stack?: unknown[] };
}

/** Marker proving a handler was wrapped by this net. Exported for structural tests. */
export const ASYNC_SAFE_MARK = "__fieldfixAsyncSafe";

function isAsyncFunction(handle: unknown): handle is (...args: never[]) => unknown {
  if (typeof handle !== "function") return false;
  const ctor = (handle as { constructor?: { name?: unknown } }).constructor;
  return ctor?.name === "AsyncFunction";
}

function forwardToNext(args: readonly unknown[], err: unknown): boolean {
  const next = args[args.length - 1];
  if (typeof next === "function") {
    (next as (e: unknown) => void)(err);
    return true;
  }
  return false;
}

function isMarked(handle: (...args: never[]) => unknown): boolean {
  return (handle as unknown as Record<string, unknown>)[ASYNC_SAFE_MARK] === true;
}

/**
 * Wrap one async handler so sync throws and rejections reach Express error
 * middleware. Arity is preserved (Express detects error middleware by
 * `fn.length`), Express still passes `(req, res, next)` at call time even when
 * the handler declares fewer parameters, and wrapping is idempotent.
 */
export function wrapAsyncHandler<T extends (...args: never[]) => unknown>(handle: T): T {
  if (isMarked(handle)) return handle;
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    let result: unknown;
    try {
      result = Reflect.apply(handle, this, args);
    } catch (err) {
      if (!forwardToNext(args, err)) throw err;
      return undefined;
    }
    if (typeof (result as PromiseLike<unknown> | null)?.then === "function") {
      void (result as PromiseLike<unknown>).then(undefined, (err: unknown) => {
        // No `next` to forward to: stay loud (same as today's unhandled
        // rejection) rather than swallowing the failure silently.
        if (!forwardToNext(args, err)) {
          throw err;
        }
      });
    }
    return result;
  };
  Object.defineProperty(wrapped, "length", { value: handle.length });
  Object.defineProperty(wrapped, "name", { value: `asyncSafe(${handle.name || "anonymous"})` });
  Object.defineProperty(wrapped, ASYNC_SAFE_MARK, { value: true });
  return wrapped as unknown as T;
}

function hardenLayer(layer: StackLayer): void {
  const { handle } = layer;
  if (isAsyncFunction(handle)) {
    layer.handle = wrapAsyncHandler(handle);
    return;
  }
  // Nested router mounted via `router.use(subRouter)`: recurse into it.
  const nested = (handle as { stack?: unknown } | null)?.stack;
  if (Array.isArray(nested)) {
    for (const child of nested) hardenLayer(child as StackLayer);
    return;
  }
  const routeStack = layer.route?.stack;
  if (Array.isArray(routeStack)) {
    for (const child of routeStack) hardenLayer(child as StackLayer);
  }
}

/** Harden one router in place; chainable for mount sites. */
export function hardenRouter(router: Router): Router {
  const stack = (router as unknown as { stack?: unknown[] }).stack;
  if (Array.isArray(stack)) {
    for (const layer of stack) hardenLayer(layer as StackLayer);
  }
  return router;
}

/**
 * Harden every layer mounted on the app: routers are recursed into, bare
 * async middleware is wrapped, sync handlers and error middleware are left
 * untouched. Call once in `createApp` after all mounts.
 */
export function hardenApp(app: Application): Application {
  const stack = (app as unknown as { _router?: { stack?: unknown[] } })._router?.stack;
  if (Array.isArray(stack)) {
    for (const layer of stack) hardenLayer(layer as StackLayer);
  }
  return app;
}
