import { createApiClient } from '@aura/api-client';

/** API client for client components: same-origin calls to the BFF, which adds the token. */
export const browserApi = createApiClient({ baseUrl: '/api' });
