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
