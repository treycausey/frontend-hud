---
name: frontend-hud
description: >
  Create a dev-mode HUD overlay for frontend projects. Displays real-time
  diagnostics: server status, ports, routes, versions, backend connections,
  performance metrics, and storage usage. Supports SvelteKit, React/Next.js,
  Vue/Nuxt, and plain Vite projects. Also supports Webpack-based setups
  (CRA, older Next.js).
disable-model-invocation: true
---

# Frontend HUD

Generate a dev-mode diagnostic overlay for any frontend project.

## Usage

- `/frontend-hud` -- Detect framework, generate HUD component + build plugin, inject into root layout
- `/frontend-hud remove` -- Remove HUD component, plugin, and layout injection
- `/frontend-hud update` -- Regenerate component with latest diagnostics categories

## Dynamic Context

- Node version: !`node --version`
- Bun version: !`bun --version 2>/dev/null || echo "not installed"`
- Package manager lockfile: !`ls -1 bun.lockb yarn.lock pnpm-lock.yaml package-lock.json 2>/dev/null | head -1`
- Framework: !`cat package.json | jq -r '.dependencies // {} | keys[]' 2>/dev/null | grep -E '^(svelte|react|vue|next|nuxt|@sveltejs)' | head -5`
- Config files: !`ls vite.config.* svelte.config.* next.config.* nuxt.config.* webpack.config.* 2>/dev/null`

## Workflow

### Step 1: Detect

Read `package.json` dependencies and config files to identify:

| Signal | Framework | Build Tool |
|--------|-----------|------------|
| `@sveltejs/kit` in deps + `svelte.config.*` | SvelteKit | Vite |
| `next` in deps + `next.config.*` | Next.js | Webpack or Vite (check `next.config.*` for `experimental.turbo` or Next 13+ app router) |
| `nuxt` in deps + `nuxt.config.*` | Nuxt | Vite |
| `vue` in deps + `vite.config.*` | Vue + Vite | Vite |
| `react` in deps + `vite.config.*` | React + Vite | Vite |
| `react-scripts` in deps | CRA | Webpack |
| `react` in deps + `webpack.config.*` | React + Webpack | Webpack |
| `vite.config.*` only | Plain Vite | Vite |
| `webpack.config.*` only | Plain Webpack | Webpack |

### Step 2: Copy Build Plugin

**Vite projects:** Adapt `templates/vite-hud-plugin.ts` and place in the project source directory:
- SvelteKit: `src/lib/hud/vite-hud-plugin.ts`
- Other Vite: `src/hud/vite-hud-plugin.ts`

**Webpack projects:** Adapt `templates/webpack-hud-plugin.ts` and place in:
- CRA: `src/hud/webpack-hud-plugin.ts` (used via `config-overrides.js` or `craco.config.js`)
- Other Webpack: `src/hud/webpack-hud-plugin.ts`

### Step 3: Register Plugin

**Vite:** Add to `vite.config.ts` (or `.js`/`.mjs`) with a dev-only guard:

```ts
import { hudPlugin } from './src/lib/hud/vite-hud-plugin';

export default defineConfig({
  plugins: [
    // ... existing plugins
    hudPlugin(),  // only activates in dev mode internally
  ],
});
```

For SvelteKit, add to the `vite` key inside `svelte.config.js` or directly in `vite.config.ts`.

**Webpack:** Add to `webpack.config.js` plugins array, or for CRA use `config-overrides.js` / `craco.config.js`.

### Step 4: Copy Component

Select and adapt the appropriate template from `templates/`:

| Framework | Template | Target Path |
|-----------|----------|-------------|
| SvelteKit | `svelte-hud.svelte` | `src/lib/hud/DevHud.svelte` |
| React/Next.js | `react-hud.tsx` | `src/components/hud/DevHud.tsx` (or `src/hud/DevHud.tsx`) |
| Vue/Nuxt | `vue-hud.vue` | `src/components/hud/DevHud.vue` |

Customize for the project:
- Import paths for framework router/stores
- Environment variable prefixes for API URLs (`VITE_`, `NEXT_PUBLIC_`, `REACT_APP_`, `NUXT_`)
- Any project-specific stores or state
- Adjust component naming to match project conventions

### Step 5: Inject into Layout

Add the HUD component to the root layout with a dev-mode guard:

**SvelteKit** (`src/routes/+layout.svelte`):
```svelte
<script>
  import { dev } from '$app/environment';
  import DevHud from '$lib/hud/DevHud.svelte';
</script>

<!-- existing layout content -->

{#if dev}
  <DevHud />
{/if}
```

**Next.js App Router** (`app/layout.tsx`):
```tsx
import { DevHud } from '@/components/hud/DevHud';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        {process.env.NODE_ENV === 'development' && <DevHud />}
      </body>
    </html>
  );
}
```

**Vue/Nuxt** (`App.vue` or `app.vue`):
```vue
<template>
  <!-- existing content -->
  <DevHud v-if="isDev" />
</template>

<script setup>
import DevHud from '@/components/hud/DevHud.vue';
const isDev = import.meta.env.DEV;
</script>
```

### Step 6: Verify

1. Start the dev server
2. Confirm the HUD renders in the bottom-right corner
3. Check all 7 diagnostic sections populate with real data
4. Test keyboard toggle (`Ctrl+Shift+H` / `Cmd+Shift+H`)
5. Test minimize, drag, and section collapse
6. Run `build` command and confirm HUD is NOT present in production output
7. Run existing test suite to confirm no regressions

## Remove Workflow (`/frontend-hud remove`)

1. Remove the HUD component file
2. Remove the build plugin file
3. Remove the plugin import and registration from the build config
4. Remove the HUD component import and usage from the root layout
5. Verify dev server still starts cleanly
6. Run existing tests to confirm no regressions

## Update Workflow (`/frontend-hud update`)

1. Re-read `references/diagnostics.md` for any new diagnostic categories
2. Regenerate the HUD component in place, preserving any project-specific customizations (API URLs, store imports)
3. Regenerate the build plugin if diagnostics schema changed
4. Verify all sections render

## HUD Visual Spec

- **Position:** Fixed, bottom-right, 320px wide
- **Background:** `rgba(15, 15, 15, 0.92)`, 1px solid `rgba(255, 255, 255, 0.1)` border
- **Font:** System monospace, 12px
- **Border radius:** 8px
- **Header:** "HUD" label, minimize button, close button
- **Sections:** Collapsible with chevron toggles
- **Status indicators:** Green dot = healthy, amber = warning, red = error
- **Draggable:** By header bar
- **Keyboard toggle:** `Ctrl+Shift+H` (Mac: `Cmd+Shift+H`)
- **Minimized state:** Small pill showing framework name + port
- **Production guard:** Only renders when `import.meta.env.DEV` is true (Vite) or `process.env.NODE_ENV === 'development'` (Webpack). Tree-shaken from production builds.

## Diagnostic Sections

See `references/diagnostics.md` for the full specification of all 7 sections:

1. **Environment** -- Framework, version, runtime, Node version, package manager
2. **Server** -- Port, URL, base path, HTTPS, active plugins, CLI flags
3. **Routes** -- Current path, route params, query string, hash
4. **Backend** -- API base URL(s) from environment variables (display-only, no health checks)
5. **Storage** -- localStorage size + key count, sessionStorage, cookies (polled every 5s)
6. **Performance** -- JS heap memory, DOM node count, page load time, LCP, CLS
7. **HMR** -- Connection status, last update timestamp, error count

## Templates

All templates are in the `templates/` directory. Claude should read and adapt these rather than generating from scratch:

- `vite-hud-plugin.ts` -- Vite plugin (virtual module + dev middleware)
- `webpack-hud-plugin.ts` -- Webpack plugin (DefinePlugin + Express middleware)
- `svelte-hud.svelte` -- Svelte 5 component (runes, `$app/stores`)
- `react-hud.tsx` -- React 18+ component (hooks, `'use client'`)
- `vue-hud.vue` -- Vue 3 component (Composition API, `<script setup>`)
