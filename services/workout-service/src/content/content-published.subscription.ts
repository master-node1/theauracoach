import { subscribe, type Subscription } from '@aura/service-kit';
import type { LibraryCache } from './library-cache';

/**
 * Drops the exercise library cache when an exercise version goes live, whoever published it
 * (another http instance, the content importer). Invalidation is idempotent, so a redelivered
 * event only costs one cache refill.
 */
export function contentPublishedSubscription(
  cache: Pick<LibraryCache, 'invalidate'>,
): Subscription {
  return subscribe('ContentPublished@1', async (event) => {
    if (event.data.kind === 'exercise') await cache.invalidate();
  }) as Subscription;
}
