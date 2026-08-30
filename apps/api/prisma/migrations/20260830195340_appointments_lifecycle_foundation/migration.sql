-- CreateEnum
CREATE TYPE "origen_cita" AS ENUM ('WEB', 'ESCRITORIO', 'REASIGNACION', 'SISTEMA');

-- CreateEnum
CREATE TYPE "canal_notificacion" AS ENUM ('INTERNA', 'EMAIL', 'SMS', 'WHATSAPP');

-- CreateTable
CREATE TABLE "estados_cita" (
    "id" UUID NOT NULL,
    "codigo" VARCHAR(60) NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "descripcion" TEXT,
    "es_final" BOOLEAN NOT NULL DEFAULT false,
    "permite_cancelar" BOOLEAN NOT NULL DEFAULT true,
    "permite_confirmar" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "estados_cita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citas" (
    "id" UUID NOT NULL,
    "institucion_id" UUID NOT NULL,
    "sede_id" UUID NOT NULL,
    "servicio_id" UUID NOT NULL,
    "profesional_id" UUID NOT NULL,
    "box_id" UUID,
    "cupo_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "estado_id" UUID NOT NULL,
    "origen" "origen_cita" NOT NULL,
    "inicio_at" TIMESTAMP(6) NOT NULL,
    "fin_at" TIMESTAMP(6) NOT NULL,
    "observacion_operativa" TEXT,
    "creada_por_usuario_id" UUID,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "citas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historial_cambios_cita" (
    "id" UUID NOT NULL,
    "cita_id" UUID NOT NULL,
    "estado_anterior_id" UUID,
    "estado_nuevo_id" UUID NOT NULL,
    "usuario_anterior_id" UUID,
    "usuario_nuevo_id" UUID,
    "actor_usuario_id" UUID,
    "motivo" VARCHAR(200),
    "detalle_json" JSONB,
    "ocurrido_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historial_cambios_cita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "motivos_cancelacion" (
    "id" UUID NOT NULL,
    "institucion_id" UUID,
    "codigo" VARCHAR(60) NOT NULL,
    "nombre" VARCHAR(160) NOT NULL,
    "descripcion" TEXT,
    "aplica_usuario" BOOLEAN NOT NULL DEFAULT true,
    "aplica_institucion" BOOLEAN NOT NULL DEFAULT true,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "motivos_cancelacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancelaciones" (
    "id" UUID NOT NULL,
    "cita_id" UUID NOT NULL,
    "motivo_cancelacion_id" UUID,
    "cancelada_por_usuario_id" UUID,
    "comentario" TEXT,
    "libera_cupo" BOOLEAN NOT NULL DEFAULT true,
    "cancelada_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cancelaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "confirmaciones" (
    "id" UUID NOT NULL,
    "cita_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "confirmada" BOOLEAN NOT NULL,
    "canal" "canal_notificacion" NOT NULL DEFAULT 'INTERNA',
    "confirmada_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comentario" TEXT,

    CONSTRAINT "confirmaciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "estados_cita_codigo_key" ON "estados_cita"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "citas_cupo_id_key" ON "citas"("cupo_id");

-- CreateIndex
CREATE INDEX "citas_institucion_id_idx" ON "citas"("institucion_id");

-- CreateIndex
CREATE INDEX "citas_sede_id_idx" ON "citas"("sede_id");

-- CreateIndex
CREATE INDEX "citas_servicio_id_idx" ON "citas"("servicio_id");

-- CreateIndex
CREATE INDEX "citas_profesional_id_idx" ON "citas"("profesional_id");

-- CreateIndex
CREATE INDEX "citas_usuario_id_idx" ON "citas"("usuario_id");

-- CreateIndex
CREATE INDEX "citas_estado_id_idx" ON "citas"("estado_id");

-- CreateIndex
CREATE INDEX "citas_inicio_at_idx" ON "citas"("inicio_at");

-- CreateIndex
CREATE INDEX "citas_usuario_id_inicio_at_idx" ON "citas"("usuario_id", "inicio_at");

-- CreateIndex
CREATE INDEX "citas_profesional_id_inicio_at_idx" ON "citas"("profesional_id", "inicio_at");

-- CreateIndex
CREATE INDEX "historial_cambios_cita_cita_id_idx" ON "historial_cambios_cita"("cita_id");

-- CreateIndex
CREATE INDEX "historial_cambios_cita_estado_nuevo_id_idx" ON "historial_cambios_cita"("estado_nuevo_id");

-- CreateIndex
CREATE INDEX "historial_cambios_cita_ocurrido_at_idx" ON "historial_cambios_cita"("ocurrido_at");

-- CreateIndex
CREATE UNIQUE INDEX "motivos_cancelacion_institucion_id_codigo_key" ON "motivos_cancelacion"("institucion_id", "codigo");

-- CreateIndex
CREATE INDEX "cancelaciones_cita_id_idx" ON "cancelaciones"("cita_id");

-- CreateIndex
CREATE INDEX "cancelaciones_cancelada_at_idx" ON "cancelaciones"("cancelada_at");

-- CreateIndex
CREATE INDEX "confirmaciones_cita_id_idx" ON "confirmaciones"("cita_id");

-- CreateIndex
CREATE INDEX "confirmaciones_usuario_id_idx" ON "confirmaciones"("usuario_id");

-- CreateIndex
CREATE INDEX "confirmaciones_confirmada_at_idx" ON "confirmaciones"("confirmada_at");

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_institucion_id_fkey" FOREIGN KEY ("institucion_id") REFERENCES "instituciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "profesionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_box_id_fkey" FOREIGN KEY ("box_id") REFERENCES "boxes_atencion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_cupo_id_fkey" FOREIGN KEY ("cupo_id") REFERENCES "cupos_agenda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_estado_id_fkey" FOREIGN KEY ("estado_id") REFERENCES "estados_cita"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_creada_por_usuario_id_fkey" FOREIGN KEY ("creada_por_usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_cambios_cita" ADD CONSTRAINT "historial_cambios_cita_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_cambios_cita" ADD CONSTRAINT "historial_cambios_cita_estado_anterior_id_fkey" FOREIGN KEY ("estado_anterior_id") REFERENCES "estados_cita"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_cambios_cita" ADD CONSTRAINT "historial_cambios_cita_estado_nuevo_id_fkey" FOREIGN KEY ("estado_nuevo_id") REFERENCES "estados_cita"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_cambios_cita" ADD CONSTRAINT "historial_cambios_cita_usuario_anterior_id_fkey" FOREIGN KEY ("usuario_anterior_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_cambios_cita" ADD CONSTRAINT "historial_cambios_cita_usuario_nuevo_id_fkey" FOREIGN KEY ("usuario_nuevo_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_cambios_cita" ADD CONSTRAINT "historial_cambios_cita_actor_usuario_id_fkey" FOREIGN KEY ("actor_usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motivos_cancelacion" ADD CONSTRAINT "motivos_cancelacion_institucion_id_fkey" FOREIGN KEY ("institucion_id") REFERENCES "instituciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancelaciones" ADD CONSTRAINT "cancelaciones_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancelaciones" ADD CONSTRAINT "cancelaciones_motivo_cancelacion_id_fkey" FOREIGN KEY ("motivo_cancelacion_id") REFERENCES "motivos_cancelacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancelaciones" ADD CONSTRAINT "cancelaciones_cancelada_por_usuario_id_fkey" FOREIGN KEY ("cancelada_por_usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "confirmaciones" ADD CONSTRAINT "confirmaciones_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "confirmaciones" ADD CONSTRAINT "confirmaciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
