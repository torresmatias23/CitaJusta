-- CreateEnum
CREATE TYPE "estado_entrega_email" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "entregas_email_notificacion" (
    "id" UUID NOT NULL,
    "notificacion_id" UUID NOT NULL,
    "estado" "estado_entrega_email" NOT NULL DEFAULT 'PENDING',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "proximo_intento_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bloqueada_hasta" TIMESTAMP(3),
    "token_reclamo" UUID,
    "primer_intento_at" TIMESTAMP(3),
    "ultimo_intento_at" TIMESTAMP(3),
    "enviada_at" TIMESTAMP(3),
    "proveedor_mensaje_id" VARCHAR(100),
    "ultimo_error_codigo" VARCHAR(80),
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entregas_email_notificacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entregas_email_notificacion_notificacion_id_key" ON "entregas_email_notificacion"("notificacion_id");

-- CreateIndex
CREATE INDEX "entregas_email_notificacion_estado_proximo_intento_at_id_idx" ON "entregas_email_notificacion"("estado", "proximo_intento_at", "id");

-- CreateIndex
CREATE INDEX "entregas_email_notificacion_estado_bloqueada_hasta_id_idx" ON "entregas_email_notificacion"("estado", "bloqueada_hasta", "id");

-- AddForeignKey
ALTER TABLE "entregas_email_notificacion" ADD CONSTRAINT "entregas_email_notificacion_notificacion_id_fkey" FOREIGN KEY ("notificacion_id") REFERENCES "notificaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
