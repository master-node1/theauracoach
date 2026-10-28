#!/usr/bin/env node
// Release notes from the commits between two refs, grouped by Conventional Commit type (TAC-37).
// Merge commits contribute their PR title (second line onwards is ignored); Jira keys are linked.
// Usage: release-notes.mjs <from-ref|''> <to-ref>   (empty from-ref: the whole history up to to-ref)
import { execFileSync } from 'node:child_process';

const JIRA = 'https://harisireddi7776.atlassian.net/browse';
const GROUPS = [
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['perf', 'Performance'],
  ['security', 'Security'],
  ['refactor', 'Refactoring'],
  ['docs', 'Documentation'],
  ['build', 'Build and CI'],
  ['ci', 'Build and CI'],
  ['chore', 'Maintenance'],
  ['test', 'Tests'],
];

/** Subject lines (one per change) from `git log` output separated by NUL records. */
export function subjects(log) {
  return log
    .split('\0')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((record) => {
      const [subject = '', ...body] = record.split('\n');
      // "Merge pull request #12 from owner/branch" -> the PR title is the first body line.
      const merge = /^Merge pull request #(\d+)/.exec(subject);
      if (merge) {
        const title = body.map((l) => l.trim()).find(Boolean);
        return title ? `${title} (#${merge[1]})` : undefined;
      }
      return subject.startsWith('Merge ') ? undefined : subject;
    })
    .filter(Boolean);
}

export function releaseNotes(lines, { title } = {}) {
  const sections = new Map();
  for (const line of lines) {
    const m = /^(\w+)(?:\([^)]*\))?(!)?:\s*(.+)$/.exec(line);
    const type = m?.[1]?.toLowerCase();
    const group = GROUPS.find(([t]) => t === type)?.[1] ?? 'Other changes';
    let text = m && GROUPS.some(([t]) => t === type) ? m[3] : line;
    if (m?.[2]) text = `**Breaking:** ${text}`;
    text = text.replace(/\b(TAC-\d+)\b/g, `[$1](${JIRA}/$1)`);
    if (!sections.has(group)) sections.set(group, []);
    sections.get(group).push(text);
  }
  const order = [...new Set([...GROUPS.map(([, g]) => g), 'Other changes'])];
  const out = title ? [`# ${title}`, ''] : [];
  for (const group of order) {
    const items = sections.get(group);
    if (!items) continue;
    out.push(`## ${group}`, '', ...items.map((i) => `- ${i}`), '');
  }
  if (out.length === (title ? 2 : 0)) out.push('No changes.');
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [from = '', to = 'HEAD'] = process.argv.slice(2);
  const range = from ? `${from}..${to}` : to;
  const log = execFileSync('git', ['log', '--first-parent', '--format=%B%x00', range], {
    encoding: 'utf8',
  });
  process.stdout.write(`${releaseNotes(subjects(log), { title: to })}\n`);
}
