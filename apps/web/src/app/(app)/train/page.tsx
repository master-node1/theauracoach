import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Train' };

export default function TrainPage() {
  return (
    <>
      <h1 className="page-title">Train</h1>
      <section className="card">
        <h2>Coming soon</h2>
        <p>Your workouts and weekly plan will live here.</p>
      </section>
    </>
  );
}
