<!--
  Dev HUD Component -- Svelte 5 (SvelteKit)

  Displays real-time diagnostics in a draggable overlay.
  Only renders in dev mode. Tree-shaken from production builds.

  TEMPLATE: Adapt imports, store references, and env var prefixes for the target project.

  Prerequisites:
  - vite-hud-plugin.ts registered in vite.config.ts
  - virtual:hud-diagnostics type declaration in src/vite-env.d.ts

  Usage in +layout.svelte:
    import { dev } from '$app/environment';
    import DevHud from '$lib/hud/DevHud.svelte';
    {#if dev}
      <DevHud />
    {/if}
-->
<script lang="ts">
  import { dev } from '$app/environment';
  import { page } from '$app/stores';
  // @ts-ignore -- virtual module provided by vite-hud-plugin
  import diagnostics from 'virtual:hud-diagnostics';

  // ---- State ----
  let visible = $state(true);
  let minimized = $state(false);
  let sections = $state<Record<string, boolean>>({
    environment: true,
    server: true,
    routes: true,
    backend: false,
    storage: false,
    performance: false,
    hmr: true
  });

  // Drag state
  let position = $state({ x: -1, y: -1 }); // -1 = use CSS default
  let dragging = $state(false);
  let dragOffset = $state({ x: 0, y: 0 });

  // Live server metrics (polled from /__hud)
  let serverMetrics = $state({ moduleCount: 0, openConnections: 0, errorCount: 0, uptime: 0 });

  // Storage metrics
  let storageMetrics = $state({
    localStorageBytes: 0,
    localStorageKeys: 0,
    sessionStorageBytes: 0,
    sessionStorageKeys: 0,
    cookieCount: 0,
    cookieBytes: 0
  });

  // Performance metrics
  let perfMetrics = $state({
    heapUsed: 0,
    heapTotal: 0,
    heapAvailable: false,
    domNodes: 0,
    loadTime: 0,
    lcp: 0,
    cls: 0
  });

  // HMR state
  let hmrState = $state({
    connected: false,
    lastUpdate: null as Date | null,
    errorCount: 0,
    fullReloadCount: 0
  });

  // ---- Derived ----
  let routeInfo = $derived({
    path: $page.url.pathname,
    params: $page.params,
    query: $page.url.search,
    hash: $page.url.hash,
    routeId: $page.route?.id || '--'
  });

  let backendUrls = $derived.by(() => {
    const urls: Array<{ key: string; value: string }> = [];
    if (import.meta.env) {
      for (const [key, value] of Object.entries(import.meta.env)) {
        if (
          typeof value === 'string' &&
          (key.includes('API') || key.includes('BACKEND') || key.includes('SERVER') || key.includes('BASE_URL')) &&
          !key.startsWith('__')
        ) {
          urls.push({ key, value });
        }
      }
    }
    return urls;
  });

  let serverUrl = $derived(
    `${diagnostics.https ? 'https' : 'http'}://${diagnostics.host}:${diagnostics.port}${diagnostics.base}`
  );

  let hmrRelativeTime = $derived.by(() => {
    if (!hmrState.lastUpdate) return '--';
    const diff = Math.floor((Date.now() - hmrState.lastUpdate.getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return hmrState.lastUpdate.toLocaleTimeString();
  });

  // ---- Helpers ----
  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatMs(ms: number): string {
    return ms > 0 ? `${ms.toFixed(1)} ms` : '--';
  }

  function getStorageSize(storage: Storage): { bytes: number; keys: number } {
    let bytes = 0;
    const keys = storage.length;
    for (let i = 0; i < keys; i++) {
      const key = storage.key(i)!;
      const value = storage.getItem(key)!;
      bytes += (key.length + value.length) * 2;
    }
    return { bytes, keys };
  }

  function toggleSection(name: string) {
    sections[name] = !sections[name];
  }

  // ---- Drag handlers ----
  function onDragStart(e: MouseEvent) {
    dragging = true;
    const el = (e.target as HTMLElement).closest('.hud-container') as HTMLElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onDragMove(e: MouseEvent) {
    if (!dragging) return;
    position = {
      x: Math.max(0, Math.min(window.innerWidth - 320, e.clientX - dragOffset.x)),
      y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragOffset.y))
    };
  }

  function onDragEnd() {
    dragging = false;
  }

  // ---- Effects ----

  // Keyboard toggle
  $effect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'H') {
        e.preventDefault();
        visible = !visible;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Drag listeners (document-level for smooth dragging)
  $effect(() => {
    if (!dragging) return;
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
    return () => {
      window.removeEventListener('mousemove', onDragMove);
      window.removeEventListener('mouseup', onDragEnd);
    };
  });

  // Poll /__hud endpoint
  $effect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/__hud');
        if (res.ok) serverMetrics = await res.json();
      } catch { /* server unavailable */ }
    }, 5000);
    return () => clearInterval(interval);
  });

  // Poll storage metrics
  $effect(() => {
    function update() {
      try {
        const ls = getStorageSize(localStorage);
        const ss = getStorageSize(sessionStorage);
        const cookies = document.cookie.split(';').filter(Boolean);
        storageMetrics = {
          localStorageBytes: ls.bytes,
          localStorageKeys: ls.keys,
          sessionStorageBytes: ss.bytes,
          sessionStorageKeys: ss.keys,
          cookieCount: cookies.length,
          cookieBytes: new Blob([document.cookie]).size
        };
      } catch { /* storage access restricted */ }
    }
    update();
    const interval = setInterval(update, 5000);
    return () => clearInterval(interval);
  });

  // Poll performance metrics
  $effect(() => {
    function update() {
      const mem = (performance as any).memory;
      perfMetrics.heapAvailable = !!mem;
      if (mem) {
        perfMetrics.heapUsed = mem.usedJSHeapSize;
        perfMetrics.heapTotal = mem.totalJSHeapSize;
      }
      perfMetrics.domNodes = document.querySelectorAll('*').length;
    }

    // One-time: page load time
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav) {
      perfMetrics.loadTime = nav.loadEventEnd - nav.startTime;
    }

    // LCP observer
    let lcpObserver: PerformanceObserver | undefined;
    try {
      lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length > 0) {
          perfMetrics.lcp = entries[entries.length - 1].startTime;
        }
      });
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { /* not supported */ }

    // CLS observer
    let clsObserver: PerformanceObserver | undefined;
    let clsValue = 0;
    try {
      clsObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!(entry as any).hadRecentInput) {
            clsValue += (entry as any).value;
            perfMetrics.cls = clsValue;
          }
        }
      });
      clsObserver.observe({ type: 'layout-shift', buffered: true });
    } catch { /* not supported */ }

    update();
    const interval = setInterval(update, 5000);

    return () => {
      clearInterval(interval);
      lcpObserver?.disconnect();
      clsObserver?.disconnect();
    };
  });

  // HMR tracking
  $effect(() => {
    if (import.meta.hot) {
      import.meta.hot.on('vite:beforeUpdate', () => {
        hmrState.lastUpdate = new Date();
      });
      import.meta.hot.on('vite:error', () => {
        hmrState.errorCount++;
      });
      import.meta.hot.on('vite:beforeFullReload', () => {
        hmrState.fullReloadCount++;
      });
      hmrState.connected = true;
    }

    // Check WebSocket state for HMR connection
    const checkWs = () => {
      const ws = (import.meta.hot as any)?._ws || (import.meta.hot as any)?.socket;
      if (ws) {
        hmrState.connected = ws.readyState === WebSocket.OPEN;
      }
    };
    checkWs();
    const interval = setInterval(checkWs, 5000);
    return () => clearInterval(interval);
  });

  // Re-derive HMR relative time periodically (force reactivity)
  let hmrTick = $state(0);
  $effect(() => {
    const interval = setInterval(() => hmrTick++, 1000);
    return () => clearInterval(interval);
  });
</script>

{#if dev && visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="hud-container"
    class:minimized
    style={position.x >= 0 ? `left:${position.x}px;top:${position.y}px;right:auto;bottom:auto;` : ''}
  >
    {#if minimized}
      <button class="hud-pill" onclick={() => (minimized = false)}>
        {diagnostics.framework} :{diagnostics.port}
      </button>
    {:else}
      <!-- Header -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="hud-header" onmousedown={onDragStart}>
        <span class="hud-title">HUD</span>
        <div class="hud-controls">
          <button onclick={() => (minimized = true)} title="Minimize">&#x2013;</button>
          <button onclick={() => (visible = false)} title="Close (Ctrl+Shift+H)">&#x2715;</button>
        </div>
      </div>

      <div class="hud-body">
        <!-- Environment -->
        <div class="hud-section">
          <button class="hud-section-header" onclick={() => toggleSection('environment')}>
            <span class="chevron" class:open={sections.environment}>&#x25B6;</span>
            Environment
          </button>
          {#if sections.environment}
            <div class="hud-section-content">
              <div class="hud-row"><span class="hud-label">Framework</span><span class="hud-value">{diagnostics.framework} {diagnostics.frameworkVersion}</span></div>
              <div class="hud-row"><span class="hud-label">Vite</span><span class="hud-value">{diagnostics.viteVersion}</span></div>
              <div class="hud-row"><span class="hud-label">Runtime</span><span class="hud-value">{diagnostics.runtime} {diagnostics.runtimeVersion}</span></div>
              <div class="hud-row"><span class="hud-label">Node</span><span class="hud-value">{diagnostics.nodeVersion}</span></div>
              <div class="hud-row"><span class="hud-label">Pkg Manager</span><span class="hud-value">{diagnostics.packageManager}</span></div>
            </div>
          {/if}
        </div>

        <!-- Server -->
        <div class="hud-section">
          <button class="hud-section-header" onclick={() => toggleSection('server')}>
            <span class="chevron" class:open={sections.server}>&#x25B6;</span>
            Server
          </button>
          {#if sections.server}
            <div class="hud-section-content">
              <div class="hud-row"><span class="hud-label">URL</span><span class="hud-value">{serverUrl}</span></div>
              <div class="hud-row"><span class="hud-label">HTTPS</span><span class="hud-value">{diagnostics.https ? 'yes' : 'no'}</span></div>
              <div class="hud-row"><span class="hud-label">Modules</span><span class="hud-value">{serverMetrics.moduleCount}</span></div>
              <div class="hud-row"><span class="hud-label">Connections</span><span class="hud-value">{serverMetrics.openConnections}</span></div>
              <div class="hud-row"><span class="hud-label">Errors</span><span class="hud-value" class:error={serverMetrics.errorCount > 0}>{serverMetrics.errorCount}</span></div>
              <div class="hud-row"><span class="hud-label">Uptime</span><span class="hud-value">{serverMetrics.uptime}s</span></div>
              {#if diagnostics.plugins.length > 0}
                <div class="hud-row hud-row-wrap"><span class="hud-label">Plugins</span><span class="hud-value">{diagnostics.plugins.join(', ')}</span></div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Routes -->
        <div class="hud-section">
          <button class="hud-section-header" onclick={() => toggleSection('routes')}>
            <span class="chevron" class:open={sections.routes}>&#x25B6;</span>
            Routes
          </button>
          {#if sections.routes}
            <div class="hud-section-content">
              <div class="hud-row"><span class="hud-label">Path</span><span class="hud-value">{routeInfo.path}</span></div>
              <div class="hud-row"><span class="hud-label">Route ID</span><span class="hud-value">{routeInfo.routeId}</span></div>
              {#if Object.keys(routeInfo.params).length > 0}
                <div class="hud-row hud-row-wrap"><span class="hud-label">Params</span><span class="hud-value">{JSON.stringify(routeInfo.params)}</span></div>
              {/if}
              {#if routeInfo.query}
                <div class="hud-row"><span class="hud-label">Query</span><span class="hud-value">{routeInfo.query}</span></div>
              {/if}
              {#if routeInfo.hash}
                <div class="hud-row"><span class="hud-label">Hash</span><span class="hud-value">{routeInfo.hash}</span></div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Backend -->
        <div class="hud-section">
          <button class="hud-section-header" onclick={() => toggleSection('backend')}>
            <span class="chevron" class:open={sections.backend}>&#x25B6;</span>
            Backend
          </button>
          {#if sections.backend}
            <div class="hud-section-content">
              {#if backendUrls.length === 0}
                <div class="hud-row"><span class="hud-label-muted">No API URLs configured</span></div>
              {:else}
                {#each backendUrls as { key, value }}
                  <div class="hud-row hud-row-wrap"><span class="hud-label">{key}</span><span class="hud-value">{value}</span></div>
                {/each}
              {/if}
            </div>
          {/if}
        </div>

        <!-- Storage -->
        <div class="hud-section">
          <button class="hud-section-header" onclick={() => toggleSection('storage')}>
            <span class="chevron" class:open={sections.storage}>&#x25B6;</span>
            Storage
          </button>
          {#if sections.storage}
            <div class="hud-section-content">
              <div class="hud-row"><span class="hud-label">localStorage</span><span class="hud-value">{formatBytes(storageMetrics.localStorageBytes)} ({storageMetrics.localStorageKeys} keys)</span></div>
              <div class="hud-row"><span class="hud-label">sessionStorage</span><span class="hud-value">{formatBytes(storageMetrics.sessionStorageBytes)} ({storageMetrics.sessionStorageKeys} keys)</span></div>
              <div class="hud-row"><span class="hud-label">Cookies</span><span class="hud-value">{formatBytes(storageMetrics.cookieBytes)} ({storageMetrics.cookieCount})</span></div>
            </div>
          {/if}
        </div>

        <!-- Performance -->
        <div class="hud-section">
          <button class="hud-section-header" onclick={() => toggleSection('performance')}>
            <span class="chevron" class:open={sections.performance}>&#x25B6;</span>
            Performance
          </button>
          {#if sections.performance}
            <div class="hud-section-content">
              {#if perfMetrics.heapAvailable}
                <div class="hud-row"><span class="hud-label">Heap</span><span class="hud-value">{formatBytes(perfMetrics.heapUsed)} / {formatBytes(perfMetrics.heapTotal)}</span></div>
              {:else}
                <div class="hud-row"><span class="hud-label">Heap</span><span class="hud-value hud-label-muted">N/A</span></div>
              {/if}
              <div class="hud-row"><span class="hud-label">DOM Nodes</span><span class="hud-value">{perfMetrics.domNodes.toLocaleString()}</span></div>
              <div class="hud-row"><span class="hud-label">Load</span><span class="hud-value">{formatMs(perfMetrics.loadTime)}</span></div>
              <div class="hud-row"><span class="hud-label">LCP</span><span class="hud-value">{formatMs(perfMetrics.lcp)}</span></div>
              <div class="hud-row"><span class="hud-label">CLS</span><span class="hud-value">{perfMetrics.cls > 0 ? perfMetrics.cls.toFixed(3) : '--'}</span></div>
            </div>
          {/if}
        </div>

        <!-- HMR -->
        <div class="hud-section">
          <button class="hud-section-header" onclick={() => toggleSection('hmr')}>
            <span class="chevron" class:open={sections.hmr}>&#x25B6;</span>
            HMR
          </button>
          {#if sections.hmr}
            <div class="hud-section-content">
              <div class="hud-row">
                <span class="hud-label">Status</span>
                <span class="hud-value">
                  <span class="status-dot" class:green={hmrState.connected} class:red={!hmrState.connected}></span>
                  {hmrState.connected ? 'connected' : 'disconnected'}
                </span>
              </div>
              <div class="hud-row"><span class="hud-label">Last HMR</span><span class="hud-value">{hmrRelativeTime}{hmrTick ? '' : ''}</span></div>
              <div class="hud-row"><span class="hud-label">Errors</span><span class="hud-value" class:error={hmrState.errorCount > 0}>{hmrState.errorCount}</span></div>
              <div class="hud-row"><span class="hud-label">Reloads</span><span class="hud-value">{hmrState.fullReloadCount}</span></div>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .hud-container {
    position: fixed;
    bottom: 16px;
    right: 16px;
    width: 320px;
    max-height: calc(100vh - 32px);
    background: rgba(15, 15, 15, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    font-family: ui-monospace, 'SF Mono', 'Cascadia Code', 'Fira Code', Menlo, monospace;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.85);
    z-index: 99999;
    overflow: hidden;
    user-select: none;
    backdrop-filter: blur(8px);
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
  }

  .hud-container.minimized {
    width: auto;
    max-height: none;
  }

  .hud-pill {
    all: unset;
    display: block;
    padding: 6px 12px;
    cursor: pointer;
    font-family: inherit;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.7);
    white-space: nowrap;
  }
  .hud-pill:hover {
    color: rgba(255, 255, 255, 1);
  }

  .hud-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    cursor: grab;
  }
  .hud-header:active {
    cursor: grabbing;
  }

  .hud-title {
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.5);
  }

  .hud-controls {
    display: flex;
    gap: 8px;
  }
  .hud-controls button {
    all: unset;
    cursor: pointer;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.4);
    line-height: 1;
    padding: 2px;
  }
  .hud-controls button:hover {
    color: rgba(255, 255, 255, 0.9);
  }

  .hud-body {
    overflow-y: auto;
    max-height: calc(100vh - 80px);
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
  }

  .hud-section {
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }
  .hud-section:last-child {
    border-bottom: none;
  }

  .hud-section-header {
    all: unset;
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 12px;
    cursor: pointer;
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.6);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    box-sizing: border-box;
  }
  .hud-section-header:hover {
    color: rgba(255, 255, 255, 0.9);
    background: rgba(255, 255, 255, 0.03);
  }

  .chevron {
    font-size: 8px;
    transition: transform 0.15s ease;
    display: inline-block;
  }
  .chevron.open {
    transform: rotate(90deg);
  }

  .hud-section-content {
    padding: 2px 12px 8px;
  }

  .hud-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 1px 0;
    gap: 8px;
  }
  .hud-row-wrap {
    flex-wrap: wrap;
  }

  .hud-label {
    color: rgba(255, 255, 255, 0.45);
    flex-shrink: 0;
    font-size: 11px;
  }

  .hud-label-muted {
    color: rgba(255, 255, 255, 0.3);
    font-style: italic;
    font-size: 11px;
  }

  .hud-value {
    color: rgba(255, 255, 255, 0.8);
    text-align: right;
    word-break: break-all;
    font-size: 11px;
  }
  .hud-value.error {
    color: #ef4444;
  }

  .status-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    margin-right: 4px;
    vertical-align: middle;
    background: #6b7280;
  }
  .status-dot.green {
    background: #22c55e;
    box-shadow: 0 0 4px rgba(34, 197, 94, 0.5);
  }
  .status-dot.red {
    background: #ef4444;
    box-shadow: 0 0 4px rgba(239, 68, 68, 0.5);
  }
</style>
