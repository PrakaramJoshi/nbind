// This file is part of nbind, copyright (C) 2014-2016 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

// makeModulePathList and findCompiledModule are adapted from the npm module
// "bindings" licensed under the MIT license terms in BINDINGS-LICENSE.

/** Typings for Node.js require(). */

interface NodeRequire {
	(name: string): any;
	(name: 'path'): {
		dirname(path: string): string;
		extname(path: string): string;
		resolve(...paths: string[]): string;
	};
	resolve(name: string): string;
}

/** Node.js require() imports a file or package. */

declare var require: NodeRequire;

const path = require('path'); // tslint:disable-line:no-var-requires

/** Node.js global process information. */

declare var process: {
	cwd: () => string,
	env: { [key: string]: string },
	versions: {
		node: string
	},
	platform: string,
	arch: string
};

/** Compiled C++ binary type and path. */

export interface ModuleSpec {
	type: 'node' | 'emcc';
	ext: string;
	name: string;
	path?: string;
}

/** Any class constructor. */

export type ClassType = { new(...args: any[]): any };

export interface DefaultExportType {
	[ key: string ]: any;

	locateFile?(name: string): string;
	onRuntimeInitialized?(): void;
	ccall?(name: string, returnType?: string, argTypes?: string[], args?: any[]): any;

	_nbind_value?(name: string, proto: ClassType): void;

	NBind?: {
		bind_value(name: string, proto: ClassType): void;
	};
}

export class Binding<ExportType extends DefaultExportType> {
	/** Bind a value type (class with a fromJS method) to an equivalent C++ type. */

	bind(name: string, proto: ClassType ) {
		if(this.lib._nbind_value) { // emcc
			this.lib._nbind_value(name, proto);
		} else if(this.lib.NBind) {
			this.lib.NBind.bind_value(name, proto);
		}
	}

	binary: ModuleSpec;
	/** Exported API of a C++ library compiled for nbind. */
	lib: ExportType;
}

/** Binding currently being initialized. */
let currentBinding: Binding<any>;

/** Called from asm.js during init to get current module. @ignore internal use. */

export function getLib() {
	return(currentBinding.lib);
}

/** Default callback that throws any error given to it. */

function rethrow(err: any, result?: any) {
	if(err) throw(err);
}

/** Make list of possible paths for a single compiled output file name. */

function makeModulePathList(root: string, name: string) {
	return([
		// Binary copied using copyasm
		[ root, name ],

		// node-gyp's linked version in the "build" dir
		[ root, 'build', name ],

		// node-waf and gyp_addon (a.k.a node-gyp)
		[ root, 'build', 'Debug', name ],
		[ root, 'build', 'Release', name ],

		// Debug files, for development (legacy behavior, remove for node v0.9)
		[ root, 'out', 'Debug', name ],
		[ root, 'Debug', name ],

		// Release files, but manually compiled (legacy behavior, remove for node v0.9)
		[ root, 'out', 'Release', name ],
		[ root, 'Release', name ],

		// Legacy from node-waf, node <= 0.4.x
		[ root, 'build', 'default', name ],

		[
			root,
			process.env['NODE_BINDINGS_COMPILED_DIR'] || 'compiled',
			process.versions.node,
			process.platform,
			process.arch,
			name
		]
	]);
}

export type FindCallback = (err: any, result?: ModuleSpec) => any;

function findCompiledModule<ResultType>(
	basePath: string,
	specList: ModuleSpec[],
	callback: FindCallback
) {
	const resolvedList: string[] = [];
	const ext = path.extname(basePath);

	/** If basePath has a known extension, check if it's a loadable module. */

	for(let spec of specList) {
		if(ext == spec.ext) {
			try {
				spec.path = require.resolve(basePath);

				// Stop if a module was found.
				callback(null, spec);
				return(spec);
			} catch(err) {
				resolvedList.push(basePath);
			}
		}
	}

	/** Try all possible subdirectories of basePath. */

	for(let spec of specList) {
		// Check if any possible path contains a loadable module,
		// and store unsuccessful attempts.

		for(let pathParts of makeModulePathList(basePath, spec.name)) {
			const resolvedPath = path.resolve.apply(path, pathParts);

			try {
				spec.path = require.resolve(resolvedPath);
			} catch(err) {
				resolvedList.push(resolvedPath);
				continue;
			}

			// Stop if a module was found.

			callback(null, spec);
			return(spec);
		}
	}

	const err = new Error(
		'Could not locate the bindings file. Tried:\n' +
		resolvedList.join('\n')
	);

	(err as any).tries = resolvedList;

	callback(err);
	return(null);
}

/** Find compiled C++ binary under current working directory. */

export function find(cb?: FindCallback): ModuleSpec;

/** Find compiled C++ binary under given path. */

export function find(basePath: string, cb?: FindCallback): ModuleSpec;

export function find(basePath?: any, cb?: FindCallback) {
	let callback = arguments[arguments.length - 1];
	if(typeof(callback) != 'function') callback = rethrow;

	return(findCompiledModule(
		(basePath != callback && basePath) || process.cwd(), [
			{ ext: '.node', name: 'nbind.node', type: 'node' },
			{ ext: '.js',   name: 'nbind.js',   type: 'emcc' }
		], callback
	));
}

export type InitCallback<ExportType extends DefaultExportType> = (
	err: any,
	result?: Binding<ExportType>
) => any;

/** Initialize compiled C++ binary under current working directory. */

export function init<ExportType extends DefaultExportType>(
	cb?: InitCallback<ExportType>
): Binding<ExportType>;

/** Initialize compiled C++ binary under given path. */

export function init<ExportType extends DefaultExportType>(
	basePath: string,
	cb?: InitCallback<ExportType>
): Binding<ExportType>;

/** Initialize compiled C++ binary under given path and merge its API to given
  * object, which may contain options for Emscripten modules. */

export function init<ExportType extends DefaultExportType>(
	basePath: string,
	lib: ExportType,
	cb?: InitCallback<ExportType>
): Binding<ExportType>;

export function init<ExportType extends DefaultExportType>(
	basePath?: any,
	lib?: ExportType,
	cb?: InitCallback<ExportType>
) {
	let callback = arguments[arguments.length - 1];
	if(typeof(callback) != 'function') callback = rethrow;

	const binding = new Binding<ExportType>();

	find(basePath != callback && basePath, (err: any, binary: ModuleSpec) => {
		if(err) {
			callback(err);
			return;
		}

		binding.binary = binary;
		binding.lib = (lib != callback && lib) || ({} as ExportType);

		if(binary.type == 'emcc') {
			initAsm(binding, callback);
		} else {
			initNode(binding, callback);
		}
	});

	return(binding);
}

/** Initialize asm.js module. */

function initAsm<ExportType extends DefaultExportType>(
	binding: Binding<ExportType>,
	callback: InitCallback<ExportType>
) {
	const lib = binding.lib;

	lib.locateFile = lib.locateFile || function(name: string) {
		return(path.resolve(path.dirname(binding.binary.path), name));
	};

	const runtimeInitialized = lib.onRuntimeInitialized;

	lib.onRuntimeInitialized = function() {
		if(runtimeInitialized) runtimeInitialized.apply(this, arguments);

		try {
			lib.ccall('nbind_init');
		} catch(err) {
			callback(err);
			return;
		}

		callback(null, binding);
	};

	currentBinding = binding;

	// Load the Asm.js module.
	require(binding.binary.path);
}

/** Initialize native Node.js addon. */

function initNode<ExportType extends DefaultExportType>(
	binding: Binding<ExportType>,
	callback: InitCallback<ExportType>
) {
	// Load the compiled addon.
	const lib = require(binding.binary.path);

	if(!lib || typeof(lib) != 'object') {
		callback(new Error('Error loading addon'));
		return;
	}

	Object.keys(lib).forEach(function(key: string) {
		binding.lib[key] = lib[key];
	});

	callback(null, binding);
}
