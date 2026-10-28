-- CreateTable
CREATE TABLE "AccountState" (
    "userId" UUID NOT NULL,
    "pendingDeletion" BOOLEAN NOT NULL,
    "deletionDueAt" TIMESTAMP(3),
    "eventAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountState_pkey" PRIMARY KEY ("userId")
);
