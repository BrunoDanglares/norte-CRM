import { queryClient } from "./queryClient";

const pageImportMap: Record<string, () => Promise<any>> = {};
const routePrefetchMap: Record<string, string[]> = {};
const routeDataPrefetchMap: Record<string, string[]> = {};
const _prefetched = new Set<string>();

export function registerPrefetch(
  pages: Record<string, () => Promise<any>>,
  routeChunks: Record<string, string[]>,
  routeData: Record<string, string[]>
) {
  Object.assign(pageImportMap, pages);
  Object.assign(routePrefetchMap, routeChunks);
  Object.assign(routeDataPrefetchMap, routeData);
}

export function prefetchRoute(url: string) {
  const clean = url.split("?")[0];
  if (_prefetched.has(clean)) return;
  _prefetched.add(clean);
  const chunkKeys = routePrefetchMap[clean];
  if (chunkKeys) chunkKeys.forEach(k => { const fn = pageImportMap[k]; if (fn) fn(); });
  const dataKeys = routeDataPrefetchMap[clean];
  if (dataKeys) dataKeys.forEach(key => queryClient.prefetchQuery({ queryKey: [key] }));
}
