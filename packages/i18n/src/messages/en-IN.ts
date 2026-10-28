/**
 * English (India): the source catalogue every other locale is translated from.
 *
 * Messages use ICU MessageFormat (`{name}`, `{count, plural, ...}`, `{x, select, ...}`); web and
 * mobile render them with next-intl / use-intl. Copy follows docs/ux/content-style-guide.md, and
 * a unit test fails if any message uses a banned phrase (src/style.ts).
 *
 * Keys are grouped by screen. Add a key here first, then use it; never put user-facing text in JSX.
 */
export const enIN = {
  common: {
    appName: 'AuraCoach',
    tagline: 'Your trainer and nutrition coach, any time.',
    continue: 'Continue',
    save: 'Save',
    saved: 'Saved',
    back: 'Back',
    signOut: 'Sign out',
    settings: 'Settings',
    comingSoon: 'Coming soon',
    on: 'On',
    none: 'None',
    retryHint: 'Check your connection and try again.',
    refreshHint: 'Check your connection and refresh the page.',
    saveFailed: 'Could not save. Check your connection and try again.',
    invalidValue: 'Please check the value and try again.',
    legalLinks: 'Not medical advice · Privacy · Terms',
  },
  meta: {
    titleTemplate: '%s · AuraCoach',
    adminTitleTemplate: '%s · Admin · AuraCoach',
    description: 'Your trainer and nutrition coach, any time.',
  },
  nav: {
    main: 'Main',
    today: 'Today',
    train: 'Train',
    eat: 'Eat',
    coach: 'Coach',
    progress: 'Progress',
    adminConsole: 'Admin console',
  },
  auth: {
    signInTitle: 'Sign in',
    headline: 'Your trainer and nutrition coach, any time.',
    lede: 'Workouts that fit your week and meals that fit your plate, from dal to dosa.',
    errors: {
      state: 'That sign-in link expired. Please try again.',
      provider: 'Sign-in was cancelled or failed. Please try again.',
      tokens: 'We could not finish signing you in. Please try again.',
    },
    notices: {
      verified: 'Your email is confirmed. Sign in to continue.',
      passwordChanged: 'Your password is changed. Sign in with the new one.',
      codeResent: 'We sent a new code. The old one no longer works.',
    },
    providers: {
      Google: 'Continue with Google',
      SignInWithApple: 'Continue with Apple',
    },
    orWithEmail: 'or with email',
    fields: {
      email: 'Email',
      password: 'Password',
      code: 'Code',
      newPassword: 'New password',
    },
    password: {
      policy: 'At least {min} characters, with upper- and lower-case letters and a number.',
      hint: 'Use at least {list}.',
      tooLong: 'That password is too long.',
      issues: {
        minLength: '{min} characters',
        lower: 'a lower-case letter',
        upper: 'an upper-case letter',
        number: 'a number',
      },
    },
    codeHint: 'The 6-digit code we emailed you. It works for {minutes} minutes.',
    resetCodeHint: 'The 6-digit code we emailed you. It works once, for {minutes} minutes.',
    identityErrors: {
      UsernameExists: 'An account with this email already exists. Sign in or reset your password.',
      CodeMismatch: 'That code is not right. Check the email and try again.',
      ExpiredCode: 'That code has expired. Send a new one and try again.',
      LimitExceeded: 'Too many attempts. Wait a few minutes and try again.',
      TooManyRequests: 'Too many attempts. Wait a minute and try again.',
      InvalidPassword:
        'Use at least {min} characters with upper- and lower-case letters and a number.',
      NotAuthorized: 'That email and password do not match.',
      UserNotConfirmed: 'Confirm your email first. We can send a new code.',
      InvalidParameter: 'Check the details and try again.',
      ChallengeRequired: 'This account needs another sign-in step. Use “More sign-in options”.',
      Unavailable: 'We could not reach the sign-in service. Try again in a moment.',
    },
    signIn: {
      submit: 'Sign in',
      busy: 'Signing in…',
      enterCode: 'Enter your code',
      createAccount: 'Create an account',
      forgot: 'Forgot password?',
      moreOptions: 'More sign-in options',
    },
    signUp: {
      metaTitle: 'Create an account',
      title: 'Create your account',
      lede: 'You must be 18 or older to use AuraCoach.',
      submit: 'Create account',
      busy: 'Creating account…',
      haveAccount: 'Already have an account?',
      haveAccountLink: 'Already have an account? Sign in',
      signIn: 'Sign in',
    },
    verify: {
      metaTitle: 'Confirm your email',
      title: 'Check your email',
      ledeEmail: 'We sent a 6-digit code to {email}.',
      lede: 'Enter your email and the 6-digit code we sent you.',
      submit: 'Verify email',
      busy: 'Checking…',
      resend: 'Send a new code',
      differentEmail: 'Use a different email',
    },
    forgot: {
      title: 'Reset your password',
      lede: "Enter your email. If it has an account, we'll send a code to reset the password.",
      submit: 'Send reset code',
      busy: 'Sending…',
      back: 'Back to sign in',
    },
    reset: {
      title: 'Choose a new password',
      lede: 'If the email has an account, a code is on its way. It works once, for {minutes} minutes.',
      submit: 'Set new password',
      busy: 'Saving…',
      resend: 'Send a new code',
      back: 'Back to sign in',
    },
  },
  today: {
    greeting:
      '{period, select, morning {Good morning} afternoon {Good afternoon} other {Good evening}}',
    greetingNamed:
      '{period, select, morning {Good morning, {name}} afternoon {Good afternoon, {name}} other {Good evening, {name}}}',
    emptyTitle: 'Your plan starts here',
    emptyTitleNamed: 'Hi {name}, your plan starts here',
    emptyBody:
      'Signed in as <strong>{email}</strong>. Workouts, meals and your coach will show up here once you finish setting up.',
    profileFailed: "We couldn't load your profile",
  },
  train: {
    placeholder: 'Your workouts and weekly plan will live here.',
  },
  eat: {
    placeholder: 'Log meals and see your calories, protein and fibre here.',
  },
  coach: {
    placeholder: 'Ask your AI coach about training and food here.',
  },
  progress: {
    placeholder: 'Weight trend, consistency and personal bests will show here.',
  },
  settings: {
    loadFailed: "We couldn't load your settings",
    consentsFailed: 'Could not load your consents.',
    summary: 'Account',
    addName: 'Add your name',
    plan: '{email} · Free beta',
    account: 'Account',
    displayName: 'Display name',
    email: 'Email',
    timeZone: 'Time zone',
    timeZoneHint: 'Choose your time zone',
    app: 'App',
    theme: 'Theme',
    themes: { system: 'System', light: 'Light', dark: 'Dark' },
    coachTone: 'Coach tone',
    coachTones: { supportive: 'Supportive', direct: 'Direct' },
    units: 'Units',
    unitSystems: { METRIC: 'kg, cm', IMPERIAL: 'lb, ft/in' },
    unitsAfterSetup: 'kg, cm · change after setup',
    planSection: 'Plan',
    equipment: 'Equipment',
    dietAndAllergies: 'Diet and allergies',
    diets: {
      VEGETARIAN: 'Vegetarian',
      EGGETARIAN: 'Eggetarian',
      NON_VEGETARIAN: 'Non-vegetarian',
      VEGAN: 'Vegan',
      JAIN: 'Jain',
      PESCATARIAN: 'Pescatarian',
    },
    privacy: 'Privacy',
    coreService: 'Core service',
    coreServiceHint: 'Needed to run your account. Required.',
    consents: {
      AI_COACH: {
        label: 'AI coach',
        description:
          'Lets the coach read your plan and logs to answer questions and suggest changes.',
      },
      NOTIFICATIONS: {
        label: 'Reminders',
        description: 'Workout and meal reminders and a weekly summary.',
      },
      MARKETING: {
        label: 'Product news',
        description: 'Occasional emails about new features.',
      },
    },
    signOutEverywhere: 'Sign out of all devices',
    signOutEverywhereHint: 'Signs you out on every phone and browser',
    signOutEverywhereFailed: "We couldn't sign out your other devices. Try again in a moment.",
    exportData: 'Export my data',
    deleteAccount: 'Delete account',
    policyVersion: 'Privacy policy version {version}',
    about: 'About',
    footer: 'AuraCoach {version} beta · Data stored in India (Mumbai)',
    disclaimer: 'Fitness guidance only, not medical advice.',
  },
  admin: {
    title: 'Admin',
    nav: 'Admin',
    consoleTitle: 'Admin console',
    consolePlaceholder:
      'Content, review queue, users and usage sections arrive with the admin slice.',
    backToApp: 'Back to app',
    sections: {
      dashboard: 'Dashboard',
      exercises: 'Exercises',
      foods: 'Foods',
      recipes: 'Recipes',
      templates: 'Templates',
      prompts: 'Prompts',
      policies: 'Policies',
      reviewQueue: 'Review queue',
      feedback: 'Feedback',
      users: 'Users',
      usage: 'Usage and cost',
      auditLog: 'Audit log',
      roles: 'Roles',
    },
  },
  forbidden: {
    title: 'No access',
    heading: "You don't have access to this page",
    body: 'The admin console is for AuraCoach staff. Ask an admin if you need a role.',
    back: 'Back to Today',
  },
  mfaRequired: {
    title: 'Two-step verification needed',
    heading: 'Sign in with two-step verification',
    body: 'The admin console needs a sign-in that used your authenticator app. Sign in again and enter the code from the app when asked.',
    signInAgain: 'Sign in again',
    back: 'Back to Today',
  },
} as const;

type Widen<T> = { -readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** The shape every catalogue has: the same keys as en-IN, any text. */
export type Messages = Widen<typeof enIN>;
