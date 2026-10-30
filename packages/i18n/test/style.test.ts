import { describe, expect, it } from 'vitest';
import { BANNED_PHRASES, findBannedPhrases, lockScreenIssues } from '../src';

describe('banned phrases', () => {
  it.each([
    ['Guaranteed results in 30 days!', 'guarantee'],
    ['You will lose 5 kg in 2 weeks.', 'promised-loss'],
    ['This tea cures your diabetes', 'cure'],
    ['It sounds like you have PCOS.', 'diagnosis'],
    ['Stop taking your medication before training.', 'prescribe'],
    ['Enjoy your cheat day', 'cheat'],
    ['Avoid bad foods', 'bad-food'],
    ['Get your beach body ready', 'body-shaming'],
    ['No excuses today', 'blame'],
    ['Go burn it off tomorrow', 'earn-burn'],
    ['Try a 3-day detox', 'extreme-restriction'],
    ['No pain, no gain', 'no-pain'],
    ["Last chance, don't miss out", 'pressure'],
  ])('flags %j', (text, id) => {
    expect(findBannedPhrases(text).map((m) => m.id)).toContain(id);
  });

  it.each([
    'Fitness guidance only, not medical advice.',
    'A steady pace is about 0.25–0.5 kg a week.',
    'Please ask your doctor before changing any medication.',
    "Life happens. Let's pick up with tomorrow's session.",
    'Add 1 roti and dal to hit ≈ 30 g protein.',
  ])('lets supportive copy through: %j', (text) => {
    expect(findBannedPhrases(text)).toEqual([]);
  });

  it('every pattern compiles and has guidance', () => {
    for (const p of BANNED_PHRASES) {
      expect(() => new RegExp(p.pattern, 'i')).not.toThrow();
      expect(p.reason && p.instead).toBeTruthy();
    }
    expect(new Set(BANNED_PHRASES.map((p) => p.id)).size).toBe(BANNED_PHRASES.length);
  });
});

describe('lock-screen notification copy', () => {
  it('flags health details', () => {
    expect(lockScreenIssues('Time to log your weight')).toEqual(['weight']);
    expect(lockScreenIssues('You are 300 kcal over today')).toEqual(['kcal']);
    expect(lockScreenIssues('You missed 3 workouts')).toEqual(['missed']);
  });

  it('passes neutral nudges', () => {
    expect(lockScreenIssues('Your workout is ready')).toEqual([]);
    expect(lockScreenIssues('Time for lunch. Tap to log it.')).toEqual([]);
    expect(lockScreenIssues('Your weekly summary is in')).toEqual([]);
  });
});
