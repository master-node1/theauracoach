import type { UserDataPlan } from '@aura/service-kit';

/** progress-service's part of export and deletion (users LLD §3–4). */
export const userDataPlan: UserDataPlan = {
  service: 'progress-service',
  tables: [
    { model: 'BodyMeasurement', where: (userId) => ({ userId }) },
    { model: 'DailyCheckIn', where: (userId) => ({ userId }) },
    { model: 'DeviceIntegration', where: (userId) => ({ userId }) },
    { model: 'WorkoutDayFact', where: (userId) => ({ userId }) },
    { model: 'NutritionDayFact', where: (userId) => ({ userId }) },
    { model: 'ExerciseBestFact', where: (userId) => ({ userId }) },
  ],
  notUserData: {},
};
