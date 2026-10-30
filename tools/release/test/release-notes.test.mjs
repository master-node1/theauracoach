import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseNotes, subjects } from '../release-notes.mjs';

test('groups conventional commits and links Jira keys', () => {
  const notes = releaseNotes([
    'feat(web): Today screen TAC-29',
    'fix!: drop v0 tokens',
    'TAC-35: Helm chart (#13)',
  ]);
  assert.match(
    notes,
    /## Features\n\n- Today screen \[TAC-29\]\(https:\/\/harisireddi7776\.atlassian\.net\/browse\/TAC-29\)/,
  );
  assert.match(notes, /## Fixes\n\n- \*\*Breaking:\*\* drop v0 tokens/);
  assert.match(notes, /## Other changes\n\n- \[TAC-35\]/);
});

test('merge commits contribute their PR title', () => {
  const log =
    'Merge pull request #13 from o/TAC-35-helm\n\nTAC-35: Helm chart\n\0Merge branch main\0chore: bump\n\0';
  assert.deepEqual(subjects(log), ['TAC-35: Helm chart (#13)', 'chore: bump']);
});

test('an empty range says so', () => {
  assert.equal(releaseNotes([]), 'No changes.');
});
