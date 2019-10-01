# `@carimus/metro-symlinked-deps`

Utilities to customize the [`metro`](https://github.com/facebook/metro) bundler configuration in order to workaround
its lack of support for symlinks.

The primary use case for this package is to support development on react native dependencies using `yarn link` or
`npm link`.

## Motivation

Facebook's [`metro`](https://github.com/facebook/metro) bundler used by React Native
[doesn't support symlinks](https://github.com/facebook/metro/issues/1) which is a huge hindrance in the ability to
share code locally.

It's related and dependent on [this issue with `jest`](https://github.com/facebook/jest/pull/7549) since `metro`
uses `jest-haste-map` internally to track and watch file changes.

The general process for developing on a dependency that is sharing components with the main app would be
to use `yarn link` / `npm link` to symlink the dependency into the app's `node_modules`. Since Metro ignores symlinks
though, it simply doesn't work out of the box with metro. There's mountains of workarounds to this that work to varying
degrees. This is the one that worked for us that we're going to re-use until it's unnecessary.

## Usage

Install as a dev dependency using `npm` or `yarn`:

```shell script
yarn add --dev @carimus/metro-symlinked-deps
```

### Option 1: Automatic

If you don't need greater control of the `resolver.blacklistRE` outside of adding additional paths or expressions to
the list, you can safely use the single `applyConfigForLinkedDependencies` function which will use `metro-config`'s
`mergeConfig` to merge in the configuration updates required for the `resolver.blacklistRE` and `watchFolders`.

1.  Modify your `metro.config.js` (creating it if it doesn't exist, or converting your `metro.config.json` to
    `metro.config.js` if its present) to require and call `applyConfigForLinkedDependencies` on your existing
    configuration:

    ```javascript
    const {
        applyConfigForLinkedDependencies,
    } = require('@carimus/metro-symlinked-deps');

    module.exports = applyConfigForLinkedDependencies(
        {
            /* Your existing configuration, optional */
        },
        {
            /* Options to pass to applyConfigForLinkedDependencies, optional */
        },
    );
    ```

`applyConfigForLinkedDependencies` takes the following options:

-   `projectRoot` (`string`, optional **but recommended**): The root of the metro bundled project. If not provided, it
    will be detected assuming the current `process.cwd()` is the project root. It's recommended to explicitly provide
    this to avoid detection issues.
-   `blacklistLinkedModules` (`string[]`, defaults to `[]`): a list of modules to blacklist/ignore if they show up in
    any linked dependencies' `node_modules`. If you get naming collisions for certain modules, add those modules
    by name here and restart the bundler using `--reset-cache`. A common one is `react-native` which will typically
    show up as a dev dependency in react native packages since it's used in tests.
-   `blacklistDirectories` (`string[]`, defaults to `[]`): a list of absolute or relative (to `projectRoot`) directories
    that should be blacklisted in addition to the directories determined via `blacklistLinkedModules`.
-   `resolveBlacklistDirectoriesSymlinks` (`boolean`, defaults to `true`): whether or not to resolve symlinks when
    processing `blacklistDirectories`.
-   `additionalWatchFolders` (`string[]`, defaults to `[]`): a list of additional absolute paths to watch, merged
    directly into the `watchFolders` option.
-   `resolveAdditionalWatchFoldersSymlinks` (`boolean`, defaults to `true`): whether or not to resolve symlinks when
    processing `additionalWatchFolders`.
-   `resolveNodeModulesAtRoot` (`boolean`, defaults to `false`): Set this to `true` to set up a Proxy for
    `resolver.extraNodeModules` in order to ensure that all modules (even the ones required by linked dependencies or
    any other out-of-root watch folders) will resolve to the project root's `node_modules` directory. This is primarily
    useful if the linked dependencies rely on the presence of peerDependencies installed in the project root.
-   `silent` (`boolean`, defaults to `false`): Set this to `true` to suppress warning output in the bundler that shows
    up when linked dependencies are detected.
-   `debug` (`boolean`, defaults to `false`): Set this to `true` to log out valuable debug information like the final
    merged metro configuration.

#### Example

This setup should work for an out of the box react-native 0.60+ project:

```javascript
const {
    applyConfigForLinkedDependencies,
} = require('@carimus/metro-symlinked-deps');

module.exports = applyConfigForLinkedDependencies(
    {
        transformer: {
            getTransformOptions: async () => ({
                transform: {
                    experimentalImportSupport: false,
                    inlineRequires: false,
                },
            }),
        },
    },
    {
        projectRoot: __dirname,
        blacklistLinkedModules: ['react-native'],
    },
);
```

### Option 2: Manual

TODO

## Caveats

-   At the time of writing the blacklist approach appears to fix the naming collision error however it requires that
    the developer knows which packages are in-common and that they provide that list to this package in order to
    generate the regular expression
-   The naming collision doesn't appear to occur for ALL in-common packages. It's not clear if it also considers
    versions too, though that would make sense.

## How it works

This is a workaround and as such it was built by incrementally addressing errors that show up.

### Error #1: Module not found

Out of the box, if you try to use a symlinked dependency, you get the following error from the bundler when it first
builds the bundle (not on during the transform step):

```
error: bundling failed: Error: Unable to resolve module `your-symlinked-module` from `/path/in/project/that/requires/the/module.js`: Module `your-symlinked-module` does not exist in the Haste module map

This might be related to https://github.com/facebook/react-native/issues/4968
To resolve try the following:
  1. Clear watchman watches: `watchman watch-del-all`.
  2. Delete the `node_modules` folder: `rm -rf node_modules && npm install`.
  3. Reset Metro Bundler cache: `rm -rf /tmp/metro-bundler-cache-*` or `npm start -- --reset-cache`.
  4. Remove haste cache: `rm -rf /tmp/haste-map-react-native-packager-*`.
```

Not extremely helpful but what's happening here is `metro` is just outright ignoring the symlink and as such, your
module is invisible to it.

The workaround here provided by [`aleclarson`](https://github.com/aleclarson) in
[this comment on the `metro` issue](https://github.com/facebook/metro/issues/1#issuecomment-421628147) is to
use his home-grown `get-dev-paths` package which searches `node_modules` for any symlinked dependencies that
are referenced as `dependencies` in your `package.json`, resolve those links to their real dependencies, and then
tell metro to also watch those real directories.

### Error #2: Haste module naming collision

That works great with one important caveat: if your linked dependency has any installed dependencies in its
`node_modules` that are identical to any installed dependencies in the root project, you get the following error
(this error names `react-native` as the common dependency).

```
jest-haste-map: Haste module naming collision: react-native
  The following files share their name; please adjust your hasteImpl:
    * <rootDir>/node_modules/react-native/package.json
    * <rootDir>/../../your-symlinked-module/node_modules/react-native/package.json
```

When your dependency is installed legitimately (and not linked) any common dependencies are automatically deduped
during the install (during `yarn install` or `npm install`) and `metro` (or rather `jest-haste-map`) seems to rely
on this behaviour and can't identify the fact that the two packages are not conflicting with eachother and are
legitimately identical. There's unfortunately no way to tell `metro` this is the case and that it should, as an
example, prefer the version of the code in the root project's `node_modules` so instead we have to manually construct
a blacklist of the in-common packages in the linked dependency, construct a regular expression from that, and
hand that regular expression to the `blacklistRE` option of the metro bundler's `resolver` config.

## TODO

-   [ ] Remove `resolveNodeModulesAtRoot` and replace with `nodeModulesResolutionStrategy` with three options:
    -   `null`: default, don't apply any `extraNodeModules` config
    -   `'peers'`: apply `extraNodeModules` that will automatically detect peer dependencies in linked deps and ensure
        those are resolved in the project root while allowing all other dependencies to resolve naturally.
    -   `'root'`: apply `extraNodeModules` that will force all node modules to resolve in the project root, equivelant
        to `resolveNodeModulesAtRoot` being set to `true` currently.
