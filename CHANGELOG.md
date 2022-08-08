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
