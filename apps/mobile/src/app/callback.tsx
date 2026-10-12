import { Redirect } from 'expo-router';

/** The OAuth redirect lands here when the OS opens the app with the deep link itself. */
export default function AuthRedirect() {
  return <Redirect href="/" />;
}
