import { consentChanged, profileChanged } from './consents/user-updates.subscription';
import { userRegistered } from './preferences/user-registered.subscription';

/** Every event this service consumes. */
export const subscriptions = [userRegistered, consentChanged, profileChanged];
