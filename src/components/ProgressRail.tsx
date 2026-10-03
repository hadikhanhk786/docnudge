export type Segment = 'on' | 'warn' | 'off';

/** One segment per checklist item, so the bar itself tells you which items are done. */
export function ProgressRail({ segments, large = false }: { segments: Segment[]; large?: boolean }) {
  const done = segments.filter((s) => s === 'on').length;
  return (
    <div className={large ? 'rail rail-lg' : 'rail'} role="progressbar" aria-valuemin={0} aria-valuemax={segments.length} aria-valuenow={done}>
      {segments.map((s, i) => (
        <span key={i} className={`seg ${s}`} />
      ))}
    </div>
  );
}

export function segmentsFromCounts(total: number, done: number): Segment[] {
  return Array.from({ length: Math.max(total, 1) }, (_, i): Segment => (i < done ? 'on' : 'off'));
}
