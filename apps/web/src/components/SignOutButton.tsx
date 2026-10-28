/** A plain form POST, so sign out works without JavaScript and carries an Origin header. */
export function SignOutButton() {
  return (
    <form action="/api/auth/logout" method="post">
      <button type="submit" className="link-button">
        Sign out
      </button>
    </form>
  );
}

/**
 * Ends every session of the user, on all devices (TAC-8); this browser lands on sign-in. Other
 * devices are signed out at their next request.
 */
export function SignOutEverywhereButton() {
  return (
    <form action="/api/auth/logout-everywhere" method="post">
      <button type="submit" className="link-button">
        Sign out of all devices
      </button>
    </form>
  );
}
