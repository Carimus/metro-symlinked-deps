/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const getDevPaths = require('get-dev-paths');
const { mergeConfig: metroMergeConfig } = require('metro-config');
const generateMetroConfigBlacklistRE = require('metro-config/src/defaults/blacklist');
const escapeForRegExp = require('escape-string-regexp');
const chalk = require('chalk');

/**
 * Wraps metro-config's mergeConfig function in order to remove the `symbolicator` field that's
 * improperly added by it and that metro complains about if present.
 *
 * We only remove it if it's empty in case it magically does have some meaning to metro and it's incorrectly
 * complaining about it.
 *
 * @see https://github.com/facebook/metro/issues/452
 *
 * @param args All args are simply forwarded to `metro-config`'s `mergeConfig`.
 * @return {{symbolicator}|*}
 */
function mergeConfig(...args) {
    const mergedConfig = metroMergeConfig(...args);

    // We need to remove the invalid `symbolicator` config key if it's present and empty.
    if (
        mergedConfig.symbolicator &&
        Object.values(mergedConfig.symbolicator).length === 0
    ) {
        delete mergedConfig.symbolicator;
    }

    return mergedConfig;
}

/**
 * Attempt to infer the project root assuming the bundler is being run from
 * the root of the project.
 *
 * @return {string}
 */
function inferProjectRoot() {
    return process.cwd();
}

/**
 * Resolve all detected linked directories to unique absolute paths without a trailing slash.
 *
 * @param {string} projectRoot
 */
function resolveDevPaths(projectRoot) {
    return Array.from(
        new Set(
            getDevPaths(projectRoot)
                .map((linkPath) => {
                    return `${fs.realpathSync(linkPath)}`.replace(/\/+$/, '');
                })
                .filter((absLinkPath) => !!absLinkPath),
        ),
    );
}

/**
 * Generates the matching group that will match the directory and all files within it of dependency that is listed in
 * `blacklistLinkedModules` that appears in the `node_modules` directory of any resolved dev path (i.e. symlinked
 * dependency).
 *
 * Returns null if there are no `resolvedDevPaths` or `blacklistLinkedModules`
 *
 * @param resolvedDevPaths
 * @param blacklistLinkedModules
 * @return {null|RegExp}
 */
function generateBlacklistGroupForLinkedModules(
    resolvedDevPaths = [],
    blacklistLinkedModules = [],
) {
    if (resolvedDevPaths.length > 0 && blacklistLinkedModules.length > 0) {
        const escapedJoinedDevPaths = resolvedDevPaths
            .map(escapeForRegExp)
            .join('|');
        const escapedJoinedModules = blacklistLinkedModules
            .map(escapeForRegExp)
            .join('|');
        const devPathsMatchingGroup = `(${escapedJoinedDevPaths})`;
        const modulesMatchingGroup = `(${escapedJoinedModules})`;
        return new RegExp(
            `(${devPathsMatchingGroup}\\/node_modules\\/${modulesMatchingGroup}(/.*|))`,
        );
    }

    return null;
}

/**
 * Generate a resolver config containing the `blacklistRE` option if there are linked dep node_modules that need
 * to be blacklisted.
 *
 * @param {string[]=} resolvedDevPaths
 * @param {string[]=} blacklistLinkedModules
 * @return {{}|{blacklistRE: RegExp}}
 */
function generateLinkedDependenciesResolverConfig(
    resolvedDevPaths = [],
    blacklistLinkedModules = [],
) {
    const blacklistGroup = generateBlacklistGroupForLinkedModules(
        resolvedDevPaths,
        blacklistLinkedModules,
    );

    if (blacklistGroup) {
        return {
            blacklistRE: generateMetroConfigBlacklistRE([blacklistGroup]),
        };
    }

    return {};
}

/**
 * Generate a list of watchFolders based on linked dependencies found, additional watch folders passed in as an option,
 * and addition watch folders detected in the existing config.
 *
 * @param {string[]} resolvedDevPaths
 * @param {string[]} additionalWatchFolders
 * @param {{watchFolders: string[]}|null} existingProjectConfig
 * @return {string[]}
 */
function generateLinkedDependenciesWatchFolders(
    resolvedDevPaths = [],
    additionalWatchFolders = [],
    existingProjectConfig = null,
) {
    return [
        ...resolvedDevPaths,
        ...additionalWatchFolders,
        ...((existingProjectConfig && existingProjectConfig.watchFolders) ||
            []),
    ];
}

/**
 * Warn the developer about the presence of symlinked dependencies.
 *
 * @param {string[]} resolvedDevPaths
 * @param {string[]} blacklistLinkedModules
 */
function warnDeveloper(resolvedDevPaths = [], blacklistLinkedModules = []) {
    console.warn(
        chalk.yellow(
            'Warning: you have symlinked dependencies in node_modules!\n',
        ),
    );
    console.log(
        'The following directories are symlink destinations of one or more node_modules \n' +
            '(i.e. `yarn link` or `npm link` was used to link in a dependency locally). Metro \n' +
            "bundler doesn't support symlinks so instead we'll manually watch the symlink \n" +
            'destination. Note that if you get errors about name collisions, you need to inform \n' +
            '`@carimus/metro-symlinked-deps` of the colliding module(s) in metro.config.js via the \n' +
            '`blacklistLinkedModules` option passed to `applyConfigForLinkedDependencies`.',
    );
    console.log('\n-   %s\n', resolvedDevPaths.join('\n-   '));

    if (blacklistLinkedModules.length > 0) {
        console.log(
            'Colliding modules that are blacklisted if they show up in the symlinked dependencies:',
        );
        console.log('\n-   %s\n', blacklistLinkedModules.join('\n-   '));
    }
}

function applyConfigForLinkedDependencies(
    projectConfig = {},
    {
        projectRoot = null,
        blacklistLinkedModules = [],
        additionalWatchFolders = [],
        silent = false,
    } = {},
) {
    const realProjectRoot = path.resolve(projectRoot || inferProjectRoot());
    if (!projectRoot && !silent) {
        console.warn(
            chalk.yellow(
                'Warning: `applyConfigForLinkedDependencies` is being called without explicitly \n' +
                    'specifying `projectRoot`. ',
            ) + `It has been inferred as:\n\n${realProjectRoot}\n`,
        );
    }

    // If the developer provided a blacklistRE in their project config, abort early.
    if (
        projectConfig &&
        projectConfig.resolver &&
        projectConfig.resolver.blacklistRE
    ) {
        throw new Error(
            'Refusing to override project-config-specified resolver.blacklistRE config value. ' +
                'Use the `resolveDevPaths`, `generateLinkedDependenciesWatchFolders` and ' +
                '`generateLinkedDependenciesResolverConfig` functions directly instead of' +
                '`applyConfigForLinkedDependencies` OR remove your specified  resolver.blacklistRE value ' +
                "since we can't intelligently merge regular expressions.",
        );
    }

    // Resolve all of the linked dependencies and only continue to modify config if there are any.
    const resolvedDevPaths = resolveDevPaths(realProjectRoot);

    if (resolvedDevPaths.length > 0) {
        if (!silent) {
            // Warn the user about the fact that the workaround is in effect.
            warnDeveloper(resolvedDevPaths, blacklistLinkedModules);
        }

        return mergeConfig(projectConfig, {
            resolver: generateLinkedDependenciesResolverConfig(
                resolvedDevPaths,
                blacklistLinkedModules,
            ),
            watchFolders: generateLinkedDependenciesWatchFolders(
                resolvedDevPaths,
                additionalWatchFolders,
                projectConfig,
            ),
        });
    }

    return projectConfig;
}

module.exports = {
    inferProjectRoot,
    resolveDevPaths,
    generateBlacklistGroupForLinkedModules,
    generateLinkedDependenciesResolverConfig,
    generateLinkedDependenciesWatchFolders,
    warnDeveloper,
    applyConfigForLinkedDependencies,
};
