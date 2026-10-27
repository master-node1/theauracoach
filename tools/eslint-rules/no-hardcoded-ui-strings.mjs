/**
 * Fails on user-facing text written straight into JSX in apps/*: text children, string children
 * such as {'Save'}, and string values of props people read or hear (title, label, aria-label,
 * accessibilityLabel, placeholder...). The text belongs in the packages/i18n catalogue
 * (docs/ux/content-style-guide.md §9).
 *
 * Strings with no letters ("·", "?", "—") are allowed, and so is any prop not in the list, which
 * covers test ids, class names, routes and icon paths.
 */

const USER_FACING_PROPS = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'accessibilityHint',
  'accessibilityLabel',
  'body',
  'caption',
  'description',
  'heading',
  'label',
  'message',
  'placeholder',
  'subtitle',
  'text',
  'title',
  'tooltip',
]);

const LETTER = /\p{L}/u;

/** The string literals an expression can evaluate to, through ?:, && / || / ?? and templates. */
function literals(node) {
  if (!node) return [];
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string' ? [{ node, text: node.value }] : [];
    case 'TemplateLiteral':
      return [{ node, text: node.quasis.map((q) => q.value.cooked ?? '').join(' ') }];
    case 'ConditionalExpression':
      return [...literals(node.consequent), ...literals(node.alternate)];
    case 'LogicalExpression':
      return [...literals(node.left), ...literals(node.right)];
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
      return literals(node.expression);
    default:
      return [];
  }
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow hard-coded user-facing text in JSX; use the i18n catalogue.' },
    schema: [
      {
        type: 'object',
        properties: {
          allow: { type: 'array', items: { type: 'string' } },
          props: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      text: 'User-facing text "{{text}}" is hard-coded. Add it to packages/i18n and use t().',
      prop: 'Prop "{{prop}}" has hard-coded text "{{text}}". Add it to packages/i18n and use t().',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const allow = new Set(options.allow ?? []);
    const props = new Set([...USER_FACING_PROPS, ...(options.props ?? [])]);
    const flagged = (text) => LETTER.test(text) && !allow.has(text.trim());
    const short = (text) => {
      const t = text.trim().replace(/\s+/g, ' ');
      return t.length > 40 ? `${t.slice(0, 37)}...` : t;
    };

    return {
      JSXText(node) {
        if (flagged(node.value)) {
          context.report({ node, messageId: 'text', data: { text: short(node.value) } });
        }
      },
      JSXExpressionContainer(node) {
        const parent = node.parent;
        if (parent.type === 'JSXAttribute') {
          const name =
            parent.name.type === 'JSXNamespacedName'
              ? `${parent.name.namespace.name}:${parent.name.name.name}`
              : parent.name.name;
          if (!props.has(name)) return;
          for (const lit of literals(node.expression)) {
            if (flagged(lit.text)) {
              context.report({
                node: lit.node,
                messageId: 'prop',
                data: { prop: name, text: short(lit.text) },
              });
            }
          }
          return;
        }
        if (parent.type === 'JSXElement' || parent.type === 'JSXFragment') {
          for (const lit of literals(node.expression)) {
            if (flagged(lit.text)) {
              context.report({
                node: lit.node,
                messageId: 'text',
                data: { text: short(lit.text) },
              });
            }
          }
        }
      },
      JSXAttribute(node) {
        if (node.value?.type !== 'Literal' || typeof node.value.value !== 'string') return;
        const name = node.name.type === 'JSXNamespacedName' ? node.name.name.name : node.name.name;
        if (props.has(name) && flagged(node.value.value)) {
          context.report({
            node: node.value,
            messageId: 'prop',
            data: { prop: name, text: short(node.value.value) },
          });
        }
      },
    };
  },
};
