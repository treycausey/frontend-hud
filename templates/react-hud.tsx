/**
 * Dev HUD Component -- React 18+ (Next.js App Router compatible)
 *
 * Displays real-time diagnostics in a draggable overlay.
 * Only renders in dev mode. Tree-shaken from production builds.
 *
 * TEMPLATE: Adapt imports, router hooks, and env var prefixes for the target project.
 *
 * Prerequisites (Vite):
 *   - vite-hud-plugin.ts registered in vite.config.ts
 *   - virtual:hud-diagnostics type declaration in src/vite-env.d.ts
 *
 * Prerequisites (Webpack/CRA):
 *   - HudWebpackPlugin in webpack config
 *   - __HUD_DIAGNOSTICS__ global type declared
 *
 * Usage in layout:
 *   import { DevHud } from '@/components/hud/DevHud';
 *   {process.env.NODE_ENV === 'development' && <DevHud />}
 */
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ---- Diagnostics source ----
// For Vite: import diagnostics from 'virtual:hud-diagnostics';
// For Webpack: const diagnostics = __HUD_DIAGNOSTICS__;
// TEMPLATE: Uncomment the appropriate line above and remove the fallback below.
const diagnostics = (typeof __HUD_DIAGNOSTICS__ !== 'undefined')
  ? __HUD_DIAGNOSTICS__
  : {
      framework: 'react',
      frameworkVersion: '--',
      viteVersion: '--',
      webpackVersion: '--',
      nodeVersion: '--',
      runtime: 'node',
      runtimeVersion: '--',
      packageManager: 'npm',
      port: 3000,
      host: 'localhost',
      https: false,
      base: '/',
      mode: 'development',
      envPrefix: [] as string[],
      plugins: [] as string[],
      cliFlags: [] as string[],
      moduleCount: 0,
      resolvedAliases: {} as Record<string, string>,
    };

// ---- Router hooks ----
// For Next.js App Router:
// import { usePathname, useSearchParams, useParams } from 'next/navigation';
// For React Router:
// import { useLocation, useParams } from 'react-router-dom';
// TEMPLATE: Uncomment the appropriate import and adapt useRouteInfo() below.

// ---- Types ----
interface ServerMetrics {
  moduleCount: number;
  openConnections: number;
  errorCount: number;
  uptime: number;
}

interface StorageMetrics {
  localStorageBytes: number;
  localStorageKeys: number;
  sessionStorageBytes: number;
  sessionStorageKeys: number;
  cookieCount: number;
  cookieBytes: number;
}

interface PerfMetrics {
  heapUsed: number;
  heapTotal: number;
  heapAvailable: boolean;
  domNodes: number;
  loadTime: number;
  lcp: number;
  cls: number;
}

interface HmrState {
  connected: boolean;
  lastUpdate: Date | null;
  errorCount: number;
  fullReloadCount: number;
}

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

function getRelativeTime(date: Date | null): string {
  if (!date) return '--';
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return date.toLocaleTimeString();
}

function getBackendUrls(): Array<{ key: string; value: string }> {
  const urls: Array<{ key: string; value: string }> = [];
  // Vite
  if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
    for (const [key, value] of Object.entries((import.meta as any).env)) {
      if (
        typeof value === 'string' &&
        (key.includes('API') || key.includes('BACKEND') || key.includes('SERVER') || key.includes('BASE_URL')) &&
        !key.startsWith('__')
      ) {
        urls.push({ key, value });
      }
    }
  }
  // CRA / Webpack
  if (typeof process !== 'undefined' && process.env) {
    for (const [key, value] of Object.entries(process.env)) {
      if (
        typeof value === 'string' &&
        key.startsWith('REACT_APP_') &&
        (key.includes('API') || key.includes('BACKEND') || key.includes('SERVER') || key.includes('BASE_URL'))
      ) {
        urls.push({ key, value });
      }
    }
  }
  return urls;
}

// ---- Hook: route info ----
function useRouteInfo() {
  // TEMPLATE: Replace with framework-specific router hooks.
  // Next.js: const pathname = usePathname(); const searchParams = useSearchParams(); const params = useParams();
  // React Router: const location = useLocation(); const params = useParams();
  const [info, setInfo] = useState({
    path: typeof window !== 'undefined' ? window.location.pathname : '/',
    params: {} as Record<string, string>,
    query: typeof window !== 'undefined' ? window.location.search : '',
    hash: typeof window !== 'undefined' ? window.location.hash : '',
    routeId: '--',
  });

  useEffect(() => {
    const update = () => {
      setInfo({
        path: window.location.pathname,
        params: {},
        query: window.location.search,
        hash: window.location.hash,
        routeId: '--',
      });
    };
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);

  return info;
}

// ---- Styles ----
const styles = {
  container: {
    position: 'fixed' as const,
    bottom: 16,
    right: 16,
    width: 320,
    maxHeight: 'calc(100vh - 32px)',
    background: 'rgba(15, 15, 15, 0.92)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    fontFamily: "ui-monospace, 'SF Mono', 'Cascadia Code', 'Fira Code', Menlo, monospace",
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.85)',
    zIndex: 99999,
    overflow: 'hidden',
    userSelect: 'none' as const,
    backdropFilter: 'blur(8px)',
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.5)',
  },
  pill: {
    all: 'unset' as const,
    display: 'block',
    padding: '6px 12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.7)',
    whiteSpace: 'nowrap' as const,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
    cursor: 'grab',
  },
  title: {
    fontWeight: 600,
    fontSize: 11,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: 'rgba(255, 255, 255, 0.5)',
  },
  controls: {
    display: 'flex',
    gap: 8,
  },
  controlBtn: {
    all: 'unset' as const,
    cursor: 'pointer',
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.4)',
    lineHeight: 1,
    padding: 2,
  },
  body: {
    overflowY: 'auto' as const,
    maxHeight: 'calc(100vh - 80px)',
  },
  section: {
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  },
  sectionHeader: {
    all: 'unset' as const,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    padding: '6px 12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 11,
    fontWeight: 600,
    color: 'rgba(255, 255, 255, 0.6)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    boxSizing: 'border-box' as const,
  },
  sectionContent: {
    padding: '2px 12px 8px',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    padding: '1px 0',
    gap: 8,
  },
  label: {
    color: 'rgba(255, 255, 255, 0.45)',
    flexShrink: 0,
    fontSize: 11,
  },
  value: {
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'right' as const,
    wordBreak: 'break-all' as const,
    fontSize: 11,
  },
  valueError: {
    color: '#ef4444',
  },
  labelMuted: {
    color: 'rgba(255, 255, 255, 0.3)',
    fontStyle: 'italic' as const,
    fontSize: 11,
  },
  dot: (color: 'green' | 'red' | 'amber') => ({
    display: 'inline-block',
    width: 6,
    height: 6,
    borderRadius: '50%',
    marginRight: 4,
    verticalAlign: 'middle',
    background: color === 'green' ? '#22c55e' : color === 'red' ? '#ef4444' : '#f59e0b',
    boxShadow: color === 'green' ? '0 0 4px rgba(34, 197, 94, 0.5)'
      : color === 'red' ? '0 0 4px rgba(239, 68, 68, 0.5)'
      : '0 0 4px rgba(245, 158, 11, 0.5)',
  }),
  chevron: (open: boolean) => ({
    fontSize: 8,
    transition: 'transform 0.15s ease',
    display: 'inline-block',
    transform: open ? 'rotate(90deg)' : 'none',
  }),
};

// ---- Section Component ----
function HudSection({ title, open, onToggle, children }: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={styles.section}>
      <button style={styles.sectionHeader} onClick={onToggle}>
        <span style={styles.chevron(open)}>&#x25B6;</span>
        {title}
      </button>
      {open && <div style={styles.sectionContent}>{children}</div>}
    </div>
  );
}

function HudRow({ label, value, error }: { label: string; value: string | number; error?: boolean }) {
  return (
    <div style={styles.row}>
      <span style={styles.label}>{label}</span>
      <span style={{ ...styles.value, ...(error ? styles.valueError : {}) }}>{value}</span>
    </div>
  );
}

// ---- Main Component ----
export function DevHud() {
  // Guard: only render in development
  if (process.env.NODE_ENV !== 'development') return null;

  const [visible, setVisible] = useState(true);
  const [minimized, setMinimized] = useState(false);
  const [sections, setSections] = useState<Record<string, boolean>>({
    environment: true,
    server: true,
    routes: true,
    backend: false,
    storage: false,
    performance: false,
    hmr: true,
  });
  const [position, setPosition] = useState({ x: -1, y: -1 });
  const [serverMetrics, setServerMetrics] = useState<ServerMetrics>({ moduleCount: 0, openConnections: 0, errorCount: 0, uptime: 0 });
  const [storageMetrics, setStorageMetrics] = useState<StorageMetrics>({ localStorageBytes: 0, localStorageKeys: 0, sessionStorageBytes: 0, sessionStorageKeys: 0, cookieCount: 0, cookieBytes: 0 });
  const [perfMetrics, setPerfMetrics] = useState<PerfMetrics>({ heapUsed: 0, heapTotal: 0, heapAvailable: false, domNodes: 0, loadTime: 0, lcp: 0, cls: 0 });
  const [hmrState, setHmrState] = useState<HmrState>({ connected: false, lastUpdate: null, errorCount: 0, fullReloadCount: 0 });
  const [, setTick] = useState(0); // force re-render for relative times

  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  const routeInfo = useRouteInfo();
  const backendUrls = getBackendUrls();

  const serverUrl = `${diagnostics.https ? 'https' : 'http'}://${diagnostics.host}:${diagnostics.port}${diagnostics.base}`;

  const toggleSection = useCallback((name: string) => {
    setSections(prev => ({ ...prev, [name]: !prev[name] }));
  }, []);

  // Keyboard toggle
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'H') {
        e.preventDefault();
        setVisible(v => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Drag handlers
  const onDragStart = useCallback((e: React.MouseEvent) => {
    draggingRef.current = true;
    const el = (e.target as HTMLElement).closest('[data-hud-container]') as HTMLElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 320, e.clientX - dragOffsetRef.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragOffsetRef.current.y)),
      });
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // Poll /__hud
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/__hud');
        if (res.ok) setServerMetrics(await res.json());
      } catch { /* server unavailable */ }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Poll storage
  useEffect(() => {
    const update = () => {
      try {
        const ls = getStorageSize(localStorage);
        const ss = getStorageSize(sessionStorage);
        const cookies = document.cookie.split(';').filter(Boolean);
        setStorageMetrics({
          localStorageBytes: ls.bytes, localStorageKeys: ls.keys,
          sessionStorageBytes: ss.bytes, sessionStorageKeys: ss.keys,
          cookieCount: cookies.length, cookieBytes: new Blob([document.cookie]).size,
        });
      } catch { /* restricted */ }
    };
    update();
    const interval = setInterval(update, 5000);
    return () => clearInterval(interval);
  }, []);

  // Poll performance
  useEffect(() => {
    const update = () => {
      const mem = (performance as any).memory;
      setPerfMetrics(prev => ({
        ...prev,
        heapAvailable: !!mem,
        heapUsed: mem?.usedJSHeapSize || 0,
        heapTotal: mem?.totalJSHeapSize || 0,
        domNodes: document.querySelectorAll('*').length,
      }));
    };

    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav) {
      setPerfMetrics(prev => ({ ...prev, loadTime: nav.loadEventEnd - nav.startTime }));
    }

    let lcpObserver: PerformanceObserver | undefined;
    try {
      lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length > 0) {
          setPerfMetrics(prev => ({ ...prev, lcp: entries[entries.length - 1].startTime }));
        }
      });
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { /* not supported */ }

    let clsObserver: PerformanceObserver | undefined;
    let clsValue = 0;
    try {
      clsObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!(entry as any).hadRecentInput) {
            clsValue += (entry as any).value;
            setPerfMetrics(prev => ({ ...prev, cls: clsValue }));
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
  }, []);

  // HMR tracking (Vite)
  useEffect(() => {
    if (typeof import.meta !== 'undefined' && (import.meta as any).hot) {
      const hot = (import.meta as any).hot;
      hot.on('vite:beforeUpdate', () => {
        setHmrState(prev => ({ ...prev, lastUpdate: new Date() }));
      });
      hot.on('vite:error', () => {
        setHmrState(prev => ({ ...prev, errorCount: prev.errorCount + 1 }));
      });
      hot.on('vite:beforeFullReload', () => {
        setHmrState(prev => ({ ...prev, fullReloadCount: prev.fullReloadCount + 1 }));
      });
      setHmrState(prev => ({ ...prev, connected: true }));
    }
    // Webpack HMR
    if (typeof module !== 'undefined' && (module as any).hot) {
      (module as any).hot.addStatusHandler((status: string) => {
        if (status === 'apply') setHmrState(prev => ({ ...prev, lastUpdate: new Date() }));
        if (status === 'abort' || status === 'fail') setHmrState(prev => ({ ...prev, errorCount: prev.errorCount + 1 }));
      });
      setHmrState(prev => ({ ...prev, connected: true }));
    }
  }, []);

  // Tick for relative time updates
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!visible) return null;

  const positionStyle = position.x >= 0
    ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' }
    : {};

  return (
    <div data-hud-container style={{ ...styles.container, ...positionStyle }}>
      {minimized ? (
        <button style={styles.pill} onClick={() => setMinimized(false)}>
          {diagnostics.framework} :{diagnostics.port}
        </button>
      ) : (
        <>
          <div style={styles.header} onMouseDown={onDragStart}>
            <span style={styles.title}>HUD</span>
            <div style={styles.controls}>
              <button style={styles.controlBtn} onClick={() => setMinimized(true)} title="Minimize">&#x2013;</button>
              <button style={styles.controlBtn} onClick={() => setVisible(false)} title="Close (Ctrl+Shift+H)">&#x2715;</button>
            </div>
          </div>
          <div style={styles.body}>
            <HudSection title="Environment" open={sections.environment} onToggle={() => toggleSection('environment')}>
              <HudRow label="Framework" value={`${diagnostics.framework} ${diagnostics.frameworkVersion}`} />
              <HudRow label="Build" value={diagnostics.viteVersion || diagnostics.webpackVersion || '--'} />
              <HudRow label="Runtime" value={`${diagnostics.runtime} ${diagnostics.runtimeVersion}`} />
              <HudRow label="Node" value={diagnostics.nodeVersion} />
              <HudRow label="Pkg Manager" value={diagnostics.packageManager} />
            </HudSection>

            <HudSection title="Server" open={sections.server} onToggle={() => toggleSection('server')}>
              <HudRow label="URL" value={serverUrl} />
              <HudRow label="HTTPS" value={diagnostics.https ? 'yes' : 'no'} />
              <HudRow label="Modules" value={serverMetrics.moduleCount} />
              <HudRow label="Connections" value={serverMetrics.openConnections} />
              <HudRow label="Errors" value={serverMetrics.errorCount} error={serverMetrics.errorCount > 0} />
              <HudRow label="Uptime" value={`${serverMetrics.uptime}s`} />
            </HudSection>

            <HudSection title="Routes" open={sections.routes} onToggle={() => toggleSection('routes')}>
              <HudRow label="Path" value={routeInfo.path} />
              <HudRow label="Route ID" value={routeInfo.routeId} />
              {routeInfo.query && <HudRow label="Query" value={routeInfo.query} />}
              {routeInfo.hash && <HudRow label="Hash" value={routeInfo.hash} />}
            </HudSection>

            <HudSection title="Backend" open={sections.backend} onToggle={() => toggleSection('backend')}>
              {backendUrls.length === 0 ? (
                <div style={styles.row}><span style={styles.labelMuted}>No API URLs configured</span></div>
              ) : (
                backendUrls.map(({ key, value }) => <HudRow key={key} label={key} value={value} />)
              )}
            </HudSection>

            <HudSection title="Storage" open={sections.storage} onToggle={() => toggleSection('storage')}>
              <HudRow label="localStorage" value={`${formatBytes(storageMetrics.localStorageBytes)} (${storageMetrics.localStorageKeys} keys)`} />
              <HudRow label="sessionStorage" value={`${formatBytes(storageMetrics.sessionStorageBytes)} (${storageMetrics.sessionStorageKeys} keys)`} />
              <HudRow label="Cookies" value={`${formatBytes(storageMetrics.cookieBytes)} (${storageMetrics.cookieCount})`} />
            </HudSection>

            <HudSection title="Performance" open={sections.performance} onToggle={() => toggleSection('performance')}>
              {perfMetrics.heapAvailable ? (
                <HudRow label="Heap" value={`${formatBytes(perfMetrics.heapUsed)} / ${formatBytes(perfMetrics.heapTotal)}`} />
              ) : (
                <div style={styles.row}><span style={styles.label}>Heap</span><span style={styles.labelMuted}>N/A</span></div>
              )}
              <HudRow label="DOM Nodes" value={perfMetrics.domNodes.toLocaleString()} />
              <HudRow label="Load" value={formatMs(perfMetrics.loadTime)} />
              <HudRow label="LCP" value={formatMs(perfMetrics.lcp)} />
              <HudRow label="CLS" value={perfMetrics.cls > 0 ? perfMetrics.cls.toFixed(3) : '--'} />
            </HudSection>

            <HudSection title="HMR" open={sections.hmr} onToggle={() => toggleSection('hmr')}>
              <div style={styles.row}>
                <span style={styles.label}>Status</span>
                <span style={styles.value}>
                  <span style={styles.dot(hmrState.connected ? 'green' : 'red')} />
                  {hmrState.connected ? 'connected' : 'disconnected'}
                </span>
              </div>
              <HudRow label="Last HMR" value={getRelativeTime(hmrState.lastUpdate)} />
              <HudRow label="Errors" value={hmrState.errorCount} error={hmrState.errorCount > 0} />
              <HudRow label="Reloads" value={hmrState.fullReloadCount} />
            </HudSection>
          </div>
        </>
      )}
    </div>
  );
}

// Global type declaration for Webpack
declare const __HUD_DIAGNOSTICS__: any;
