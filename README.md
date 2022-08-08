# vscode-nls-dev
The tools automates the extraction of strings to be externalized from TS and JS code. It therefore helps localizing VSCode extensions and
language servers written in TS and JS. It also contains helper methods to convert unlocalized JSON to XLIFF format for translations, and back to localized JSON files, with ability to push and pull localizations from Transifex platform.

[![Build Status](https://travis-ci.org/Microsoft/vscode-nls-dev.svg?branch=master)](https://travis-ci.org/Microsoft/vscode-nls-dev)
[![NPM Version](https://img.shields.io/npm/v/vscode-nls-dev.svg)](https://npmjs.org/package/vscode-nls-dev)
[![NPM Downloads](https://img.shields.io/npm/dm/vscode-nls-dev.svg)](https://npmjs.org/package/vscode-nls-dev)

### 4.0.0-next.1

* [Add support for comments in messages (e.g. package.nls.json)](https://github.com/microsoft/vscode-nls-dev/issues/32)
* Remove Transifex support
* General code cleanup. Move to TS 4.3.1 and more stricter type checking.

### 3.3.2

* Merged [allow es imports, update ts and use their helper methods](https://github.com/microsoft/vscode-nls-dev/pull/27)

### 3.0.0

* added support to bundle the strings into a single `nls.bundle(.${locale})?.json` file.
* added support for VS Code language packs.

### 2.1.0:

* Add support to push to and pull from Transifex.

### 2.0.0:

* based on TypeScript 2.0. Since TS changed the shape of the d.ts files for 2.0.x a major version number got introduce to not break existing clients using TypeScript 1.8.x.

### JSON->XLIFF->JSON
To perform unlocalized JSON to XLIFF conversion it is required to call `createXlfFiles(projectName, extensionName)` piping your extension/language server directory to it, where `projectName` is the Transifex project name (if such exists) and `extensionName` is the name of your extension/language server. Thereby, XLF files will have a path of `projectName/extensionName.xlf`.

To convert translated XLIFF to localized JSON files `prepareJsonFiles(languages, prolog?)` should be called, piping `.xlf` files to it. It will parse translated XLIFF to JSON files, reconstructed under original file paths, optionally with a prolog prepended.

### Transifex Push and Pull
Updating Transifex with latest unlocalized strings is done via `pushXlfFiles('www.transifex.com', apiName, apiToken)` and `pullXlfFiles('www.transifex.com', apiName, apiToken, languages, resources)` for pulling localizations respectively. When pulling, you have to provide `resources` array with object literals that have `name` and `project` properties. `name` corresponds to the resource name in Transifex and `project` is a project name of your Transifex project where this resource is stored. `languages` argument is an array of strings of culture names to be pulled from Transifex.


### Onboarding Extension to Transifex
Here is a sample code that adds localization using Transifex. You can copy and use it as a template for your own extension, changing the values to the ones described in the code comments.

```javascript
const gulp = require('gulp');
const del = require('del');
const sourcemaps = require('gulp-sourcemaps');
const { ensureMappings } = require('gulp-sourcemaps-identity');
const nls = require('vscode-nls-dev');

// languages an extension has to be translated to
const languages = [
	{ id: 'ja', folderName: 'jpn' },
	{ id: 'ko', folderName: 'kor' },
	{ id: 'de', folderName: 'deu' },
	{ id: 'fr', folderName: 'fra' },
	{ id: 'es', folderName: 'esn' },
	{ id: 'ru', folderName: 'rus' },
	{ id: 'it', folderName: 'ita' }
];

const transifexApiHostname = 'www.transifex.com';
const transifexApiName = 'api';
// token to talk to Transifex (to obtain it see https://docs.transifex.com/api/introduction#authentication)
const transifexApiToken = process.env.TRANSIFEX_API_TOKEN;
// your project name in Transifex
const transifexProjectName = 'vscode-extensions';
// your resource name in Transifex
const transifexExtensionName = 'vscode-node-debug';
// ID of your VS Code Extension
const vscodeExtensionId = 'ms-vscode.vscode-node-debug';

// clean all build output and translated package.nls.json files
const cleanTask = () => del(['out/**', 'package.nls.*.json']);

// transpile sources to use run-time API of vscode-nls, update English templates
// of localisation bundles and generate translated versions of nls.budnle.json
const sourceTask = () =>
	gulp.src('src/**/*.js')
		.pipe(sourcemaps.init())
		.pipe(ensureMappings())
		.pipe(nls.createMetaDataFiles())
		.pipe(nls.rewriteLocalizeCalls())
		.pipe(nls.createAdditionalLanguageFiles(languages, 'i18n', 'out'))
		.pipe(nls.bundleMetaDataFiles(vscodeExtensionId, 'out'))
		.pipe(nls.bundleLanguageFiles())
		.pipe(sourcemaps.write('../out', {
			includeContent: false,
			sourceRoot: '../src'
		}))
		.pipe(gulp.dest('out'));

// generate translated versions of package.nls.json
const packageTask = () =>
	gulp.src('package.nls.json')
		.pipe(nls.createAdditionalLanguageFiles(languages, 'i18n'))
		.pipe(gulp.dest('.'));

// transpile sources and generate bundles of localised texts
gulp.task('default', gulp.series(cleanTask, sourceTask, packageTask));

// export a XLIFF file from the built English JSON bundles for a future upload
gulp.task('i18n-export', () =>
	gulp.src(['package.nls.json', 'out/nls.metadata.json', 'out/nls.metadata.header.json'])
		.pipe(nls.createXlfFiles(transifexProjectName, transifexExtensionName))
		.pipe(gulp.dest('localization')));

// upload an English XLIFF file to Transifex
gulp.task('transifex-push', () =>
	gulp.src(`localization/${transifexProjectName}/${transifexExtensionName}.xlf`)
		.pipe(nls.pushXlfFiles(transifexApiHostname, transifexApiName, transifexApiToken)));

// download translated XLIFF files from Transifex
gulp.task('transifex-pull', () =>
	return nls.pullXlfFiles(transifexApiHostname, transifexApiName, transifexApiToken,
			languages, [{ name: transifexExtensionName, project: transifexProjectName }])
		.pipe(gulp.dest(`localization`)));

// import translated JSON bundles from XLIFF files from a recent download
gulp.task('i18-import', () =>
	gulp.src(`localization/${transifexProjectName}/${transifexExtensionName}.*.xlf`)
		.pipe(nls.prepareJsonFiles(languages, [
			'/*---------------------------------------------------------------------------------------------',
			' *  Copyright (c) Microsoft Corporation. All rights reserved.',
			' *  Licensed under the MIT License. See License.txt in the project root for license information.',
			' *--------------------------------------------------------------------------------------------*/',
			'// Do not edit this file. It is machine generated.'
		]))
		.pipe(gulp.dest('i18n'))));
```

To push strings for translation to Transifex you call `gulp i18n-export`and `gulp transifex-push` sequentially. This will export i18n folder in JSON format to English XLF files in first gulp task, and push them to Transifex.

To pull and perform the import of latest translations from Transifex to your extension, you need to call `gulp transifex-pull` and `gulp i18n-import` sequentially. This will pull translated XLF files from Transifex in first gulp task, and import them to i18n folder in JSON format.

## LICENSE
[MIT](License.txt)
