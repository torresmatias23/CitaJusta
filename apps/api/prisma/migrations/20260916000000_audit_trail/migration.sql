CREATE TYPE "tipo_actor_auditoria" AS ENUM ('USUARIO', 'SISTEMA');
CREATE TYPE "resultado_auditoria" AS ENUM ('EXITO', 'FALLO');

CREATE TABLE "eventos_auditoria" (
  "id" UUID NOT NULL,
  "institucion_id" UUID,
  "sede_id" UUID,
  "actor_usuario_id" UUID,
  "tipo_actor" "tipo_actor_auditoria" NOT NULL,
  "codigo_accion" VARCHAR(80) NOT NULL,
  "tipo_recurso" VARCHAR(60) NOT NULL,
  "recurso_id" UUID,
  "resultado" "resultado_auditoria" NOT NULL,
  "estado_anterior" VARCHAR(60),
  "estado_nuevo" VARCHAR(60),
  "codigo_motivo" VARCHAR(80),
  "ocurrido_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "eventos_auditoria_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "eventos_auditoria_sede_institucion_check" CHECK ("sede_id" IS NULL OR "institucion_id" IS NOT NULL)
);

CREATE INDEX "eventos_auditoria_institucion_id_ocurrido_at_id_idx" ON "eventos_auditoria"("institucion_id", "ocurrido_at" DESC, "id" DESC);
CREATE INDEX "eventos_auditoria_sede_id_ocurrido_at_id_idx" ON "eventos_auditoria"("sede_id", "ocurrido_at" DESC, "id" DESC);
CREATE INDEX "eventos_auditoria_actor_usuario_id_ocurrido_at_id_idx" ON "eventos_auditoria"("actor_usuario_id", "ocurrido_at" DESC, "id" DESC);
CREATE INDEX "eventos_auditoria_codigo_accion_ocurrido_at_id_idx" ON "eventos_auditoria"("codigo_accion", "ocurrido_at" DESC, "id" DESC);
CREATE INDEX "eventos_auditoria_tipo_recurso_recurso_id_ocurrido_at_id_idx" ON "eventos_auditoria"("tipo_recurso", "recurso_id", "ocurrido_at" DESC, "id" DESC);
CREATE INDEX "eventos_auditoria_ocurrido_at_id_idx" ON "eventos_auditoria"("ocurrido_at" DESC, "id" DESC);
