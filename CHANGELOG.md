# 5.0.0 (2022-08-08)

### Bug Fixes

* Complete escaping with HTML entities ([5d6cc57](https://github.com/prantlf/vscode-nls-dev/commit/5d6cc5709ab80da088e8aab705b877552bab4abf))
* Convert XLIFF to JSON files in proper directory and with optional prolog ([8afe7fc](https://github.com/prantlf/vscode-nls-dev/commit/8afe7fcffa84fe85742f3c892b042fd130b9f5ae))
* Fork the project ([9bce113](https://github.com/prantlf/vscode-nls-dev/commit/9bce113d9290799fd2d7cb5d8bfa46501914c92a))
* Upgrade dependencies ([9806618](https://github.com/prantlf/vscode-nls-dev/commit/980661804d8d8dfd779dd7dfa676ea1dc0e90458))

### Features

* Allow converting translated nls.bundle.json files to XLIFF ([dc41b13](https://github.com/prantlf/vscode-nls-dev/commit/dc41b1383bf96f18efb31fb861a1c0b184804f50))
* Re-introduce pushing and pulling to and from Transifex ([f0169c6](https://github.com/prantlf/vscode-nls-dev/commit/f0169c69f6c7882a0893cda8e08b0ad570958ac5))
* Support XLIFF files with and without target language ([46598bf](https://github.com/prantlf/vscode-nls-dev/commit/46598bff43b7200ea0459f8d3cb4f7d66b63fe28))

### BREAKING CHANGES

* The minimum required version of Node.js is 10.13.
* The page was renamed to @prantlf/vscode-nls-dev. See also the breaking change on the interface of `prepareJsonFiles`. Otherwise is the API backwards compatible.
* The Gulp task `prepareJsonFiles` requires the `languages` parameter to process XLIFF files with translations and the `prolog` parameter with the Microsoft copyright text if you want it to behave like it did before. But the translated i18n.json files will be always stored in a directory named according to ISO 639-3 instead of directly in the output directory.

When storing the translated i18n.json files, the directory name used for the target language has to be known. When storing the translated i18n.json files, the parameter `languages` for `prepareJsonFiles` is required. It does not make sense supporting the previous functionality by optionally omitting the language-specific sub-directory, because the run-time package would not work with it.

Not all projects are governed by Microsoft. The prolog for the i18n.json files should be optional.

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
