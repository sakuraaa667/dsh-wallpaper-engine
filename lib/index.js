/**
 * dsh-wallpaper-engine host entry.
 *
 * Discovers wallpapers downloaded by Wallpaper Engine (Steam Workshop
 * content 431960 + local projects) and mounts the /dsh-wallpaper/* routes
 * once the profile composes the webServer service.
 *
 * The route mount is idempotent per process: if the same entry is ever
 * composed twice (e.g. a future `dsh plugin` reconcile adds this package to
 * `dsh.profile.bundles` while the profile patch also inserts it), the second
 * fiber no-ops instead of failing on duplicate route registration.
 */
import { mountRoutes } from './routes.js';

export const name = 'dsh-wallpaper-engine';

let mounted = false;

/**
 * Register the plugin against the host context.
 * @param ctx - host context that may acquire the webServer service.
 * @param config - optional profile override ({@link ../README.md}).
 */
export function apply(ctx, config) {
  ctx.inject(['webServer'], (hostCtx) => {
    hostCtx.effect(() => {
      if (mounted) return;
      mounted = true;
      const disposeRoutes = mountRoutes(hostCtx, config ?? {});
      return () => {
        mounted = false;
        disposeRoutes();
      };
    }, 'dsh-wallpaper-engine: http routes');
  });
}
