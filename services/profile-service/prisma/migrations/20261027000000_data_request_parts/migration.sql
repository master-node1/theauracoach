-- AlterTable
ALTER TABLE "DataRequest" ADD COLUMN     "alertedAt" TIMESTAMP(3),
ADD COLUMN     "dueAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DataRequestPart" (
    "requestId" UUID NOT NULL,
    "service" VARCHAR(40) NOT NULL,
    "key" TEXT,
    "rows" INTEGER,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "DataRequestPart_pkey" PRIMARY KEY ("requestId","service")
);

-- CreateIndex
CREATE INDEX "DataRequest_kind_status_dueAt_idx" ON "DataRequest"("kind", "status", "dueAt");

-- AddForeignKey
ALTER TABLE "DataRequestPart" ADD CONSTRAINT "DataRequestPart_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "DataRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
