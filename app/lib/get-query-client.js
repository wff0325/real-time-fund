import { QueryClient } from '@tanstack/react-query';

const defaultOptions = {
  queries: {
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  },
};

function createQueryClient() {
  return new QueryClient({ defaultOptions });
}

let browserQueryClient;

/**
 * 与 {@link QueryClientProviderWrapper} 共用同一浏览器端实例，便于在 fund API 等模块里使用 fetchQuery 做去重与缓存。
 */
export function getQueryClient() {
  if (typeof window === 'undefined') {
    return createQueryClient();
  }
  if (!browserQueryClient) {
    browserQueryClient = createQueryClient();
  }
  return browserQueryClient;
}
