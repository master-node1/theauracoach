import type { UserDataPlan } from '@aura/service-kit';

/** notification-service's part of export and deletion (users LLD §3–4). */
export const userDataPlan: UserDataPlan = {
  service: 'notification-service',
  tables: [
    { model: 'Notification', where: (userId) => ({ userId }) },
    { model: 'Device', where: (userId) => ({ userId }) },
    { model: 'NotificationPreference', where: (userId) => ({ userId }) },
    { model: 'SuppressionFact', where: (userId) => ({ userId }) },
  ],
  notUserData: {},
};
