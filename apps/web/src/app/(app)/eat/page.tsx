import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Eat' };

export default function EatPage() {
  return (
    <>
      <h1 className="page-title">Eat</h1>
      <section className="card">
        <h2>Coming soon</h2>
        <p>Log meals and see your calories, protein and fibre here.</p>
      </section>
    </>
  );
}
