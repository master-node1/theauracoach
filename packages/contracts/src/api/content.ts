/**
 * The admin content workflow shared by every content type (admin LLD §2):
 * DRAFT → IN_REVIEW → PUBLISHED → ARCHIVED, with `version` incremented on each publish.
 * Edits to published content are held as a revision that runs through the same states.
 */
export const CONTENT_STATUSES = ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const CONTENT_TYPES = [
  'exercise',
  'template',
  'food',
  'recipe',
  'prompt',
  'policy',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/** `submit` needs `<type>:write`, `reject` needs `<type>:review`, `publish` and `archive` need `<type>:publish`. */
export const CONTENT_ACTIONS = ['submit', 'reject', 'publish', 'archive'] as const;
export type ContentAction = (typeof CONTENT_ACTIONS)[number];

const TRANSITIONS: Record<ContentAction, { from: ContentStatus; to: ContentStatus }> = {
  submit: { from: 'DRAFT', to: 'IN_REVIEW' },
  reject: { from: 'IN_REVIEW', to: 'DRAFT' },
  publish: { from: 'IN_REVIEW', to: 'PUBLISHED' },
  archive: { from: 'PUBLISHED', to: 'ARCHIVED' },
};

/** The state an action leads to, or null when the action is not allowed from `from`. */
export function contentTransition(
  action: ContentAction,
  from: ContentStatus,
): ContentStatus | null {
  const t = TRANSITIONS[action];
  return t.from === from ? t.to : null;
}
