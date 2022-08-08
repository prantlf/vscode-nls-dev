# @prantlf/vscode-nls-dev

[![Latest version](https://img.shields.io/npm/v/@prantlf/vscode-nls-dev)
 ![Dependency status](https://img.shields.io/librariesio/release/npm/@prantlf/vscode-nls-dev)
](https://www.npmjs.com/package/@prantlf/vscode-nls-dev)

The tools automates the extraction of strings to be externalized from TS and JS code. It therefore helps localizing VSCode extensions and language servers written in TS and JS. It also contains helper methods to convert unlocalized JSON to XLIFF format for translations, and back to localized JSON files, with ability to push and pull localizations from Transifex platform.

## JS->JS+JSON

To build the distributable extension including localisation bundles, a sequence of tasks is needed to be called.

1. `ensureMappings()` - if your  do sources are plain JavaScript loaded from the disk and not transpiled output from TypeScript or other language. The task `rewriteLocalizeCalls` requires source map mappings, although the code to process would not need them.
2. `createMetaDataFiles()` - prepare metadata with all English localisable strings and metadata header about your extension.
3. `rewriteLocalizeCalls()` - modify the localisation calls to consume the bundled localisable strings.
4. `createAdditionalLanguageFiles(languages, 'i18n', 'out')` - extract English localisable strings for each source file to a i18n JSON file.
5. `bundleMetaDataFiles(vscodeExtensionId, 'out')` - write out `nls.metadata.json` and `nls.metadata.header.json`.
6. `bundleLanguageFiles()` - write out `nls.bundle.json` and `nls.bundle.<language>.json`.

## JSON->XLIFF->JSON

To perform unlocalized JSON to XLIFF conversion it is required to call `createXlfFiles(projectName, extensionName)` piping your extension/language server directory to it, where `projectName` is the Transifex project name (if such exists) and `extensionName` is the name of your extension/language server. Thereby, XLF files will have a path of `projectName/extensionName.xlf`.

To convert translated XLIFF to localized JSON files `prepareJsonFiles(languages, prolog?)` should be called, piping `.xlf` files to it. It will parse translated XLIFF to JSON files, reconstructed under original file paths, optionally with a prolog prepended.

## Transifex Push and Pull

Updating Transifex with latest unlocalized strings is done via `pushXlfFiles('www.transifex.com', apiName, apiToken)` and `pullXlfFiles('www.transifex.com', apiName, apiToken, languages, resources)` for pulling localizations respectively. When pulling, you have to provide `resources` array with object literals that have `name` and `project` properties. `name` corresponds to the resource name in Transifex and `project` is a project name of your Transifex project where this resource is stored. `languages` argument is an array of strings of culture names to be pulled from Transifex.

## Onboarding Extension to Transifex

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

## Contributing

In lieu of a formal styleguide, take care to maintain the existing coding style.  Add unit tests for any new or changed functionality. Lint and test your code using `npm test`.

## License

Copyright (c) Microsoft Corporation, Ferdinand Prantl

Licensed under the [MIT License].

[MIT License]: http://en.wikipedia.org/wiki/MIT_License
