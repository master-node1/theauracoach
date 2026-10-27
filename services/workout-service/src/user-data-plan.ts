import type { UserDataPlan } from '@aura/service-kit';

/** workout-service's part of export and deletion (users LLD §3–4). Children before parents. */
export const userDataPlan: UserDataPlan = {
  service: 'workout-service',
  tables: [
    { model: 'WorkoutSet', where: (userId) => ({ session: { userId } }) },
    { model: 'PlannedExercise', where: (userId) => ({ session: { userId } }) },
    { model: 'PersonalRecord', where: (userId) => ({ userId }) },
    { model: 'WorkoutSession', where: (userId) => ({ userId }) },
    { model: 'WorkoutPlanWeek', where: (userId) => ({ plan: { userId } }) },
    { model: 'WorkoutPlan', where: (userId) => ({ userId }) },
    { model: 'UserEquipment', where: (userId) => ({ userId }) },
    { model: 'UserTrainingProfile', where: (userId) => ({ userId }) },
    { model: 'RecoverySignal', where: (userId) => ({ userId }) },
  ],
  notUserData: {
    Equipment: 'Equipment catalogue',
    MuscleGroup: 'Muscle catalogue',
    Exercise: 'Exercise library',
    ExerciseMuscle: 'Exercise library',
    ExerciseEquipment: 'Exercise library',
    ExerciseMedia: 'Exercise library',
    WorkoutTemplate: 'Programme templates',
    WorkoutTemplateExercise: 'Programme templates',
    WorkoutPolicy: 'Engine configuration (staff edits)',
  },
};
