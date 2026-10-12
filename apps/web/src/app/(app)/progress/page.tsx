import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Progress' };

export default function ProgressPage() {
  return (
    <>
      <h1 className="page-title">Progress</h1>
      <section className="card">
        <h2>Coming soon</h2>
        <p>Weight trend, consistency and personal bests will show here.</p>
      </section>
    </>
  );
}
