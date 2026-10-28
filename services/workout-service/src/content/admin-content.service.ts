import { Injectable } from '@nestjs/common';
import type { WorkoutContentKind } from '@aura/contracts';
import { ContentStore, type ContentActor } from './content-store';
import { LibraryCache } from './library-cache';

/**
 * The admin side of the content workflow: the store plus cache invalidation, so a publish or an
 * archive shows in the library on the next read from this instance. Other instances, and imports,
 * catch up through the ContentPublished consumer.
 */
@Injectable()
export class AdminContentService {
  constructor(
    readonly store: ContentStore,
    private readonly cache: LibraryCache,
  ) {}

  async publish(kind: WorkoutContentKind, id: string, actor: ContentActor) {
    const revision = await this.store.publish(kind, id, actor);
    if (kind === 'exercise') await this.cache.invalidate();
    return revision;
  }

  async archive(kind: WorkoutContentKind, id: string, actor: ContentActor) {
    const { revision, libraryChanged } = await this.store.archive(kind, id, actor);
    if (kind === 'exercise' && libraryChanged) await this.cache.invalidate();
    return revision;
  }
}
