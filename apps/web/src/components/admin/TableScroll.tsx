/**
 * Wraps a wide table so it scrolls sideways on narrow screens. The region is focusable, so
 * keyboard users can scroll it too (axe scrollable-region-focusable).
 */
export function TableScroll({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
