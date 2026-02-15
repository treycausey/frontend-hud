# Diagnostics Reference

Specification for all HUD diagnostic categories. Each entry defines what to display, how to gather it, framework-specific alternatives, fallback behavior, and update frequency.

## 1. Environment

Static build-time data injected by the build plugin.

| Field | Source | Fallback | Frequency |
|-------|--------|----------|-----------|
| Framework name | Build plugin detection (`sveltekit`, `nextjs`, `nuxt`, `vite`, `react`, `vue`) | `"unknown"` | One-time |
| Framework version | `package.json` version of framework package | `"--"` | One-time |
| Vite/Webpack version | `import('vite').then(v => v.version)` or `webpack.version` | `"--"` | One-time |
| Node.js version | `process.version` (server-side, injected at build) | `"--"` | One-time |
| Runtime | Detect Bun (`process.versions.bun`) vs Node | `"node"` | One-time |
| Runtime version | `process.versions.bun` or `process.version` | `"--"` | One-time |
| Package manager | Detect from lockfile: `bun.lockb` = bun, `yarn.lock` = yarn, `pnpm-lock.yaml` = pnpm, `package-lock.json` = npm | `"npm"` | One-time |

### Build Plugin Implementation

**Vite:** Virtual module `virtual:hud-diagnostics` exports an object with all fields. Resolved at plugin `configResolved` hook.

**Webpack:** `DefinePlugin` injects `__HUD_DIAGNOSTICS__` as a JSON-stringified global. Computed during plugin `apply`.

## 2. Server

Mix of build-time config and live server state.

| Field | Source | Fallback | Frequency |
|-------|--------|----------|-----------|
| Port | Vite: `config.server.port` / Webpack: `process.env.PORT` or `devServer.port` | `3000` / `5173` | One-time |
| URL | Constructed from host + port + protocol | `"http://localhost:{port}"` | One-time |
| Base path | Vite: `config.base` / Webpack: `output.publicPath` | `"/"` | One-time |
| HTTPS | Vite: `!!config.server.https` / Webpack: `devServer.https` | `false` | One-time |
| Active plugins | Vite: `config.plugins.map(p => p.name)` / Webpack: constructor names | `[]` | One-time |
| CLI flags | `process.argv.slice(2)` | `[]` | One-time |
| Module count | Vite: `server.moduleGraph.idToModuleMap.size` / Webpack: `stats.modules.length` | `0` | Polled via `/__hud` (5s) |
| Open connections | Vite: track WebSocket connections in `configureServer` | `0` | Polled via `/__hud` (5s) |
| Error count | Track errors from HMR / build errors | `0` | Polled via `/__hud` (5s) |

### `/__hud` Endpoint

Both Vite and Webpack plugins serve a `GET /__hud` JSON endpoint returning live server metrics:

```json
{
  "moduleCount": 142,
  "openConnections": 1,
  "errorCount": 0,
  "uptime": 3600
}
```

**Vite:** Registered via `configureServer` hook as middleware.

**Webpack:** Registered via `devServer.setupMiddlewares` or `before`/`after` hooks, or as Express middleware in `setupProxy.js` for CRA.

## 3. Routes

Client-side data from the framework router.

| Field | Source (by framework) | Fallback | Frequency |
|-------|----------------------|----------|-----------|
| Current path | **SvelteKit:** `$page.url.pathname` / **Next.js:** `usePathname()` / **Vue Router:** `route.path` / **Plain:** `window.location.pathname` | `window.location.pathname` | Event-driven (navigation) |
| Route params | **SvelteKit:** `$page.params` / **Next.js:** `useParams()` / **Vue Router:** `route.params` | `{}` | Event-driven |
| Query string | **SvelteKit:** `$page.url.searchParams` (formatted) / **Next.js:** `useSearchParams()` / **Vue Router:** `route.query` | `window.location.search` | Event-driven |
| Hash | `window.location.hash` | `""` | Event-driven |
| Route ID | **SvelteKit:** `$page.route.id` / **Next.js:** N/A / **Vue Router:** `route.name` | `"--"` | Event-driven |

### Framework-Specific Notes

- **SvelteKit:** Import `page` from `$app/stores`. Use `$derived` to react to changes.
- **Next.js:** Use hooks from `next/navigation` (App Router) or `next/router` (Pages Router). Detect which router is in use.
- **Vue Router:** Use `useRoute()` from `vue-router` inside `<script setup>`.
- **Plain Vite/Webpack:** Use `window.location` and listen to `popstate` events.

## 4. Backend

Display-only section showing API URLs configured via environment variables. No health checks, no fetch interception.

| Field | Source | Fallback | Frequency |
|-------|--------|----------|-----------|
| API URL(s) | Scan `import.meta.env` (Vite) or `process.env` (Webpack) for known prefixes | `"none configured"` | One-time |

### Environment Variable Patterns

Search for these patterns in the active environment:

| Framework | Prefix | Common Vars |
|-----------|--------|-------------|
| Vite / SvelteKit | `VITE_` | `VITE_API_URL`, `VITE_API_BASE_URL`, `VITE_BACKEND_URL` |
| Next.js | `NEXT_PUBLIC_` | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_BACKEND_URL` |
| CRA | `REACT_APP_` | `REACT_APP_API_URL`, `REACT_APP_BACKEND_URL` |
| Nuxt | `NUXT_PUBLIC_` | `NUXT_PUBLIC_API_URL` |

### Implementation

Iterate over `import.meta.env` (Vite) or the injected env object (Webpack) and filter for keys containing `API`, `BACKEND`, `SERVER`, or `BASE_URL`. Display key-value pairs.

## 5. Storage

Client-side browser storage metrics, polled periodically.

| Field | Source | Fallback | Frequency |
|-------|--------|----------|-----------|
| localStorage size | Sum of `key.length + value.length` for all keys, converted to bytes (UTF-16: `* 2`) | `"N/A"` if blocked | Polled (5s) |
| localStorage key count | `localStorage.length` | `0` | Polled (5s) |
| sessionStorage size | Same approach as localStorage | `"N/A"` if blocked | Polled (5s) |
| sessionStorage key count | `sessionStorage.length` | `0` | Polled (5s) |
| Cookie count | `document.cookie.split(';').filter(Boolean).length` | `0` | Polled (5s) |
| Cookie size | `new Blob([document.cookie]).size` bytes | `0` | Polled (5s) |

### Implementation

```ts
function getStorageSize(storage: Storage): { bytes: number; keys: number } {
  let bytes = 0;
  const keys = storage.length;
  for (let i = 0; i < keys; i++) {
    const key = storage.key(i)!;
    const value = storage.getItem(key)!;
    bytes += (key.length + value.length) * 2; // UTF-16
  }
  return { bytes, keys };
}
```

Wrap in try-catch for browsers with storage access restrictions (incognito, iframe sandboxing).

### Display Format

- Bytes: Format as human-readable (`1.2 KB`, `3.4 MB`)
- Show key count in parentheses: `localStorage: 2.4 KB (12 keys)`

## 6. Performance

Client-side performance metrics from browser APIs.

| Field | Source | Fallback | Frequency |
|-------|--------|----------|-----------|
| JS heap used | `performance.memory?.usedJSHeapSize` | `"N/A"` (Firefox, Safari) | Polled (5s) |
| JS heap total | `performance.memory?.totalJSHeapSize` | `"N/A"` | Polled (5s) |
| DOM node count | `document.querySelectorAll('*').length` | `0` | Polled (5s) |
| Page load time | `performance.getEntriesByType('navigation')[0]?.loadEventEnd - navigationStart` | `"--"` | One-time |
| LCP | `PerformanceObserver` for `largest-contentful-paint` | `"--"` | Event-driven (last value) |
| CLS | `PerformanceObserver` for `layout-shift` (cumulative) | `"--"` | Event-driven (cumulative) |

### Implementation Notes

- `performance.memory` is Chrome-only (non-standard). Show "N/A" on other browsers.
- Use `PerformanceObserver` with `buffered: true` for LCP and CLS to capture entries that fired before observer was created.
- LCP observer should report the last entry's `startTime`.
- CLS should sum all `layout-shift` entries where `hadRecentInput === false`.
- DOM node count uses `document.querySelectorAll('*').length`. This is cheap enough to poll every 5s.
- Format heap sizes as human-readable (`12.4 MB / 32.0 MB`).
- Format times in milliseconds with 1 decimal place.

### Display Format

```
Heap:  12.4 MB / 32.0 MB
DOM:   1,247 nodes
Load:  423.1 ms
LCP:   1,205.3 ms
CLS:   0.012
```

## 7. HMR

Hot Module Replacement connection status and activity.

| Field | Source | Fallback | Frequency |
|-------|--------|----------|-----------|
| Connection status | Vite: `import.meta.hot` existence + WebSocket readyState / Webpack: `module.hot` | `"disconnected"` | Event-driven |
| Last update | Listen to HMR update events, record timestamp | `"--"` | Event-driven |
| Error count | Count HMR errors from `import.meta.hot.on('vite:error')` or Webpack `module.hot` error handler | `0` | Event-driven |
| Full reload count | Count `vite:beforeFullReload` events or Webpack full reload signals | `0` | Event-driven |

### Vite Implementation

```ts
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => {
    lastUpdate = new Date();
  });
  import.meta.hot.on('vite:error', () => {
    errorCount++;
  });
  import.meta.hot.on('vite:beforeFullReload', () => {
    fullReloadCount++;
  });
}
```

### Webpack Implementation

```ts
if (module.hot) {
  module.hot.addStatusHandler((status) => {
    if (status === 'apply') lastUpdate = new Date();
    if (status === 'abort' || status === 'fail') errorCount++;
  });
}
```

### WebSocket State

For Vite, the HMR WebSocket can be accessed to check connection state:
- `WebSocket.CONNECTING` (0) = "connecting" (amber)
- `WebSocket.OPEN` (1) = "connected" (green)
- `WebSocket.CLOSING` (2) = "closing" (amber)
- `WebSocket.CLOSED` (3) = "disconnected" (red)

Detect the WebSocket by finding the connection to `/__vite_hmr` or the Vite HMR path.

### Display Format

```
Status:   connected (green dot)
Last HMR: 2s ago
Errors:   0
Reloads:  0
```

Format "last HMR" as relative time: "Xs ago", "Xm ago", or timestamp if > 1h.
