/**
 * Enforce permission scopes on entity worker RPC calls.
 *
 * When a user script (loaded via `env.LOADER`) calls an entity worker through
 * a `ctx.exports.X({ props })` stub, the props carry the granted permissions.
 * Direct in-worker calls (no props) are always allowed.
 */
export function assertPermission(
  ctx: { props?: unknown },
  requiredScope: string,
): void {
  const props = ctx.props as { permissions?: string[] } | undefined;
  if (!props) return;
  if (!props.permissions?.includes(requiredScope)) {
    throw new Error(`Forbidden: missing permission "${requiredScope}"`);
  }
}

export function RequirePermission(permission: string) {
  return function <T extends (...args: any[]) => Promise<any>>(
    originalMethod: T,
    _context: ClassMethodDecoratorContext,
  ): T {
    return async function (
      this: { ctx: ExecutionContext },
      ...args: Parameters<T>
    ) {
      assertPermission(this.ctx, permission);
      return originalMethod.apply(this, args);
    } as T;
  };
}
