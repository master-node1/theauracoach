import { createApiClient, type ApiClient } from '@aura/api-client';
import { useMemo } from 'react';
import { useAuth } from './auth/AuthProvider';
import { appConfig } from './config';

/** API client that always sends a fresh access token. */
export function useApi(): ApiClient {
  const { getAccessToken } = useAuth();
  return useMemo(
    () => createApiClient({ baseUrl: appConfig.apiBaseUrl, getAccessToken }),
    [getAccessToken],
  );
}
