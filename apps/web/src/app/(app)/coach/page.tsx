import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Coach' };

export default function CoachPage() {
  return (
    <>
      <h1 className="page-title">Coach</h1>
      <section className="card">
        <h2>Coming soon</h2>
        <p>Ask your AI coach about training and food here.</p>
      </section>
    </>
  );
}
