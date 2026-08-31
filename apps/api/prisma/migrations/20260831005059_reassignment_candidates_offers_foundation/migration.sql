-- CreateEnum
CREATE TYPE "estado_reasignacion" AS ENUM ('PENDIENTE', 'EVALUANDO', 'OFERTANDO', 'COMPLETADA', 'AGOTADA', 'CANCELADA', 'FALLIDA');

-- CreateEnum
CREATE TYPE "resultado_evaluacion_candidato" AS ENUM ('PENDIENTE', 'ELEGIBLE', 'EXCLUIDO');

-- CreateEnum
CREATE TYPE "estado_oferta" AS ENUM ('PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'EXPIRADA', 'INVALIDADA', 'CANCELADA');

-- CreateTable
CREATE TABLE "reasignaciones" (
    "id" UUID NOT NULL,
    "institucion_id" UUID NOT NULL,
    "cancelacion_origen_id" UUID NOT NULL,
    "cita_id" UUID NOT NULL,
    "cupo_id" UUID NOT NULL,
    "servicio_id" UUID NOT NULL,
    "usuario_origen_id" UUID NOT NULL,
    "estado" "estado_reasignacion" NOT NULL DEFAULT 'PENDIENTE',
    "version_cupo_inicial" INTEGER NOT NULL,
    "regla_codigo" VARCHAR(60) NOT NULL,
    "version_scoring" VARCHAR(80) NOT NULL,
    "criterios_snapshot" JSONB NOT NULL,
    "motivo_cierre_codigo" VARCHAR(80),
    "detalle_cierre" JSONB,
    "version_lock" INTEGER NOT NULL DEFAULT 0,
    "detectada_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "iniciada_at" TIMESTAMP(6),
    "finalizada_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reasignaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidatos_reasignacion" (
    "id" UUID NOT NULL,
    "reasignacion_id" UUID NOT NULL,
    "lista_espera_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "prioridad_id" UUID NOT NULL,
    "estado_evaluacion" "resultado_evaluacion_candidato" NOT NULL DEFAULT 'PENDIENTE',
    "prioridad_nivel_snapshot" INTEGER NOT NULL,
    "entrada_actualizada_at_snapshot" TIMESTAMP(6) NOT NULL,
    "score_total" DECIMAL(18,6),
    "posicion_ranking" INTEGER,
    "factores_score" JSONB NOT NULL DEFAULT '[]',
    "contexto_evaluacion" JSONB NOT NULL DEFAULT '{}',
    "motivo_exclusion_codigo" VARCHAR(80),
    "detalle_exclusion" JSONB,
    "evaluado_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidatos_reasignacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ofertas_cita" (
    "id" UUID NOT NULL,
    "reasignacion_id" UUID NOT NULL,
    "candidato_id" UUID NOT NULL,
    "cupo_id" UUID NOT NULL,
    "numero_intento" INTEGER NOT NULL,
    "estado" "estado_oferta" NOT NULL DEFAULT 'PENDIENTE',
    "version_cupo_esperada" INTEGER NOT NULL,
    "respondida_por_usuario_id" UUID,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_at" TIMESTAMP(6) NOT NULL,
    "respondida_at" TIMESTAMP(6),
    "resuelta_at" TIMESTAMP(6),
    "motivo_resolucion_codigo" VARCHAR(80),
    "detalle_resolucion" JSONB,
    "version_lock" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ofertas_cita_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reasignaciones_cancelacion_origen_id_key" ON "reasignaciones"("cancelacion_origen_id");

-- CreateIndex
CREATE INDEX "reasignaciones_institucion_id_estado_idx" ON "reasignaciones"("institucion_id", "estado");

-- CreateIndex
CREATE INDEX "reasignaciones_cupo_id_estado_idx" ON "reasignaciones"("cupo_id", "estado");

-- CreateIndex
CREATE INDEX "reasignaciones_cita_id_idx" ON "reasignaciones"("cita_id");

-- CreateIndex
CREATE INDEX "reasignaciones_servicio_id_idx" ON "reasignaciones"("servicio_id");

-- CreateIndex
CREATE INDEX "reasignaciones_detectada_at_idx" ON "reasignaciones"("detectada_at");

-- CreateIndex
CREATE UNIQUE INDEX "reasignaciones_id_cupo_id_key" ON "reasignaciones"("id", "cupo_id");

-- CreateIndex
CREATE UNIQUE INDEX "reasignaciones_cupo_id_activa_key" ON "reasignaciones"("cupo_id") WHERE "estado" IN ('PENDIENTE', 'EVALUANDO', 'OFERTANDO');

-- CreateIndex
CREATE INDEX "candidatos_reasignacion_reasignacion_id_estado_evaluacion_p_idx" ON "candidatos_reasignacion"("reasignacion_id", "estado_evaluacion", "posicion_ranking");

-- CreateIndex
CREATE INDEX "candidatos_reasignacion_lista_espera_id_idx" ON "candidatos_reasignacion"("lista_espera_id");

-- CreateIndex
CREATE INDEX "candidatos_reasignacion_usuario_id_idx" ON "candidatos_reasignacion"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "candidatos_reasignacion_reasignacion_id_lista_espera_id_key" ON "candidatos_reasignacion"("reasignacion_id", "lista_espera_id");

-- CreateIndex
CREATE UNIQUE INDEX "candidatos_reasignacion_reasignacion_id_posicion_ranking_key" ON "candidatos_reasignacion"("reasignacion_id", "posicion_ranking");

-- CreateIndex
CREATE UNIQUE INDEX "candidatos_reasignacion_id_reasignacion_id_key" ON "candidatos_reasignacion"("id", "reasignacion_id");

-- AddCheckConstraint
ALTER TABLE "candidatos_reasignacion" ADD CONSTRAINT "candidatos_reasignacion_posicion_ranking_check" CHECK ("posicion_ranking" IS NULL OR "posicion_ranking" > 0);

-- AddCheckConstraint
ALTER TABLE "candidatos_reasignacion" ADD CONSTRAINT "candidatos_reasignacion_estado_evaluacion_check" CHECK (
    "estado_evaluacion" = 'PENDIENTE'
    OR (
        "estado_evaluacion" = 'ELEGIBLE'
        AND "score_total" IS NOT NULL
        AND "posicion_ranking" IS NOT NULL
        AND "motivo_exclusion_codigo" IS NULL
        AND "evaluado_at" IS NOT NULL
    )
    OR (
        "estado_evaluacion" = 'EXCLUIDO'
        AND "posicion_ranking" IS NULL
        AND "motivo_exclusion_codigo" IS NOT NULL
        AND "evaluado_at" IS NOT NULL
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "ofertas_cita_candidato_id_key" ON "ofertas_cita"("candidato_id");

-- CreateIndex
CREATE INDEX "ofertas_cita_reasignacion_id_estado_numero_intento_idx" ON "ofertas_cita"("reasignacion_id", "estado", "numero_intento");

-- CreateIndex
CREATE INDEX "ofertas_cita_estado_expira_at_idx" ON "ofertas_cita"("estado", "expira_at");

-- CreateIndex
CREATE INDEX "ofertas_cita_cupo_id_idx" ON "ofertas_cita"("cupo_id");

-- CreateIndex
CREATE UNIQUE INDEX "ofertas_cita_reasignacion_id_numero_intento_key" ON "ofertas_cita"("reasignacion_id", "numero_intento");

-- CreateIndex
CREATE UNIQUE INDEX "ofertas_cita_reasignacion_activa_key" ON "ofertas_cita"("reasignacion_id") WHERE "estado" IN ('PENDIENTE', 'ACEPTADA');

-- CreateIndex
CREATE UNIQUE INDEX "ofertas_cita_cupo_pendiente_key" ON "ofertas_cita"("cupo_id") WHERE "estado" = 'PENDIENTE';

-- AddCheckConstraint
ALTER TABLE "ofertas_cita" ADD CONSTRAINT "ofertas_cita_numero_intento_check" CHECK ("numero_intento" > 0);

-- AddCheckConstraint
ALTER TABLE "ofertas_cita" ADD CONSTRAINT "ofertas_cita_expiracion_check" CHECK ("expira_at" > "created_at");

-- AddForeignKey
ALTER TABLE "reasignaciones" ADD CONSTRAINT "reasignaciones_institucion_id_fkey" FOREIGN KEY ("institucion_id") REFERENCES "instituciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reasignaciones" ADD CONSTRAINT "reasignaciones_cancelacion_origen_id_fkey" FOREIGN KEY ("cancelacion_origen_id") REFERENCES "cancelaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reasignaciones" ADD CONSTRAINT "reasignaciones_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reasignaciones" ADD CONSTRAINT "reasignaciones_cupo_id_fkey" FOREIGN KEY ("cupo_id") REFERENCES "cupos_agenda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reasignaciones" ADD CONSTRAINT "reasignaciones_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reasignaciones" ADD CONSTRAINT "reasignaciones_usuario_origen_id_fkey" FOREIGN KEY ("usuario_origen_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidatos_reasignacion" ADD CONSTRAINT "candidatos_reasignacion_reasignacion_id_fkey" FOREIGN KEY ("reasignacion_id") REFERENCES "reasignaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidatos_reasignacion" ADD CONSTRAINT "candidatos_reasignacion_lista_espera_id_fkey" FOREIGN KEY ("lista_espera_id") REFERENCES "listas_espera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidatos_reasignacion" ADD CONSTRAINT "candidatos_reasignacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidatos_reasignacion" ADD CONSTRAINT "candidatos_reasignacion_prioridad_id_fkey" FOREIGN KEY ("prioridad_id") REFERENCES "prioridades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ofertas_cita" ADD CONSTRAINT "ofertas_cita_reasignacion_id_cupo_id_fkey" FOREIGN KEY ("reasignacion_id", "cupo_id") REFERENCES "reasignaciones"("id", "cupo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ofertas_cita" ADD CONSTRAINT "ofertas_cita_candidato_id_reasignacion_id_fkey" FOREIGN KEY ("candidato_id", "reasignacion_id") REFERENCES "candidatos_reasignacion"("id", "reasignacion_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ofertas_cita" ADD CONSTRAINT "ofertas_cita_respondida_por_usuario_id_fkey" FOREIGN KEY ("respondida_por_usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
