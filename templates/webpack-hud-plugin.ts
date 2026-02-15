/**
 * Webpack HUD Plugin
 *
 * Provides server-side diagnostics to the HUD component via:
 * 1. DefinePlugin injection of `__HUD_DIAGNOSTICS__` global -- static build info
 * 2. `/__hud` JSON endpoint via dev server middleware -- live server metrics
 *
 * Usage in webpack.config.js:
 *   const { HudWebpackPlugin } = require('./src/hud/webpack-hud-plugin');
 *   module.exports = {
 *     plugins: [new HudWebpackPlugin()],
 *   };
 *
 * For CRA (config-overrides.js / craco.config.js):
 *   const { HudWebpackPlugin } = require('./src/hud/webpack-hud-plugin');
 *   module.exports = {
 *     webpack: (config) => {
 *       config.plugins.push(new HudWebpackPlugin());
 *       return config;
 *     },
 *     devServer: (configFunction) => (proxy, allowedHost) => {
 *       const config = configFunction(proxy, allowedHost);
 *       const { hudDevServerMiddleware } = require('./src/hud/webpack-hud-plugin');
 *       config.setupMiddlewares = (middlewares, devServer) => {
 *         middlewares.unshift(hudDevServerMiddleware());
 *         return middlewares;
 *       };
 *       return config;
 *     },
 *   };
 *
 * TEMPLATE: Adapt framework detection and paths for the target project.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Compiler, WebpackPluginInstance } from 'webpack';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface HudDiagnostics {
	framework: string;
	frameworkVersion: string;
	webpackVersion: string;
	nodeVersion: string;
	runtime: string;
	runtimeVersion: string;
	packageManager: string;
	port: number;
	host: string;
	https: boolean;
	base: string;
	mode: string;
	plugins: string[];
	cliFlags: string[];
}

// ---- Shared state for live metrics ----
let moduleCount = 0;
let errorCount = 0;
const startTime = Date.now();

function detectFramework(root: string): { name: string; version: string } {
	try {
		const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
		const deps = { ...pkg.dependencies, ...pkg.devDependencies };

		if (deps['react-scripts']) return { name: 'cra', version: deps['react-scripts'] };
		if (deps['next']) return { name: 'nextjs', version: deps['next'] };
		if (deps['react']) return { name: 'react', version: deps['react'] };
		if (deps['vue']) return { name: 'vue', version: deps['vue'] };
		return { name: 'webpack', version: '--' };
	} catch {
		return { name: 'webpack', version: '--' };
	}
}

function detectPackageManager(root: string): string {
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
}

function detectRuntime(): { runtime: string; version: string } {
	if (process.versions.bun) return { runtime: 'bun', version: process.versions.bun };
	return { runtime: 'node', version: process.version };
}

export class HudWebpackPlugin implements WebpackPluginInstance {
	apply(compiler: Compiler) {
		// Only apply in development
		if (compiler.options.mode !== 'development') return;

		const root = compiler.context || process.cwd();
		const { name, version } = detectFramework(root);
		const { runtime, version: runtimeVersion } = detectRuntime();
		const webpack = compiler.webpack;

		const diagnostics: HudDiagnostics = {
			framework: name,
			frameworkVersion: version.replace(/[\^~]/, ''),
			webpackVersion: webpack.version || '--',
			nodeVersion: process.version,
			runtime,
			runtimeVersion,
			packageManager: detectPackageManager(root),
			port: parseInt(process.env.PORT || '3000', 10),
			host: process.env.HOST || 'localhost',
			https: false,
			base: compiler.options.output?.publicPath?.toString() || '/',
			mode: 'development',
			plugins: compiler.options.plugins
				?.map((p) => p?.constructor?.name)
				.filter((n): n is string => !!n && n !== 'Object') || [],
			cliFlags: process.argv.slice(2)
		};

		// Try to read devServer config for port/host/https
		const devServer = (compiler.options as any).devServer;
		if (devServer) {
			if (devServer.port) diagnostics.port = devServer.port;
			if (devServer.host) diagnostics.host = devServer.host;
			if (devServer.https) diagnostics.https = true;
		}

		// Inject __HUD_DIAGNOSTICS__ global
		new webpack.DefinePlugin({
			__HUD_DIAGNOSTICS__: JSON.stringify(diagnostics)
		}).apply(compiler);

		// Track module count and errors after each compilation
		compiler.hooks.done.tap('HudWebpackPlugin', (stats) => {
			const info = stats.toJson({ modules: true, errors: true });
			moduleCount = info.modules?.length || 0;
			errorCount = info.errors?.length || 0;
		});
	}
}

/**
 * Express/Connect middleware for the /__hud JSON endpoint.
 * Use with webpack-dev-server's setupMiddlewares or CRA's setupProxy.
 */
export function hudDevServerMiddleware() {
	return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
		if (req.url === '/__hud') {
			res.setHeader('Content-Type', 'application/json');
			res.setHeader('Cache-Control', 'no-store');
			res.end(
				JSON.stringify({
					moduleCount,
					openConnections: 0, // Webpack doesn't expose this easily
					errorCount,
					uptime: Math.floor((Date.now() - startTime) / 1000)
				})
			);
			return;
		}
		next();
	};
}

// Type declaration for the global (place in project's global.d.ts or similar)
// declare const __HUD_DIAGNOSTICS__: {
//   framework: string;
//   frameworkVersion: string;
//   webpackVersion: string;
//   nodeVersion: string;
//   runtime: string;
//   runtimeVersion: string;
//   packageManager: string;
//   port: number;
//   host: string;
//   https: boolean;
//   base: string;
//   mode: string;
//   plugins: string[];
//   cliFlags: string[];
// };
