import type { UserDataPlan } from '@aura/service-kit';

/**
 * profile-service's own part of export and deletion. The `User` row and the deletion request are
 * not removed: the row becomes a tombstone (status DELETED, email and name scrubbed) so a token
 * issued before the identity was deleted cannot recreate the account, and the request with its
 * per-service acknowledgements is the record that the erasure happened.
 */
export const userDataPlan: UserDataPlan = {
  service: 'profile-service',
  tables: [
    {
      model: 'User',
      where: (userId) => ({ id: userId }),
      purge: { keep: 'Scrubbed to a tombstone' },
    },
    { model: 'Profile', where: (userId) => ({ userId }) },
    { model: 'UserPreference', where: (userId) => ({ userId }) },
    { model: 'UserRole', where: (userId) => ({ userId }) },
    { model: 'Consent', where: (userId) => ({ userId }) },
    { model: 'FitnessGoal', where: (userId) => ({ userId }) },
    { model: 'SafetyScreening', where: (userId) => ({ userId }) },
    { model: 'HealthCondition', where: (userId) => ({ userId }) },
    { model: 'FitnessAssessment', where: (userId) => ({ userId }) },
    { model: 'Subscription', where: (userId) => ({ userId }) },
    { model: 'Onboarding', where: (userId) => ({ userId }) },
    {
      model: 'DataRequest',
      where: (userId) => ({ userId }),
      purge: { keep: 'Record of the erasure: ids, kinds and timestamps only' },
    },
    {
      model: 'DataRequestPart',
      where: (userId) => ({ request: { userId } }),
      notExported: 'Processing detail of the requests listed in DataRequest',
      purge: { keep: 'Which services confirmed the erasure' },
    },
  ],
  notUserData: { Role: 'Role catalogue' },
};
