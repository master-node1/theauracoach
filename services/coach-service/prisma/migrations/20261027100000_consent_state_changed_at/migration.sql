-- TAC-9: order consent replica updates by event time.
ALTER TABLE "UserConsentState" ADD COLUMN "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
