# frontend-hud

A skill for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and [Codex](https://openai.com/index/introducing-codex/) that generates a dev-mode diagnostic overlay (HUD) for frontend projects. It detects your framework and build tool, then scaffolds a component, build plugin, and layout injection -- all guarded so nothing ships to production.

## Supported Frameworks

| Framework | Build Tool | Component |
|-----------|------------|-----------|
| SvelteKit | Vite | Svelte 5 (runes) |
| React / Next.js (App Router) | Vite or Webpack | React 18+ (`'use client'`) |
| Vue / Nuxt | Vite | Vue 3 (Composition API) |
| CRA | Webpack | React 18+ |
| Plain Vite | Vite | Framework-specific |
| Plain Webpack | Webpack | Framework-specific |

## Usage

```
/frontend-hud            # Detect framework, generate HUD, inject into layout
/frontend-hud remove     # Remove all HUD files and layout injection
/frontend-hud update     # Regenerate component with latest diagnostics spec
```

## What Gets Generated

Three things are added to the project:

1. **Build plugin** -- a Vite or Webpack plugin that exposes build-time diagnostics (framework version, Node version, port, plugins, etc.) and serves a `GET /__hud` endpoint with live server metrics.

2. **HUD component** -- a self-contained overlay component for Svelte, React, or Vue. Renders in the bottom-right corner, draggable, collapsible, keyboard-togglable.

3. **Layout injection** -- a one-line addition to the root layout file, wrapped in a dev-mode guard.

### File Locations

**Vite projects:**

| File | SvelteKit | Other Vite |
|------|-----------|------------|
| Build plugin | `src/lib/hud/vite-hud-plugin.ts` | `src/hud/vite-hud-plugin.ts` |
| Component | `src/lib/hud/DevHud.svelte` | `src/components/hud/DevHud.{tsx,vue}` |

**Webpack projects:**

| File | Path |
|------|------|
| Build plugin | `src/hud/webpack-hud-plugin.ts` |
| Component | `src/components/hud/DevHud.tsx` |

## Diagnostic Sections

The HUD displays seven collapsible sections:

| Section | Data | Update Frequency |
|---------|------|------------------|
| **Environment** | Framework, version, runtime (Node/Bun), package manager | Static (build-time) |
| **Server** | Port, URL, HTTPS, module count, open connections, errors, uptime | Polled every 5s via `/__hud` |
| **Routes** | Current path, route params, query string, hash, route ID | Event-driven (navigation) |
| **Backend** | API URLs from environment variables (display-only, no health checks) | Static (build-time) |
| **Storage** | localStorage/sessionStorage size and key count, cookie count and size | Polled every 5s |
| **Performance** | JS heap (Chrome only), DOM node count, page load time, LCP, CLS | Polled every 5s + PerformanceObserver |
| **HMR** | Connection status, last update timestamp, error count, full reload count | Event-driven |

## Controls

- **Toggle visibility:** `Ctrl+Shift+H` (Mac: `Cmd+Shift+H`)
- **Minimize:** Click the `--` button in the header. Shows a small pill with framework name and port.
- **Drag:** Click and drag the header bar.
- **Collapse sections:** Click any section header.

## Production Safety

The HUD never appears in production builds:

- **Vite:** Component is wrapped in `import.meta.env.DEV` checks. The virtual module exports empty data when `command !== 'serve'`. Dead code is tree-shaken.
- **Webpack:** `DefinePlugin` only injects diagnostics in development mode. The component checks `process.env.NODE_ENV === 'development'`.
- **SvelteKit:** Uses `import { dev } from '$app/environment'` for the layout guard.

## Architecture

### Build Plugin

**Vite (`vite-hud-plugin.ts`):**
- Registers a virtual module `virtual:hud-diagnostics` resolved at `configResolved`.
- Serves `GET /__hud` via `configureServer` middleware, returning live metrics (module count, connections, errors, uptime).

**Webpack (`webpack-hud-plugin.ts`):**
- Injects `__HUD_DIAGNOSTICS__` global via `DefinePlugin`.
- Exports `hudDevServerMiddleware()` for the `/__hud` endpoint, intended for `setupMiddlewares` or CRA's `setupProxy`.

### Component Templates

All templates live in `templates/` and are adapted per project. They are not used directly -- the skill reads the template, customizes import paths and environment variable prefixes, and writes the result to the target project.

| Template | Notes |
|----------|-------|
| `svelte-hud.svelte` | Svelte 5 runes, `$app/stores` for route data |
| `react-hud.tsx` | React hooks, `'use client'` directive for Next.js compatibility |
| `vue-hud.vue` | `<script setup>`, scoped CSS, vue-router integration stubs |

### Diagnostics Reference

`references/diagnostics.md` contains the full specification for all seven diagnostic categories: data sources, fallback behavior, update frequencies, and display formats.
