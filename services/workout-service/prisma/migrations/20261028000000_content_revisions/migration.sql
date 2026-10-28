-- CreateEnum
CREATE TYPE "ContentKind" AS ENUM ('EXERCISE', 'TEMPLATE');

-- AlterTable
ALTER TABLE "Exercise" ADD COLUMN     "illustrationKey" TEXT,
ADD COLUMN     "loadIncrementKg" DECIMAL(4,2),
ADD COLUMN     "tracking" VARCHAR(10) NOT NULL DEFAULT 'reps';

-- AlterTable
ALTER TABLE "WorkoutTemplate" ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ContentRevision" (
    "id" UUID NOT NULL,
    "kind" "ContentKind" NOT NULL,
    "slug" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "body" JSONB NOT NULL,
    "reviewRequired" VARCHAR(20),
    "createdById" UUID,
    "submittedAt" TIMESTAMP(3),
    "submittedById" UUID,
    "publishedAt" TIMESTAMP(3),
    "publishedById" UUID,
    "supersededAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentRevision_kind_status_slug_idx" ON "ContentRevision"("kind", "status", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ContentRevision_kind_slug_version_key" ON "ContentRevision"("kind", "slug", "version");


-- At most one open (DRAFT or IN_REVIEW) version and one live version per slug (admin LLD §2).
CREATE UNIQUE INDEX "ContentRevision_open_key" ON "ContentRevision"("kind", "slug")
  WHERE "status" IN ('DRAFT', 'IN_REVIEW');
CREATE UNIQUE INDEX "ContentRevision_live_key" ON "ContentRevision"("kind", "slug")
  WHERE "status" = 'PUBLISHED' AND "supersededAt" IS NULL;

-- Reference vocabularies (EQUIPMENT_CODES and MUSCLE_CODES in @aura/contracts; a test keeps them equal).
INSERT INTO "Equipment" ("code", "name") VALUES
  ('bodyweight', 'Bodyweight'),
  ('dumbbell', 'Dumbbells'),
  ('barbell', 'Barbell and rack'),
  ('kettlebell', 'Kettlebell'),
  ('bench', 'Bench'),
  ('pull_up_bar', 'Pull-up bar'),
  ('dip_station', 'Dip station'),
  ('resistance_band', 'Resistance band'),
  ('cable', 'Cable machine'),
  ('machine', 'Weight machines'),
  ('cardio_machine', 'Cardio machine'),
  ('jump_rope', 'Jump rope'),
  ('plyo_box', 'Plyo box or step')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "MuscleGroup" ("code", "name") VALUES
  ('quadriceps', 'Quadriceps'),
  ('glutes', 'Glutes'),
  ('hamstrings', 'Hamstrings'),
  ('adductors', 'Adductors'),
  ('calves', 'Calves'),
  ('hip_flexors', 'Hip flexors'),
  ('lower_back', 'Lower back'),
  ('core', 'Core'),
  ('obliques', 'Obliques'),
  ('chest', 'Chest'),
  ('front_delts', 'Front shoulders'),
  ('side_delts', 'Side shoulders'),
  ('rear_delts', 'Rear shoulders'),
  ('triceps', 'Triceps'),
  ('biceps', 'Biceps'),
  ('forearms', 'Forearms'),
  ('lats', 'Lats'),
  ('upper_back', 'Upper back'),
  ('traps', 'Traps'),
  ('cardiovascular', 'Heart and lungs')
ON CONFLICT ("code") DO NOTHING;

-- Engine policy (DEFAULT_WORKOUT_POLICY in @aura/domain/workouts; a test keeps them equal).
-- The nil actor marks the seed; later changes are audited with the editor's id.
INSERT INTO "WorkoutPolicy" ("key", "value", "description", "updatedById", "updatedAt") VALUES
  ('contraindicationMap', '{"injury_knee":{"minSeverity":"moderate","tags":["knee_high_load","plyometric","deep_knee_flexion_loaded"]},"injury_lower_back":{"minSeverity":"mild","tags":["spinal_flexion_loaded","axial_load_heavy"]},"injury_shoulder":{"minSeverity":"mild","tags":["overhead_loaded","behind_neck"]},"pregnancy":{"minSeverity":"mild","tags":["supine_after_t1","high_impact","valsalva_heavy","contact"]},"hypertension":{"minSeverity":"mild","tags":["valsalva_heavy","isometric_max"]}}'::jsonb, 'Condition code to excluded exercise tags, from a minimum severity', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP),
  ('weeklySetsPerMuscle', '{"BEGINNER":{"min":8,"max":10},"INTERMEDIATE":{"min":10,"max":14},"ADVANCED":{"min":12,"max":18}}'::jsonb, 'Weekly hard sets per primary muscle by experience', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP),
  ('minutesPerSet', '2.5'::jsonb, 'Minutes per set including rest', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP),
  ('warmupMinutes', '8'::jsonb, 'Warm-up minutes per session', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP),
  ('sessionOverrunMinutes', '10'::jsonb, 'Minutes a session may run over the planned length', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP),
  ('lowCapExcludedTags', '["plyometric"]'::jsonb, 'Tags excluded under the low intensity cap', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP),
  ('lowCapMaxRpe', '6'::jsonb, 'Highest target RPE under the low intensity cap', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP),
  ('lowCapMinReps', '6'::jsonb, 'Fewest reps under the low intensity cap', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP),
  ('loadIncrementsKg', '{"barbell":2.5,"dumbbell":2,"machine":5,"cable":5}'::jsonb, 'Default load steps by equipment', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP),
  ('safeDefaultTemplateSlug', '"safe-default-full-body"'::jsonb, 'Template used when a plan fails validation', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP),
  ('scheduledDeloadEvery', '6'::jsonb, 'Intermediate and advanced users deload every Nth week', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP),
  ('deloadVolumeShare', '0.55'::jsonb, 'Share of sets a deload week keeps', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP),
  ('deloadRpeDrop', '2'::jsonb, 'RPE reduction in a deload week', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP),
  ('regressLoadFactor', '0.9'::jsonb, 'Load factor when regressing', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP),
  ('maxAddedSets', '2'::jsonb, 'Most sets progression may add to an exercise', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP),
  ('beginnerHeavyHingeSessionsPerWeek', '2'::jsonb, 'Beginner sessions per week with a heavy hinge', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP),
  ('painReportWindowDays', '14'::jsonb, 'Days in which a second pain report triggers professional advice', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP),
  ('missedWeeksBeforeFewerDays', '3'::jsonb, 'Weeks with missed sessions before proposing fewer days', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
