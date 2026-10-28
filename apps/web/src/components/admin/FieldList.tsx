import type { AdminField } from '@aura/contracts';
import { formatValue } from '@/lib/format';

/** Label and value pairs of the support view and reports. */
export function FieldList({ fields }: { fields: AdminField[] }) {
  if (fields.length === 0) return <p>Nothing recorded.</p>;
  return (
    <dl className="field-list">
      {fields.map((f) => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd>{formatValue(f.value)}</dd>
        </div>
      ))}
    </dl>
  );
}
