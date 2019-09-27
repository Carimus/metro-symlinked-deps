const { generateLinkedDependenciesWatchFolders } = require('./');

test('generateLinkedDependenciesWatchFolders properly examines existing project config', () => {
    expect(generateLinkedDependenciesWatchFolders()).toEqual([]);
    expect(generateLinkedDependenciesWatchFolders(['a'])).toEqual(['a']);
    expect(generateLinkedDependenciesWatchFolders([], ['a'])).toEqual(['a']);
    expect(generateLinkedDependenciesWatchFolders(['b'], ['a'])).toEqual([
        'b',
        'a',
    ]);
    expect(generateLinkedDependenciesWatchFolders(['b'], ['a'], {})).toEqual([
        'b',
        'a',
    ]);
    expect(
        generateLinkedDependenciesWatchFolders(['b'], ['a'], {
            watchFolders: [],
        }),
    ).toEqual(['b', 'a']);
    expect(
        generateLinkedDependenciesWatchFolders(['b'], ['a'], {
            watchFolders: ['c'],
        }),
    ).toEqual(['b', 'a', 'c']);
});
