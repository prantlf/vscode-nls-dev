/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { readable, through, ThroughStream } from 'event-stream';
import * as https from 'https';
import * as Is from 'is';
import * as path from 'path';
import { ThroughStream as _ThroughStream } from 'through';
import * as xml2js from 'xml2js';
import {
	bundle2keyValuePair, createLocalizedMessages, JavaScriptMessageBundle, KeyInfo, Map, processFile, resolveMessageBundle, removePathPrefix, BundledMetaDataHeader,
	BundledMetaDataFile, SingleMetaDataFile, BundledMetaDataEntry, MetaDataBundler, MessageBundle, PackageJsonMessageBundle
} from './lib';
import File = require('vinyl');
import * as fancyLog from 'fancy-log';
import * as ansiColors from 'ansi-colors';

function log(message: any, ...rest: any[]): void {
	fancyLog(ansiColors.cyan('[i18n]'), message, ...rest);
}

interface FileWithSourceMap extends File {
	sourceMap: any;
}

const NLS_JSON = '.nls.json';
const NLS_METADATA_JSON = '.nls.metadata.json';
const I18N_JSON = '.i18n.json';

export function rewriteLocalizeCalls(): ThroughStream {
	return through(
		function (this: ThroughStream, file: FileWithSourceMap) {
			if (!file.isBuffer()) {
				this.emit('error', `Failed to read file: ${file.relative}`);
				return;
			}
			const buffer: Buffer = file.contents as Buffer;
			const content = buffer.toString('utf8');
			const sourceMap = file.sourceMap;

			const result = processFile(content, undefined, sourceMap);
			let messagesFile: File | undefined;
			let metaDataFile: File | undefined;
			if (result.errors && result.errors.length > 0) {
				result.errors.forEach(error => console.error(`${file.relative}${error}`));
				this.emit('error', `Failed to rewrite file: ${file.path}`);
				return;
			} else {
				if (result.contents) {
					file.contents = Buffer.from(result.contents, 'utf8');
				}
				if (result.sourceMap) {
					file.sourceMap = JSON.parse(result.sourceMap);
				}
				if (result.bundle) {
					let ext = path.extname(file.path);
					let filePath = file.path.substr(0, file.path.length - ext.length);
					messagesFile = new File({
						base: file.base,
						path: filePath + NLS_JSON,
						contents: Buffer.from(JSON.stringify(result.bundle.messages, null, '\t'), 'utf8')
					});
					let metaDataContent: SingleMetaDataFile = Object.assign({}, result.bundle, { filePath: removePathPrefix(filePath, file.base) });
					metaDataFile = new File({
						base: file.base,
						path: filePath + NLS_METADATA_JSON,
						contents: Buffer.from(JSON.stringify(metaDataContent, null, '\t'), 'utf8')
					});
				}
			}
			this.queue(file);
			if (messagesFile) {
				this.queue(messagesFile);
			}
			if (metaDataFile) {
				this.queue(metaDataFile);
			}
		}
	);
}

export function createMetaDataFiles(): ThroughStream {
	return through(
		function (this: ThroughStream, file: FileWithSourceMap) {
			if (!file.isBuffer()) {
				this.emit('error', `Failed to read file: ${file.relative}`);
				return;
			}

			let result = processFile(file.contents.toString('utf8'), undefined, undefined);
			if (result.errors && result.errors.length > 0) {
				result.errors.forEach(error => console.error(`${file.relative}${error}`));
				this.emit('error', `Failed to rewrite file: ${file.path}`);
				return;
			}

			// emit the input file as-is
			this.queue(file);

			// emit nls meta data if available
			if (result.bundle) {
				let ext = path.extname(file.path);
				let filePath = file.path.substr(0, file.path.length - ext.length);
				this.queue(new File({
					base: file.base,
					path: filePath + NLS_JSON,
					contents: Buffer.from(JSON.stringify(result.bundle.messages, null, '\t'), 'utf8')
				}));
				let metaDataContent: SingleMetaDataFile = Object.assign({}, result.bundle, { filePath: removePathPrefix(filePath, file.base) });
				this.queue(new File({
					base: file.base,
					path: filePath + NLS_METADATA_JSON,
					contents: Buffer.from(JSON.stringify(metaDataContent, null, '\t'), 'utf8')
				}));
			}
		}
	);
}

export function bundleMetaDataFiles(id: string, outDir: string): ThroughStream {
	let base: string | undefined = undefined;
	const bundler = new MetaDataBundler(id, outDir);
	return through(function (this: ThroughStream, file: File) {
		const basename = path.basename(file.relative);
		if (basename.length < NLS_METADATA_JSON.length || NLS_METADATA_JSON !== basename.substr(basename.length - NLS_METADATA_JSON.length)) {
			this.queue(file);
			return;
		}
		if (file.isBuffer()) {
			if (!base) {
				base = file.base;
			}
		} else {
			this.emit('error', `Failed to bundle file: ${file.relative}`);
			return;
		}
		if (!base) {
			base = file.base;
		}
		const buffer: Buffer = file.contents as Buffer;
		const json: SingleMetaDataFile = JSON.parse(buffer.toString('utf8'));
		bundler.add(json);
	}, function () {
		if (base) {
			const [header, content] = bundler.bundle();
			this.queue(new File({
				base: base,
				path: path.join(base, 'nls.metadata.header.json'),
				contents: Buffer.from(JSON.stringify(header), 'utf8')
			}));
			this.queue(new File({
				base: base,
				path: path.join(base, 'nls.metadata.json'),
				contents: Buffer.from(JSON.stringify(content), 'utf8')
			}));
		}
		this.queue(null);
	});
}

export interface Language {
	id: string; // language id, e.g. zh-tw, de
	folderName?: string; // language specific folder name, e.g. cht, deu  (optional, if not set, the id is used)
}

export function createAdditionalLanguageFiles(languages: Language[], i18nBaseDir: string, baseDir?: string, logProblems: boolean = true): ThroughStream {
	return through(function (this: ThroughStream, file: File) {
		// Queue the original file again.
		this.queue(file);

		const basename = path.basename(file.relative);
		const isPackageFile = basename === 'package.nls.json';
		const isAffected = isPackageFile || basename.match(/nls.metadata.json$/) !== null;
		if (!isAffected) {
			return;
		}
		const filename = isPackageFile
			? file.relative.substr(0, file.relative.length - '.nls.json'.length)
			: file.relative.substr(0, file.relative.length - NLS_METADATA_JSON.length);
		let json;
		if (file.isBuffer()) {
			const buffer: Buffer = file.contents as Buffer;
			json = JSON.parse(buffer.toString('utf8'));
			const resolvedBundle = resolveMessageBundle(json);
			languages.forEach((language) => {
				const folderName = language.folderName || language.id;
				const result = createLocalizedMessages(filename, resolvedBundle, folderName, i18nBaseDir, baseDir);
				if (result.problems && result.problems.length > 0 && logProblems) {
					result.problems.forEach(problem => log(problem));
				}
				if (result.messages) {
					this.queue(new File({
						base: file.base,
						path: path.join(file.base, filename) + '.nls.' + language.id + '.json',
						contents: Buffer.from(JSON.stringify(result.messages, null, '\t').replace(/\r\n/g, '\n'), 'utf8')
					}));
				}
			});
		} else {
			this.emit('error', `Failed to read component file: ${file.relative}`);
			return;
		}
	});
}

interface ExtensionLanguageBundle {
	[key: string]: string[];
}

export function bundleLanguageFiles(): ThroughStream {
	interface MapValue {
		base: string;
		content: ExtensionLanguageBundle;
	}
	const bundles: Map<MapValue> = Object.create(null);
	function getModuleKey(relativeFile: string): string {
		return relativeFile.match(/(.*)\.nls\.(?:.*\.)?json/)![1].replace(/\\/g, '/');
	}

	return through(function (this: ThroughStream, file: File) {
		const basename = path.basename(file.path);
		const matches = basename.match(/.nls\.(?:(.*)\.)?json/);
		if (!matches || !file.isBuffer()) {
			// Not an nls file.
			this.queue(file);
			return;
		}
		const language = matches[1] ? matches[1] : 'en';
		let bundle = bundles[language];
		if (!bundle) {
			bundle = {
				base: file.base,
				content: Object.create(null)
			};
			bundles[language] = bundle;
		}
		bundle.content[getModuleKey(file.relative)] = JSON.parse((file.contents as Buffer).toString('utf8'));
	}, function () {
		for (const language in bundles) {
			const bundle = bundles[language];
			const languageId = language === 'en' ? '' : `${language}.`;
			const file = new File({
				base: bundle.base,
				path: path.join(bundle.base, `nls.bundle.${languageId}json`),
				contents: Buffer.from(JSON.stringify(bundle.content), 'utf8')
			});
			this.queue(file);
		}
		this.queue(null);
	});
}

export function debug(prefix: string = ''): ThroughStream {
	return through(function (this: ThroughStream, file: File) {
		console.log(`${prefix}In pipe ${file.path}`);
		this.queue(file);
	});
}

/**
 * A stream the creates additional key/value pair files for structured nls files.
 *
 * @param commentSeparator - if provided comments will be joined into one string using
 *  the commentSeparator value. If omitted comments will be includes as a string array.
 */
export function createKeyValuePairFile(commentSeparator: string | undefined = undefined): ThroughStream {
	return through(function (this: ThroughStream, file: File) {
		const basename = path.basename(file.relative);
		if (basename.length < NLS_METADATA_JSON.length || NLS_METADATA_JSON !== basename.substr(basename.length - NLS_METADATA_JSON.length)) {
			this.queue(file);
			return;
		}
		let kvpFile: File | undefined;
		const filename = file.relative.substr(0, file.relative.length - NLS_METADATA_JSON.length);
		if (file.isBuffer()) {
			const buffer: Buffer = file.contents as Buffer;
			const json = JSON.parse(buffer.toString('utf8'));
			if (JavaScriptMessageBundle.is(json)) {
				const resolvedBundle = json as JavaScriptMessageBundle;
				if (resolvedBundle.messages.length !== resolvedBundle.keys.length) {
					this.queue(file);
					return;
				}
				const kvpObject = bundle2keyValuePair(resolvedBundle, commentSeparator);
				kvpFile = new File({
					base: file.base,
					path: path.join(file.base, filename) + I18N_JSON,
					contents: Buffer.from(JSON.stringify(kvpObject, null, '\t'), 'utf8')
				});
			} else {
				this.emit('error', `Not a valid JavaScript message bundle: ${file.relative}`);
				return;
			}
		} else {
			this.emit('error', `Failed to read JavaScript message bundle file: ${file.relative}`);
			return;
		}
		this.queue(file);
		if (kvpFile) {
			this.queue(kvpFile);
		}
	});
}

interface Item {
	id: string;
	message: string;
	comment?: string;
	target?: string;
}

interface PackageJsonMessageFormat {
	message: string;
	comment: string[];
}

interface PackageJsonFormat {
	[key: string]: string | PackageJsonMessageFormat;
}

module PackageJsonFormat {
	export function is(value: any): value is PackageJsonFormat {
		if (Is.undef(value) || !Is.object(value)) {
			return false;
		}
		return Object.keys(value).every(key => {
			let element = value[key];
			return Is.string(element) || (Is.object(element) && Is.defined(element.message) && Is.defined(element.comment));
		});
	}
}

type MessageInfo = string | PackageJsonMessageFormat;

namespace MessageInfo {
	export function message(value: MessageInfo): string {
		return typeof value === 'string' ? value : value.message;
	}
	export function comment(value: MessageInfo): string[] | undefined {
		return typeof value === 'string' ? undefined : value.comment;
	}
}

export class Line {
	private buffer: string[] = [];

	constructor(indent: number = 0) {
		if (indent > 0) {
			this.buffer.push(new Array(indent + 1).join(' '));
		}
	}

	public append(value: string): Line {
		this.buffer.push(value);
		return this;
	}

	public toString(): string {
		return this.buffer.join('');
	}
}

export interface Resource {
	name: string;
	project: string;
}

export interface ParsedXLF {
	messages: Map<string>;
	originalFilePath: string;
	language: string;
}

export class XLF {
	private buffer: string[];
	private files: Map<Item[]>;
	private target?: string;

	constructor(public project: string, target?: string) {
		this.buffer = [];
		this.files = Object.create(null);
		this.target = target;
	}

	public toString(): string {
		this.appendHeader();

		for (const file in this.files) {
			this.appendNewLine(`<file original="${file}" source-language="en" ${this.target ? 'target-language="' + this.target + '" ' : ''}datatype="plaintext"><body>`, 2);
			for (const item of this.files[file]) {
				this.addStringItem(item);
			}
			this.appendNewLine('</body></file>', 2);
		}

		this.appendFooter();
		return this.buffer.join('\r\n');
	}

	public addFile(original: string, keys: KeyInfo[], messages: MessageInfo[]) {
		if (keys.length === 0) {
			return;
		}
		if (keys.length !== messages.length) {
			throw new Error(`Un-matching keys(${keys.length}) and messages(${messages.length}).`);
		}

		this.files[original] = [];
		const existingKeys: Set<string> = new Set();

		for (let i = 0; i < keys.length; i++) {
			const keyInfo = keys[i];
			const key = KeyInfo.key(keyInfo);
			if (existingKeys.has(key)) {
				continue;
			}
			existingKeys.add(key);

			const messageInfo = messages[i];
			const message = encodeEntities(MessageInfo.message(messageInfo));
			const comment: string | undefined = function(comments: string[] | undefined) {
				if (comments === undefined) {
					return undefined;
				}
				return comments.map(comment => encodeEntities(comment)).join(`\r\n`);
			}(KeyInfo.comment(keyInfo) ?? MessageInfo.comment(messageInfo));

			this.files[original].push(comment !== undefined ? { id: key, message: message, comment: comment } : { id: key, message: message });
		}
	}

	public setLanguageBundle(original: string, translation: string[]) {
		const file = this.files[original];
		if (!file) {
			throw new Error(`Un-matching original(${original}).`);
		}
		if (!translation) {
			throw new Error(`Missing target(${original}).`);
		}
		if (file.length !== translation.length) {
			throw new Error(`Mis-matching target(${original}).`);
		}

		for (let i = 0, l = file.length; i < l; ++i) {
			file[i].target = encodeEntities(translation[i]);
		}
	}

	public setLanguagePackage(original: string, translation: PackageJsonMessageBundle) {
		const file = this.files[original];
		if (!file) {
			throw new Error(`Un-matching original(${original}).`);
		}
		if (!translation) {
			throw new Error(`Missing target(${original}).`);
		}
		if (file.length !== Object.keys(translation).length) {
			throw new Error(`Mis-matching target(${original}).`);
		}

		for (const key in translation) {
			const entry = file.find(({ id }) => id === key);
			if (!entry) {
				throw new Error(`Un-matching key(${key}) in original(${original}).`);
			}
			entry.target = encodeEntities(translation[key]);
		}
	}

	private addStringItem(item: Item): void {
		if (!item.id || !item.message) {
			throw new Error('No item ID or value specified.');
		}

		this.appendNewLine(`<trans-unit id="${item.id}">`, 4);
		this.appendNewLine(`<source xml:lang="en">${item.message}</source>`, 6);

		if (item.comment) {
			this.appendNewLine(`<note>${item.comment}</note>`, 6);
		}

		if (item.target) {
			this.appendNewLine(`<target>${item.target}</target>`, 6);
		}

		this.appendNewLine('</trans-unit>', 4);
	}

	private appendHeader(): void {
		this.appendNewLine('<?xml version="1.0" encoding="utf-8"?>', 0);
		this.appendNewLine('<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">', 0);
	}

	private appendFooter(): void {
		this.appendNewLine('</xliff>', 0);
	}

	private appendNewLine(content: string, indent?: number): void {
		const line = new Line(indent);
		line.append(content);
		this.buffer.push(line.toString());
	}

	static parse(xlfString: string, forceLanguage: boolean = true): Promise<ParsedXLF[]> {
		const getValue = function (this: void, target: any): string | undefined {
			if (typeof target === 'string') {
				return target;
			}
			if (typeof target._ === 'string') {
				return target._;
			}
			if (Array.isArray(target) && target.length === 1) {
				const item = target[0];
				if (typeof item === 'string') {
					return item;
				}
				if (typeof item._ === 'string') {
					return item._;
				}
				return target[0]._;
			}
			return undefined;
		};
		return new Promise((resolve, reject) => {
			const parser = new xml2js.Parser();
			const files: { messages: Map<string>, originalFilePath: string, language: string }[] = [];

			parser.parseString(xlfString, function (err: any, result: any) {
				if (err) {
					reject(new Error(`Failed to parse XLIFF string. ${err}`));
				}

				const fileNodes: any[] = result['xliff']['file'];
				if (!fileNodes) {
					reject(new Error('XLIFF file does not contain "xliff" or "file" node(s) required for parsing.'));
				}

				fileNodes.forEach((file) => {
					const originalFilePath = file.$.original;
					if (!originalFilePath) {
						reject(new Error('XLIFF file node does not contain original attribute to determine the original location of the resource file.'));
					}
					const language = file.$['target-language']?.toLowerCase();
					if (forceLanguage && !language) {
						reject(new Error('XLIFF file node does not contain target-language attribute to determine translated language.'));
					}

					const messages: Map<string> = {};
					const transUnits = file.body[0]['trans-unit'];
					if (transUnits) {
						transUnits.forEach((unit: any) => {
							const key = unit.$.id;
							if (forceLanguage && !unit.target) {
								return; // No translation available
							}

							const val = getValue(unit.target || unit.source);
							if (key && val) {
								messages[key] = decodeEntities(val);
							} else if (forceLanguage) {
								reject(new Error('XLIFF file does not contain full localization data. ID or target translation for one of the trans-unit nodes is not present.'));
							}
						});

						files.push({ messages: messages, originalFilePath: originalFilePath, language: language });
					}
				});

				resolve(files);
			});
		});
	}
}

export function createXlfFiles(projectName: string, extensionName: string, language?: Language): ThroughStream {
	const { id: languageId } = language || {};
	let _xlf: XLF;
	let header: BundledMetaDataHeader | undefined;
	let data: BundledMetaDataFile | undefined;
	let packageBundle: PackageJsonMessageBundle, bundle: MessageBundle;
	function getXlf() {
		if (!_xlf) {
			_xlf = new XLF(projectName, languageId);
		}
		return _xlf;
	}
	return through(function (this: ThroughStream, file: File) {
		if (!file.isBuffer()) {
			this.emit('error', `File ${file.path} is not a buffer`);
			return;
		}
		const buffer: Buffer = file.contents as Buffer;
		const basename = path.basename(file.path);
		if (basename === 'package.nls.json') {
			const json: PackageJsonFormat = JSON.parse(buffer.toString('utf8'));
			const keys = Object.keys(json);
			const messages = keys.map((key) => {
				const value = json[key];
				return value === undefined ? `Unknown message for key: ${key}` : value;
			});
			getXlf().addFile('package', keys, messages);
		} else if (languageId && basename === `package.nls.${languageId}.json`) {
			packageBundle = JSON.parse(buffer.toString('utf8'));
		} else if (basename === 'nls.metadata.json') {
			data = JSON.parse(buffer.toString('utf8'));
		} else if (languageId && basename === `nls.bundle.${languageId}.json`) {
			bundle = JSON.parse(buffer.toString('utf8'));
		} else if (basename === 'nls.metadata.header.json') {
			header = JSON.parse(buffer.toString('utf8'));
		} else {
			this.emit('error', new Error(`${file.path} is not a valid nls or meta data file`));
			return;
		}
	}, function (this: ThroughStream) {
		if (language) {
			getXlf().setLanguagePackage('package', packageBundle);
		}
		if (header && data) {
			const outDir = header.outDir;
			for (const module in data) {
				const fileContent: BundledMetaDataEntry = data[module];
				// in the XLF files we only use forward slashes.
				const fileName = module.replace(/\\/g, '/');
				const filePath = path.join(outDir, fileName);
				getXlf().addFile(filePath, fileContent.keys, fileContent.messages);
				if (language) {
					getXlf().setLanguageBundle(filePath, bundle && bundle[fileName]);
				}
			}
		}
		if (_xlf) {
			const xlfFile = new File({
				path: path.join(projectName, `${extensionName}${languageId ? '.' + languageId : ''}.xlf`),
				contents: Buffer.from(_xlf.toString(), 'utf8')
			});
			this.queue(xlfFile);
		}
		this.queue(null);
	});
}

export function pushXlfFiles(apiHostname: string, username: string, password: string, languages?: Language[]): ThroughStream {
	let tryGetPromises: Promise<boolean>[] = [];
	let updateCreatePromises: Promise<any>[] = [];

	return through(function (this: ThroughStream, file: File) {
		const project = path.basename(path.dirname(file.path));
		const fileName = path.basename(file.path);
		const credentials = `${username}:${password}`;
		const language = languages?.find(({ id }) => fileName.endsWith(`.${id}.xlf`));

		if (language) {
			const slug = fileName.substr(0, fileName.length - `.${language.id}.xlf`.length);
			const resource = { project, name: slug };
			updateCreatePromises.push(translateResource(language, file, resource, apiHostname, credentials));
		} else {
			const slug = fileName.substr(0, fileName.length - '.xlf'.length);
			// Check if resource already exists, if not, then create it.
			let promise = tryGetResource(project, slug, apiHostname, credentials);
			tryGetPromises.push(promise);
			promise.then(exists => {
				if (exists) {
					promise = updateResource(project, slug, file, apiHostname, credentials);
				} else {
					promise = createResource(project, slug, file, apiHostname, credentials);
				}
				updateCreatePromises.push(promise);
			});
		}
	}, function () {
		// End the pipe only after all the communication with Transifex API happened
		Promise.all(tryGetPromises).then(() => {
			Promise.all(updateCreatePromises).then(() => {
				this.queue(null);
			}).catch((reason) => { throw new Error(reason); });
		}).catch((reason) => { throw new Error(reason); });
	});
}

function tryGetResource(project: string, slug: string, apiHostname: string, credentials: string): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const options = {
			hostname: apiHostname,
			path: `/api/2/project/${project}/resource/${slug}/?details`,
			auth: credentials,
			method: 'GET'
		};

		const request = https.request(options, (response) => {
			if (response.statusCode === 404) {
				resolve(false);
			} else if (response.statusCode === 200) {
				resolve(true);
			} else {
				reject(`Failed to query resource ${project}/${slug}. Response: ${response.statusCode} ${response.statusMessage}`);
			}
		});
		request.on('error', (err) => {
			reject(`Failed to get ${project}/${slug} on Transifex: ${err}`);
		});

		request.end();
	});
}

function createResource(project: string, slug: string, xlfFile: File, apiHostname: string, credentials: any): Promise<any> {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify({
			'content': xlfFile?.contents?.toString(),
			'name': slug,
			'slug': slug,
			'i18n_type': 'XLIFF'
		});
		const options = {
			hostname: apiHostname,
			// path: `/api/2/project/${project}/resource/${slug}/translation/${transifexLanguageId}?file&mode=onlyreviewed`,

			path: `/api/2/project/${project}/resources`,
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(data)
			},
			auth: credentials,
			method: 'POST'
		};

		let request = https
			.request(options, (res) => {
				if (res.statusCode === 201) {
					log(`Resource ${project}/${slug} successfully created on Transifex.`);
				} else {
					reject(`Something went wrong in the request creating ${slug} in ${project}. ${res.statusCode}`);
				}
			})
			.on('error', (err) => {
				reject(`Failed to create ${project}/${slug} on Transifex: ${err}`);
			})
			.on('close', () => {
				resolve(true);
			});

		request.write(data);
		request.end();
	});
}

/**
 * The following link provides information about how Transifex handles updates of a resource file:
 * https://dev.befoolish.co/tx-docs/public/projects/updating-content#what-happens-when-you-update-files
 */
function updateResource(project: string, slug: string, xlfFile: File, apiHostname: string, credentials: string): Promise<any> {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify({ content: xlfFile?.contents?.toString() });
		const options = {
			hostname: apiHostname,
			path: `/api/2/project/${project}/resource/${slug}/content`,
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(data)
			},
			auth: credentials,
			method: 'PUT'
		};

		let request = https.request(options, (res) => {
			if (res.statusCode === 200) {
				res.setEncoding('utf8');

				let responseBuffer: string = '';
				res.on('data', function (chunk) {
					responseBuffer += chunk;
				});
				res.on('end', () => {
					const response = JSON.parse(responseBuffer);
					log(`Resource ${project}/${slug} successfully updated on Transifex. Strings added: ${response.strings_added}, updated: ${response.strings_updated}, deleted: ${response.strings_delete}`);
					resolve(true);
				});
			} else {
				reject(`Something went wrong in the request updating ${slug} in ${project}. ${res.statusCode}`);
			}
		});
		request.on('error', (err) => {
			reject(`Failed to update ${project}/${slug} on Transifex: ${err}`);
		});

		request.write(data);
		request.end();
	});
}

/**
 * Fetches Xlf files from transifex. Returns a file stream with paths `${project}/${slug}.${language.id}.xlf`
 *
 * @param apiHostname The hostname, e.g. www.transifex.com
 * @param username The user name, e.g. api
 * @param password The password or access token
 * @param language The language used to pull.
 * @param resources The list of resources to fetch
 */
export function pullXlfFiles(apiHostname: string, username: string, password: string, languages: Language | Language[], resources: Resource[]): NodeJS.ReadableStream {
	if (!languages) {
		throw new Error('Transifex projects and languages must be defined to be able to pull translations from Transifex.');
	}
	if (!resources) {
		throw new Error('Transifex projects and resources must be defined to be able to pull translations from Transifex.');
	}

	if (!Array.isArray(languages)) {
		languages = [languages];
	}
	const credentials = `${username}:${password}`;
	let expectedTranslationsCount = languages.length * resources.length;
	let translationsRetrieved = 0, called = false;

	return readable(function (_count, callback) {
		// Mark end of stream when all resources were retrieved
		if (translationsRetrieved === expectedTranslationsCount) {
			this.emit('end');
			return;
		}

		if (!called) {
			called = true;
			const stream = this;

			for (const resource of resources) {
				for (const language of languages as Language[]) {
					retrieveResource(language, resource, apiHostname, credentials)
						.then((file: File) => {
							stream.emit('data', file);
							translationsRetrieved++;
						}).catch(error => { throw new Error(error); });
				}
			}
		}

		callback();
	});
}

function retrieveResource(language: Language, resource: Resource, apiHostname: string, credentials: string): Promise<File> {
	return new Promise<File>((resolve, reject) => {
		const slug = resource.name.replace(/\//g, '_');
		const project = resource.project;
		const transifexLanguageId = language.id;
		const options: https.RequestOptions = {
			hostname: apiHostname,
			path: `/api/2/project/${project}/resource/${slug}/translation/${transifexLanguageId}?file&mode=onlyreviewed`,
			auth: credentials,
			method: 'GET'
		};

		let request = https.request(options, (res) => {
			let xlfBuffer: Buffer[] = [];
			res.on('data', (chunk) => xlfBuffer.push(<Buffer>chunk));
			res.on('end', () => {
				if (res.statusCode === 200) {
					resolve(new File({ contents: Buffer.concat(xlfBuffer), path: `${project}/${slug}.${transifexLanguageId}.xlf` }));
				}
				reject(`${slug} in ${project} returned no data. Response code: ${res.statusCode}.`);
			});
		});
		request.on('error', (err) => {
			reject(`Failed to query resource ${project}/${slug}/${transifexLanguageId} with the following error: ${err}`);
		});
		request.end();
	});
}

function translateResource(language: Language, xlfFile: File, resource: Resource, apiHostname: string, credentials: string): Promise<any> {
	return new Promise((resolve, reject) => {
		const slug = resource.name.replace(/\//g, '_');
		const project = resource.project;
		const transifexLanguageId = language.id;
		const data = JSON.stringify({ content: xlfFile?.contents?.toString() });
		const options: https.RequestOptions = {
			hostname: apiHostname,
			path: `/api/2/project/${project}/resource/${slug}/translation/${transifexLanguageId}`,
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(data)
			},
			auth: credentials,
			method: 'PUT'
		};

		let request = https.request(options, (res) => {
			if (res.statusCode === 200) {
				res.setEncoding('utf8');

				let responseBuffer: string = '';
				res.on('data', function (chunk) {
					responseBuffer += chunk;
				});
				res.on('end', () => {
					const response = JSON.parse(responseBuffer);
					log(`Resource ${project}/${slug}/${transifexLanguageId} successfully updated on Transifex. Strings added: ${response.strings_added}, updated: ${response.strings_updated}, deleted: ${response.strings_delete}`);
					resolve(true);
				});
			} else {
				reject(`Something went wrong in the request updating ${slug} in ${project}. ${res.statusCode}`);
			}
		});
		request.on('error', (err) => {
			reject(`Failed to update resource ${project}/${slug} with the following error: ${err}`);
		});
		request.write(data);
		request.end();
	});
}

export function prepareJsonFiles(languages?: Language[], prolog: string | string[] = ''): ThroughStream {
	let parsePromises: Promise<ParsedXLF[]>[] = [];

	return through(function (this: ThroughStream, xlf: File) {
		let stream = this;
		let parsePromise = XLF.parse(xlf.contents!.toString(), !!(languages && languages.length));
		parsePromises.push(parsePromise);

		parsePromise.then(
			function (resolvedFiles) {
				resolvedFiles.forEach(file => {
					const language = file.language;
					const { folderName } = languages?.find(({ id }) => id === language) || {};
					const translatedFile = createI18nFile(folderName, file.originalFilePath, file.messages, prolog);
					stream.queue(translatedFile);
				});
			}
		);
	}, function () {
		Promise.all(parsePromises)
			.then(() => { this.queue(null); })
			.catch(reason => { throw new Error(reason); });
	});
}

function createI18nFile(folderName: string | undefined, originalFilePath: string, messages: Map<string>, prolog: string | string[]): File {
	const content = (Array.isArray(prolog) ? prolog.join('\n') + '\n' : prolog) +
		JSON.stringify(messages, null, '\t').replace(/\r\n/g, '\n');
	const fileName = `${originalFilePath}.i18n.json`;
	return new File({
		path: folderName ? path.join(folderName, fileName) : fileName,
		contents: Buffer.from(content, 'utf8')
	});
}

function encodeEntities(value: string): string {
	var result: string[] = [];
	for (var i = 0; i < value.length; i++) {
		var ch = value[i];
		switch (ch) {
			case '<':
				result.push('&lt;');
				break;
			case '>':
				result.push('&gt;');
				break;
			case '&':
				result.push('&amp;');
				break;
			case '"':
				result.push('&quot;');
				break;
			case '\'':
				result.push('&#39;');
				break;
			default:
				result.push(ch);
		}
	}
	return result.join('');
}

function decodeEntities(value: string): string {
	return value
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, '\'');
}
