'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./tab-url-utils.js');
require('./icon-utils.js');

const {
  matchesHostnameSuffix,
  createAutomaticGroupingRuleOverrides,
  normalizeStoredAutomaticGroupingRuleOverrides,
  getAutomaticLandingPagePatterns,
  isAutomaticLandingPage,
  getAutomaticTabGroupDefinition,
  getAutomaticGroupDisplayTitle,
  analyzeNativeChromeGroups,
  buildAutomaticChromeSyncSnapshot,
  assignAutomaticGroupColor,
} = require('./automatic-tab-groups.js');

test('local grouping overrides serialize only the background-safe declarative subset', () => {
  const snapshot = createAutomaticGroupingRuleOverrides({
    landingPagePatterns: [
      { hostname: 'example.com', pathExact: ['/', '/home', 42] },
      { hostnameEndsWith: '.example.net', pathPrefix: '/start' },
    ],
    customGroups: [{
      hostnameEndsWith: '.github.com',
      pathPrefix: '/orgs/',
      groupKey: 'github-orgs',
      groupLabel: 'GitHub orgs',
    }],
  });

  assert.deepEqual(snapshot, {
    version: 1,
    backgroundSafe: true,
    landingPagePatterns: [
      { hostname: 'example.com', pathExact: ['/', '/home'] },
      { hostnameEndsWith: '.example.net', pathPrefix: '/start' },
    ],
    customGroups: [{
      hostnameEndsWith: '.github.com',
      groupKey: 'github-orgs',
      groupLabel: 'GitHub orgs',
      pathPrefix: '/orgs/',
    }],
  });
  assert.deepEqual(normalizeStoredAutomaticGroupingRuleOverrides(snapshot), snapshot);
});

test('function-based local landing rules make background grouping fail closed', () => {
  const snapshot = createAutomaticGroupingRuleOverrides({
    landingPagePatterns: [{
      hostname: 'mail.example.com',
      test: (_pathname, href) => href.includes('#quiet'),
    }],
    customGroups: [],
  });

  assert.equal(snapshot.backgroundSafe, false);
  assert.deepEqual(snapshot.landingPagePatterns, [{ hostname: 'mail.example.com' }]);
  assert.equal(JSON.stringify(snapshot).includes('quiet'), false);
  assert.equal(normalizeStoredAutomaticGroupingRuleOverrides(null), null);
  assert.equal(normalizeStoredAutomaticGroupingRuleOverrides({ ...snapshot, version: 2 }), null);
});

test('hostnameEndsWith matches domain-label boundaries instead of raw string suffixes', () => {
  assert.equal(matchesHostnameSuffix('github.com', 'github.com'), true);
  assert.equal(matchesHostnameSuffix('www.github.com', 'github.com'), true);
  assert.equal(matchesHostnameSuffix('api.docs.github.com', '.github.com'), true);
  assert.equal(matchesHostnameSuffix('hellogithub.com', 'github.com'), false);
  assert.equal(matchesHostnameSuffix('notgithub.com', '.github.com'), false);
  assert.equal(matchesHostnameSuffix('github.com.', 'GITHUB.COM'), true);
  assert.equal(matchesHostnameSuffix('github.com', ''), false);

  const landingPatterns = getAutomaticLandingPagePatterns([
    { hostnameEndsWith: 'github.com', pathPrefix: '/start' },
  ]);
  assert.equal(isAutomaticLandingPage('https://github.com/start', landingPatterns), true);
  assert.equal(isAutomaticLandingPage('https://docs.github.com/start/here', landingPatterns), true);
  assert.equal(isAutomaticLandingPage('https://hellogithub.com/start', landingPatterns), false);

  const customGroups = [{
    hostnameEndsWith: 'github.com',
    groupKey: 'github-family',
    groupLabel: 'GitHub family',
  }];
  assert.equal(
    getAutomaticTabGroupDefinition({ url: 'https://docs.github.com/project' }, { customGroups }).groupKey,
    'github-family',
  );
  assert.equal(
    getAutomaticTabGroupDefinition({ url: 'https://hellogithub.com/project' }, { customGroups }).groupKey,
    'hellogithub.com',
  );

  const runtimeSource = fs.readFileSync(path.join(__dirname, 'dashboard-runtime.js'), 'utf8');
  assert.match(runtimeSource, /function matchesAutomaticHostnameSuffix\(hostname = '', suffix = ''\)/);
  assert.match(runtimeSource, /matchesAutomaticHostnameSuffix\(parsed\.hostname, pattern\.hostnameEndsWith\)/);
  assert.match(runtimeSource, /matchesAutomaticHostnameSuffix\(parsed\.hostname, rule\.hostnameEndsWith\)/);
  assert.doesNotMatch(runtimeSource, /parsed\.hostname\.endsWith\((?:pattern|rule)\.hostnameEndsWith\)/);
});

test('dashboard loads automatic grouping after its worker-safe URL and icon dependencies', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const urlUtilsIndex = html.indexOf('<script src="tab-url-utils.js"></script>');
  const iconUtilsIndex = html.indexOf('<script src="icon-utils.js"></script>');
  const automaticIndex = html.indexOf('<script src="automatic-tab-groups.js"></script>');
  const dashboardIndex = html.indexOf('<script src="dashboard-runtime.js"></script>');

  assert.ok(urlUtilsIndex >= 0 && iconUtilsIndex >= 0 && automaticIndex >= 0 && dashboardIndex >= 0);
  assert.ok(urlUtilsIndex < automaticIndex);
  assert.ok(iconUtilsIndex < automaticIndex);
  assert.ok(automaticIndex < dashboardIndex);
});

test('dashboard publishes local grouping rules before native Chrome sync can run', () => {
  const runtimeSource = fs.readFileSync(path.join(__dirname, 'dashboard-runtime.js'), 'utf8');
  const publishCall = runtimeSource.indexOf(
    'automaticGroupingRuleOverridesPublished = await publishAutomaticGroupingRuleOverrides()',
  );
  const settingLoad = runtimeSource.indexOf('chromeTabGroupsEnabled = await loadChromeTabGroupsSetting()');

  assert.ok(publishCall >= 0, 'dashboard must publish config.local grouping rules');
  assert.ok(settingLoad > publishCall, 'rule publication must finish before native group sync is enabled');
  assert.match(
    runtimeSource,
    /dashboardWindowId != null && automaticGroupingRuleOverridesPublished &&/,
  );
  assert.match(runtimeSource, /AUTOMATIC_GROUPING_RULE_OVERRIDES_KEY = 'automaticTabGroupRuleOverrides'/);
});

test('automatic definitions share canonical URLs, landing rules, custom rules, and domain naming', () => {
  const extras = [{ hostname: 'example.net', pathPrefix: '/start' }];
  assert.equal(getAutomaticLandingPagePatterns(extras).at(-1), extras[0]);
  assert.equal(isAutomaticLandingPage('https://github.com/', getAutomaticLandingPagePatterns()), true);
  assert.equal(isAutomaticLandingPage('https://github.com/openai', getAutomaticLandingPagePatterns()), false);

  assert.deepEqual(
    getAutomaticTabGroupDefinition({ url: 'https://example.net/start/here' }, { landingPagePatterns: extras }),
    { groupKey: '__landing-pages__', label: '' },
  );
  assert.deepEqual(
    getAutomaticTabGroupDefinition({ url: 'https://docs.example.net/a' }, {
      customGroups: [{ hostnameEndsWith: '.example.net', groupKey: 'example-docs', groupLabel: 'Example Docs' }],
    }),
    { groupKey: 'example-docs', label: 'Example Docs' },
  );
  assert.deepEqual(
    getAutomaticTabGroupDefinition({
      url: 'chrome-extension://abc/suspended.html#uri=https%3A%2F%2Ffoo.example.co.uk%2Fstory',
    }),
    { groupKey: 'example.co.uk', label: '' },
  );
  assert.deepEqual(
    getAutomaticTabGroupDefinition({ url: 'file:///tmp/notes.txt' }),
    { groupKey: 'local-files', label: '' },
  );
  assert.equal(getAutomaticTabGroupDefinition({ url: 'chrome://settings/' }), null);
});

// @lat: [[tests#Chrome 标签组验收#规范化主域名键]]
test('different primary domains stay isolated even when one name is a suffix of the other', () => {
  const helloGitHub = getAutomaticTabGroupDefinition({
    url: 'https://hellogithub.com/repository/JOYCEQL/magic-resume',
  });
  const helloGitHubSubdomain = getAutomaticTabGroupDefinition({
    url: 'https://www.hellogithub.com/article/1',
  });
  const gitHub = getAutomaticTabGroupDefinition({
    url: 'https://github.com/JOYCEQL/magic-resume',
  });

  assert.equal(helloGitHub.groupKey, 'hellogithub.com');
  assert.equal(helloGitHubSubdomain.groupKey, 'hellogithub.com');
  assert.equal(gitHub.groupKey, 'github.com');
  assert.notEqual(helloGitHub.groupKey, gitHub.groupKey);

  const snapshot = buildAutomaticChromeSyncSnapshot({
    windowId: 9,
    tabs: [
      { id: 91, windowId: 9, index: 0, groupId: -1, url: 'https://hellogithub.com/article/1' },
      { id: 92, windowId: 9, index: 1, groupId: -1, url: 'https://github.com/JOYCEQL/magic-resume' },
    ],
    nativeGroups: [],
    labelOverrides: {
      'hellogithub.com': 'Code',
      'github.com': 'Code',
    },
  });

  assert.deepEqual(snapshot.groups.map(group => [group.groupKey, group.tabIds]), [
    ['hellogithub.com', [91]],
    ['github.com', [92]],
  ]);
});

test('automatic titles and colors preserve the dashboard naming contract', () => {
  assert.equal(getAutomaticGroupDisplayTitle(
    { groupKey: 'github.com', label: '' },
    { labelOverrides: { 'github.com': 'Code' } },
  ), 'Code');
  assert.equal(getAutomaticGroupDisplayTitle(
    { groupKey: '__landing-pages__' },
    { homepagesLabel: '主页' },
  ), '主页');
  assert.equal(getAutomaticGroupDisplayTitle({ groupKey: 'github.com' }), 'GitHub');
  assert.equal(assignAutomaticGroupColor('__landing-pages__', 4), 'yellow');
  assert.deepEqual(
    Array.from({ length: 8 }, (_, index) => assignAutomaticGroupColor('example.com', index)),
    ['grey', 'red', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'],
  );
});

test('snapshot reproduces automatic eligibility and stored per-group tab order', () => {
  const tabs = [
    { id: 1, windowId: 7, index: 0, groupId: -1, pinned: false, url: 'https://example.com/a' },
    { id: 2, windowId: 7, index: 1, groupId: -1, pinned: true, url: 'https://example.com/pinned' },
    { id: 3, windowId: 7, index: 2, groupId: -1, pinned: false, url: 'https://example.com/manual' },
    { id: 4, windowId: 7, index: 3, groupId: 20, pinned: false, url: 'https://example.com/native' },
    { id: 5, windowId: 7, index: 4, groupId: 10, pinned: false, url: 'https://example.com/b' },
    { id: 99, windowId: 8, index: 0, groupId: -1, pinned: false, url: 'https://example.com/other-window' },
    { id: 100, windowId: 7, index: 5, groupId: -1, pinned: false, url: 'chrome://settings/' },
  ];
  const nativeGroups = [
    { id: 10, windowId: 7, title: 'Example', shared: false, queryComplete: true, minIndex: 4, tabIds: [5], mappings: [] },
    { id: 20, windowId: 7, title: 'Personal', shared: false, queryComplete: true, minIndex: 3, tabIds: [4], mappings: [] },
  ];

  const snapshot = buildAutomaticChromeSyncSnapshot({
    windowId: 7,
    tabs,
    nativeGroups,
    sessionGroups: { groups: [{ id: 'manual' }], assignments: { 3: 'manual' } },
    labelOverrides: { 'example.com': 'Example' },
    groupTabOrder: { 'example.com': ['5', 'https://example.com/a'] },
    landingPagePatterns: [],
    customGroups: [],
    homepagesLabel: 'Homepages',
  });

  assert.equal(snapshot.windowId, 7);
  assert.deepEqual(snapshot.preserveGroupKeys, []);
  assert.deepEqual(snapshot.groups, [{
    groupKey: 'example.com',
    title: 'Example',
    color: 'grey',
    collapsed: true,
    tabIds: [5, 1],
  }]);
  assert.deepEqual([...snapshot.analysis.uniqueCandidateGroupIds], [10]);
  assert.equal(snapshot.analysis.allCandidateGroupIds.has(20), false);
});

test('native analysis exposes ambiguous candidates and freezes unsafe mapped keys', () => {
  const tabs = [
    { id: 1, windowId: 2, index: 1, groupId: 11, url: 'https://example.com/a' },
    { id: 2, windowId: 2, index: 5, groupId: 12, url: 'https://example.com/b' },
    { id: 3, windowId: 2, index: 9, groupId: 13, url: 'https://example.org/c' },
  ];
  const nativeGroups = [
    { id: 11, windowId: 2, title: 'Example', minIndex: 1, shared: false, queryComplete: true, tabIds: [1], mappings: [] },
    { id: 12, windowId: 2, title: 'Example', minIndex: 5, shared: false, queryComplete: true, tabIds: [2], mappings: [] },
    { id: 13, windowId: 2, title: 'Wrong', minIndex: 9, shared: false, queryComplete: true, tabIds: [3], mappings: [{ groupKey: 'example.org', origin: 'adopted' }] },
  ];
  const options = {
    windowId: 2,
    tabs,
    nativeGroups,
    labelOverrides: {},
    groupTabOrder: {},
    sessionGroups: { groups: [], assignments: {} },
    landingPagePatterns: [],
    customGroups: [],
    homepagesLabel: 'Homepages',
  };

  const analysis = analyzeNativeChromeGroups(options);
  assert.equal(analysis.conflicts.length, 1);
  assert.deepEqual(analysis.conflicts[0].candidates.map(candidate => candidate.id), [11, 12]);
  assert.deepEqual([...analysis.unsafeMappedGroupKeys], ['example.org']);

  const snapshot = buildAutomaticChromeSyncSnapshot(options);
  assert.deepEqual(snapshot.preserveGroupKeys, ['example.org']);
  assert.deepEqual(snapshot.groups.map(group => [group.groupKey, group.tabIds]), [
    ['example.com', [1, 2]],
    ['example.org', [3]],
  ]);
});

// @lat: [[tests#Chrome 标签组验收#Created 组跨域导航迁移]]
test('snapshot reassigns cross-domain navigation only from a complete created group', () => {
  const tabs = [
    {
      id: 201,
      windowId: 5,
      index: 0,
      groupId: 20,
      url: 'https://hellogithub.com/article/1',
    },
    {
      id: 202,
      windowId: 5,
      index: 1,
      groupId: 20,
      url: 'https://github.com/JOYCEQL/magic-resume',
    },
  ];
  const nativeGroup = {
    id: 20,
    windowId: 5,
    title: 'Hellogithub',
    shared: false,
    queryComplete: true,
    minIndex: 0,
    tabIds: [201, 202],
  };

  const created = buildAutomaticChromeSyncSnapshot({
    windowId: 5,
    tabs,
    nativeGroups: [{
      ...nativeGroup,
      mappings: [{ groupKey: 'hellogithub.com', origin: 'created' }],
    }],
  });

  assert.deepEqual(created.preserveGroupKeys, ['hellogithub.com']);
  assert.deepEqual(created.groups.map(group => [group.groupKey, group.tabIds]), [
    ['hellogithub.com', [201]],
    ['github.com', [202]],
  ]);
  assert.deepEqual([...created.analysis.reconcilableCreatedGroupIds], [20]);

  const adopted = buildAutomaticChromeSyncSnapshot({
    windowId: 5,
    tabs,
    nativeGroups: [{
      ...nativeGroup,
      mappings: [{ groupKey: 'hellogithub.com', origin: 'adopted' }],
    }],
  });
  assert.deepEqual(adopted.preserveGroupKeys, ['hellogithub.com']);
  assert.deepEqual(adopted.groups.map(group => [group.groupKey, group.tabIds]), [
    ['hellogithub.com', [201]],
  ]);
  assert.equal(adopted.groups.some(group => group.tabIds.includes(202)), false);

  const unreadableCreated = buildAutomaticChromeSyncSnapshot({
    windowId: 5,
    tabs,
    nativeGroups: [{
      ...nativeGroup,
      queryComplete: false,
      mappings: [{ groupKey: 'hellogithub.com', origin: 'created' }],
    }],
  });
  assert.deepEqual(unreadableCreated.preserveGroupKeys, ['hellogithub.com']);
  assert.deepEqual(unreadableCreated.groups.map(group => [group.groupKey, group.tabIds]), [
    ['hellogithub.com', [201]],
  ]);
  assert.equal(unreadableCreated.groups.some(group => group.tabIds.includes(202)), false);

  const manuallyAssigned = buildAutomaticChromeSyncSnapshot({
    windowId: 5,
    tabs,
    nativeGroups: [{
      ...nativeGroup,
      mappings: [{ groupKey: 'hellogithub.com', origin: 'created' }],
    }],
    sessionGroups: {
      groups: [{ id: 'manual' }],
      assignments: { 202: 'manual' },
    },
  });
  assert.deepEqual(manuallyAssigned.preserveGroupKeys, ['hellogithub.com']);
  assert.deepEqual([...manuallyAssigned.analysis.reconcilableCreatedGroupIds], []);
  assert.deepEqual(manuallyAssigned.groups.map(group => [group.groupKey, group.tabIds]), [
    ['hellogithub.com', [201]],
  ]);
  assert.equal(manuallyAssigned.groups.some(group => group.tabIds.includes(202)), false);
});
