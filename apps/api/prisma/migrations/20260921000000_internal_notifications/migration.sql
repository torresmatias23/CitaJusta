CREATE TYPE "tipo_notificacion" AS ENUM ('APPOINTMENT_BOOKED', 'APPOINTMENT_CANCELLED', 'WAITLIST_ENTERED', 'WAITLIST_WITHDRAWN', 'OFFER_CREATED', 'OFFER_ACCEPTED', 'OFFER_REJECTED', 'OFFER_EXPIRED');
CREATE TYPE "recurso_notificacion" AS ENUM ('APPOINTMENT', 'WAITLIST_ENTRY', 'OFFER');

CREATE TABLE "notificaciones" (
  "id" UUID NOT NULL,
  "destinatario_usuario_id" UUID NOT NULL,
  "tipo" "tipo_notificacion" NOT NULL,
  "institucion_id" UUID,
  "sede_id" UUID,
  "tipo_recurso" "recurso_notificacion" NOT NULL,
  "recurso_id" UUID,
  "clave_deduplicacion" VARCHAR(140) NOT NULL,
  "datos" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leida_at" TIMESTAMP(3),
  CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notificaciones_destinatario_usuario_id_fkey" FOREIGN KEY ("destinatario_usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "notificaciones_sede_institucion_check" CHECK ("sede_id" IS NULL OR "institucion_id" IS NOT NULL)
);
CREATE UNIQUE INDEX "notificaciones_destinatario_usuario_id_clave_deduplicacion_key" ON "notificaciones"("destinatario_usuario_id", "clave_deduplicacion");
CREATE INDEX "notificaciones_destinatario_usuario_id_created_at_id_idx" ON "notificaciones"("destinatario_usuario_id", "created_at" DESC, "id" DESC);
CREATE INDEX "notificaciones_destinatario_usuario_id_leida_at_created_at_id_idx" ON "notificaciones"("destinatario_usuario_id", "leida_at", "created_at" DESC, "id" DESC);
