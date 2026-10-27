/**
 * Content rules as data (docs/ux/content-style-guide.md §3 and §7), so code can enforce what the
 * guide says: catalogue tests, the coach reply post-check (TAC-26) and notification copy (TAC-30).
 */

export type BannedCategory = 'guarantee' | 'diagnosis' | 'shaming' | 'extreme' | 'pressure';

export interface BannedPhrase {
  id: string;
  category: BannedCategory;
  /** Case-insensitive regular expression source, matched on word boundaries. */
  pattern: string;
  /** Why it is banned, for reviewers and the coach post-check log. */
  reason: string;
  /** What to say instead. */
  instead: string;
}

export const BANNED_PHRASES: readonly BannedPhrase[] = [
  {
    id: 'guarantee',
    category: 'guarantee',
    pattern: 'guarantee[sd]?',
    reason: 'Outcomes vary; we cannot promise results.',
    instead: 'Most people who stick with a plan like this see progress in 6–8 weeks.',
  },
  {
    id: 'promised-loss',
    category: 'guarantee',
    pattern:
      '(lose|drop|shed) \\d+(\\.\\d+)? ?(kg|kgs|kilos?|lbs?|pounds?) in \\d+ ?(days?|weeks?)',
    reason: 'Promises a specific loss in a fixed time.',
    instead: 'A steady pace is about 0.25–0.5 kg a week.',
  },
  {
    id: 'certain-results',
    category: 'guarantee',
    pattern: '(100 ?% (results|success)|instant results|results in \\d+ days|risk[- ]free)',
    reason: 'Overstates certainty or speed.',
    instead: 'Describe the expected range and how we will adjust.',
  },
  {
    id: 'miracle',
    category: 'guarantee',
    pattern: '(miracle|magic pill|secret trick|fat[- ]burning (food|drink|tea))',
    reason: 'Implies a shortcut that does not exist.',
    instead: 'Name the real lever: consistency, protein, sleep, progressive overload.',
  },
  {
    id: 'cure',
    category: 'diagnosis',
    pattern:
      '(cures?|cured|heals?|reverses?|reversing) (your |the )?(diabetes|pcos|pcod|thyroid|blood pressure|hypertension|cholesterol|disease|condition|injury|back pain)',
    reason: 'Medical claim. We give fitness guidance, not treatment.',
    instead: 'Please talk to your doctor about managing this; I can help you train around it.',
  },
  {
    id: 'diagnosis',
    category: 'diagnosis',
    pattern:
      '(you (have|might have|probably have|are suffering from)|sounds like you have|you are) (diabetes|pre-?diabetes|pcos|pcod|an eating disorder|anorexia|bulimia|hypothyroidism|depression|a hernia|a (torn|slipped) [a-z]+)',
    reason: 'Diagnosis is for a qualified clinician.',
    instead: 'That is worth checking with a doctor. Until then, let us keep things gentle.',
  },
  {
    id: 'prescribe',
    category: 'diagnosis',
    pattern:
      '(stop taking|reduce|increase|change) your (medicine|medication|insulin|dose|dosage|tablets)',
    reason: 'Medication changes are for the prescribing doctor.',
    instead: 'Please ask your doctor before changing any medication.',
  },
  {
    id: 'cheat',
    category: 'shaming',
    pattern: '(cheat (day|meal)s?|guilt[- ]free|sinful|naughty food|junk you ate)',
    reason: 'Frames food as moral failure.',
    instead: 'Call it what it is: "a bigger meal", "a treat", "dinner out".',
  },
  {
    id: 'bad-food',
    category: 'shaming',
    pattern: '(bad|forbidden|toxic) foods?',
    reason: 'No food is banned; we talk about amounts and balance.',
    instead: 'Fits less often / in smaller portions this week.',
  },
  {
    id: 'body-shaming',
    category: 'shaming',
    pattern:
      '(beach body|bikini body|skinny|flabby|get rid of (your|that) (flab|belly|fat)|problem areas?|muffin top|thunder thighs)',
    reason: 'Judges bodies instead of supporting goals.',
    instead: 'Talk about strength, energy and the goal the user chose.',
  },
  {
    id: 'blame',
    category: 'shaming',
    pattern:
      '(you failed|you messed up|no excuses|you were lazy|be ashamed|you should be embarrassed|you blew it)',
    reason: 'Blames the user for a missed day.',
    instead: "Life happens. Let's pick up with tomorrow's session.",
  },
  {
    id: 'earn-burn',
    category: 'shaming',
    pattern:
      '(burn (it|that|those calories) off|earn (your|that) (food|meal|dinner|dessert)|work off (that|your) (meal|dinner|sweet))',
    reason: 'Treats exercise as punishment for eating.',
    instead: 'Keep training and food goals separate and positive.',
  },
  {
    id: 'extreme-restriction',
    category: 'extreme',
    pattern:
      '(starve|starving yourself|crash diet|detox|cleanse|water fast|skip (all )?meals|eat nothing)',
    reason: 'Unsafe or unsupported; can harm users with a history of disordered eating.',
    instead: 'Suggest a small, safe change, never below the calorie floor.',
  },
  {
    id: 'no-pain',
    category: 'extreme',
    pattern:
      '(no pain,? no gain|push through (the )?pain|ignore the pain|train through (the )?pain)',
    reason: 'Pain is a stop signal (safety rules).',
    instead:
      'Stop if it hurts. Sharp or unusual pain is a reason to rest and check with a professional.',
  },
  {
    id: 'pressure',
    category: 'pressure',
    pattern: "(last chance|act now|don't miss out|you'll regret|before it's too late)",
    reason: 'Manufactured urgency.',
    instead: 'State the facts and let the user decide.',
  },
];

export interface BannedMatch {
  id: string;
  category: BannedCategory;
  text: string;
  index: number;
}

const compiled = BANNED_PHRASES.map((p) => ({
  phrase: p,
  regex: new RegExp(`\\b${p.pattern}\\b`, 'gi'),
}));

/** Every banned phrase in a piece of copy (catalogue message, coach reply, notification). */
export function findBannedPhrases(text: string): BannedMatch[] {
  const matches: BannedMatch[] = [];
  for (const { phrase, regex } of compiled) {
    regex.lastIndex = 0;
    for (const m of text.matchAll(regex)) {
      matches.push({ id: phrase.id, category: phrase.category, text: m[0], index: m.index ?? 0 });
    }
  }
  return matches.sort((a, b) => a.index - b.index);
}

/**
 * Words that reveal health details and must not appear in a notification's lock-screen title or
 * body (guide §7). The full text may appear inside the app after unlock.
 */
export const LOCK_SCREEN_SENSITIVE_TERMS: readonly string[] = [
  'weight',
  'weigh',
  'weighed',
  'weigh-in',
  'kg',
  'kgs',
  'lb',
  'lbs',
  'bmi',
  'body fat',
  'calorie',
  'calories',
  'kcal',
  'deficit',
  'waist',
  'injury',
  'injured',
  'pain',
  'painful',
  'pregnant',
  'pregnancy',
  'period',
  'periods',
  'menstrual',
  'medication',
  'medicine',
  'diabetes',
  'blood pressure',
  'thyroid',
  'pcos',
  'pcod',
  'eating disorder',
  'binge',
  'missed',
  'behind',
  'overate',
];

const lockScreenPatterns = LOCK_SCREEN_SENSITIVE_TERMS.map((term) => ({
  term,
  regex: new RegExp(`(^|[^a-z])${term.replace(/ /g, '\\s+')}($|[^a-z])`, 'i'),
}));

/** The sensitive terms found in lock-screen copy; empty when it is safe to show. */
export function lockScreenIssues(text: string): string[] {
  return lockScreenPatterns.filter(({ regex }) => regex.test(text)).map(({ term }) => term);
}
