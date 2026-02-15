/**
 * Vite HUD Plugin
 *
 * Provides server-side diagnostics to the HUD component via:
 * 1. Virtual module `virtual:hud-diagnostics` -- static build info
 * 2. `/__hud` JSON endpoint -- live server metrics
 *
 * Usage in vite.config.ts:
 *   import { hudPlugin } from './src/lib/hud/vite-hud-plugin';
 *   export default defineConfig({ plugins: [hudPlugin()] });
 *
 * Virtual module resolves in both dev and build (so imports don't break).
 * Server middleware and live metrics only activate in dev mode.
 *
 * TEMPLATE: Adapt paths, framework detection, and version reads for the target project.
 */

import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VIRTUAL_MODULE_ID = 'virtual:hud-diagnostics';
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID;

const EMPTY_DIAGNOSTICS: HudDiagnostics = {
	framework: '',
	frameworkVersion: '',
	viteVersion: '',
	nodeVersion: '',
	runtime: '',
	runtimeVersion: '',
	packageManager: '',
	port: 0,
	host: '',
	https: false,
	base: '/',
	mode: 'production',
	envPrefix: [],
	plugins: [],
	cliFlags: [],
	moduleCount: 0,
	resolvedAliases: {},
};

interface HudDiagnostics {
	framework: string;
	frameworkVersion: string;
	viteVersion: string;
	nodeVersion: string;
	runtime: string;
	runtimeVersion: string;
	packageManager: string;
	port: number;
	host: string;
	https: boolean;
	base: string;
	mode: string;
	envPrefix: string[];
	plugins: string[];
	cliFlags: string[];
	moduleCount: number;
	resolvedAliases: Record<string, string>;
}

function detectFramework(root: string): { name: string; version: string } {
	try {
		const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
		const deps = { ...pkg.dependencies, ...pkg.devDependencies };

		if (deps['@sveltejs/kit']) return { name: 'sveltekit', version: deps['@sveltejs/kit'] };
		if (deps['nuxt']) return { name: 'nuxt', version: deps['nuxt'] };
		if (deps['next']) return { name: 'nextjs', version: deps['next'] };
		if (deps['vue']) return { name: 'vue', version: deps['vue'] };
		if (deps['react']) return { name: 'react', version: deps['react'] };
		return { name: 'vite', version: '--' };
	} catch {
		return { name: 'vite', version: '--' };
	}
}

function detectPackageManager(root: string): string {
	try {
		const files = ['bun.lockb', 'yarn.lock', 'pnpm-lock.yaml', 'package-lock.json'];
		const managers = ['bun', 'yarn', 'pnpm', 'npm'];
		for (let i = 0; i < files.length; i++) {
			try {
				readFileSync(resolve(root, files[i]));
				return managers[i];
			} catch {
				continue;
			}
		}
		return 'npm';
	} catch {
		return 'npm';
	}
}

function detectRuntime(): { runtime: string; version: string } {
	if (process.versions.bun) return { runtime: 'bun', version: process.versions.bun };
	return { runtime: 'node', version: process.version };
}

export function hudPlugin(): Plugin {
	let config: ResolvedConfig;
	let diagnostics: HudDiagnostics;
	let moduleCount = 0;
	let openConnections = 0;
	let errorCount = 0;
	let startTime = Date.now();

	let isServe = false;

	return {
		name: 'vite-hud-plugin',

		configResolved(resolvedConfig) {
			isServe = resolvedConfig.command === 'serve';
			config = resolvedConfig;
			const { name, version } = detectFramework(config.root);
			const { runtime, version: runtimeVersion } = detectRuntime();

			diagnostics = {
				framework: name,
				frameworkVersion: version.replace(/[\^~]/, ''),
				viteVersion: config.env?.VITE_VERSION || '--',
				nodeVersion: process.version,
				runtime,
				runtimeVersion,
				packageManager: detectPackageManager(config.root),
				port: config.server.port || 5173,
				host:
					typeof config.server.host === 'string'
						? config.server.host
						: config.server.host
							? '0.0.0.0'
							: 'localhost',
				https: !!config.server.https,
				base: config.base,
				mode: config.mode,
				envPrefix: Array.isArray(config.envPrefix)
					? config.envPrefix
					: [config.envPrefix || 'VITE_'],
				plugins: config.plugins.map((p) => p.name),
				cliFlags: process.argv.slice(2),
				moduleCount: 0,
				resolvedAliases: Object.fromEntries(
					(config.resolve.alias || [])
						.filter(
							(a): a is { find: string; replacement: string } => typeof a.find === 'string'
						)
						.map((a) => [a.find, a.replacement])
				)
			};
		},

		resolveId(id) {
			if (id === VIRTUAL_MODULE_ID) return RESOLVED_VIRTUAL_MODULE_ID;
		},

		load(id) {
			if (id === RESOLVED_VIRTUAL_MODULE_ID) {
				const data = isServe ? diagnostics : EMPTY_DIAGNOSTICS;
				return `export default ${JSON.stringify(data)};`;
			}
		},

		configureServer(server: ViteDevServer) {
			// Track module count
			const updateModuleCount = () => {
				moduleCount = server.moduleGraph.idToModuleMap.size;
			};

			// Poll module count periodically
			const interval = setInterval(updateModuleCount, 2000);
			server.httpServer?.on('close', () => clearInterval(interval));

			// Track WebSocket connections
			server.ws.on('connection', () => {
				openConnections++;
			});

			// Track errors
			server.ws.on('error', () => {
				errorCount++;
			});

			// Serve /__hud JSON endpoint
			server.middlewares.use((req, res, next) => {
				if (req.url === '/__hud') {
					res.setHeader('Content-Type', 'application/json');
					res.setHeader('Cache-Control', 'no-store');
					res.end(
						JSON.stringify({
							moduleCount,
							openConnections,
							errorCount,
							uptime: Math.floor((Date.now() - startTime) / 1000)
						})
					);
					return;
				}
				next();
			});
		}
	};
}

// Type declaration for virtual module (place in project's src/vite-env.d.ts or similar)
// declare module 'virtual:hud-diagnostics' {
//   const diagnostics: {
//     framework: string;
//     frameworkVersion: string;
//     viteVersion: string;
//     nodeVersion: string;
//     runtime: string;
//     runtimeVersion: string;
//     packageManager: string;
//     port: number;
//     host: string;
//     https: boolean;
//     base: string;
//     mode: string;
//     envPrefix: string[];
//     plugins: string[];
//     cliFlags: string[];
//     moduleCount: number;
//     resolvedAliases: Record<string, string>;
//   };
//   export default diagnostics;
// }
