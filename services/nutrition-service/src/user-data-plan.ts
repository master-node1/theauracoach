import type { UserDataPlan } from '@aura/service-kit';

/** nutrition-service's part of export and deletion (users LLD §3–4). Children before parents. */
export const userDataPlan: UserDataPlan = {
  service: 'nutrition-service',
  tables: [
    { model: 'MealPlanItem', where: (userId) => ({ mealPlan: { userId } }) },
    { model: 'MealPlan', where: (userId) => ({ userId }) },
    { model: 'MealEntry', where: (userId) => ({ userId }) },
    { model: 'WaterEntry', where: (userId) => ({ userId }) },
    { model: 'DailyNutritionSummary', where: (userId) => ({ userId }) },
    { model: 'NutritionTarget', where: (userId) => ({ userId }) },
    { model: 'UserNutritionProfile', where: (userId) => ({ userId }) },
    { model: 'WeightFact', where: (userId) => ({ userId }) },
    // Foods the user created themselves (source USER); catalogue foods have no creator.
    { model: 'FoodNutrient', where: (userId) => ({ food: { createdById: userId } }) },
    { model: 'FoodUnit', where: (userId) => ({ food: { createdById: userId } }) },
    { model: 'FoodItem', where: (userId) => ({ createdById: userId }) },
  ],
  notUserData: {
    Nutrient: 'Nutrient catalogue',
    Allergen: 'Allergen catalogue',
    Recipe: 'Recipe library (staff content)',
    RecipeIngredient: 'Recipe library (staff content)',
    NutritionPolicy: 'Engine configuration (staff edits)',
  },
};
