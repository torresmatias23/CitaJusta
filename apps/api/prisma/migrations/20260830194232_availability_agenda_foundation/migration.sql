-- CreateEnum
CREATE TYPE "origen_disponibilidad" AS ENUM ('HORARIO_BASE', 'EXCEPCION', 'MANUAL');

-- CreateEnum
CREATE TYPE "tipo_bloqueo_agenda" AS ENUM ('VACACIONES', 'LICENCIA', 'REUNION', 'MANTENCION', 'MANUAL', 'OTRO');

-- CreateEnum
CREATE TYPE "estado_cupo" AS ENUM ('DISPONIBLE', 'RESERVADO', 'BLOQUEADO', 'LIBERADO', 'EXPIRADO');

-- CreateTable
CREATE TABLE "boxes_atencion" (
    "id" UUID NOT NULL,
    "sede_id" UUID NOT NULL,
    "codigo" VARCHAR(50) NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "capacidad" INTEGER NOT NULL DEFAULT 1,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boxes_atencion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "horarios_profesional" (
    "id" UUID NOT NULL,
    "profesional_id" UUID NOT NULL,
    "sede_id" UUID NOT NULL,
    "box_id" UUID,
    "dia_semana" INTEGER NOT NULL,
    "hora_inicio" TIME(6) NOT NULL,
    "hora_fin" TIME(6) NOT NULL,
    "valido_desde" DATE NOT NULL,
    "valido_hasta" DATE,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "horarios_profesional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disponibilidades" (
    "id" UUID NOT NULL,
    "profesional_id" UUID NOT NULL,
    "servicio_id" UUID NOT NULL,
    "sede_id" UUID NOT NULL,
    "box_id" UUID,
    "fecha" DATE NOT NULL,
    "hora_inicio" TIME(6) NOT NULL,
    "hora_fin" TIME(6) NOT NULL,
    "origen" "origen_disponibilidad" NOT NULL DEFAULT 'HORARIO_BASE',
    "capacidad" INTEGER NOT NULL DEFAULT 1,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disponibilidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bloqueos_agenda" (
    "id" UUID NOT NULL,
    "institucion_id" UUID NOT NULL,
    "sede_id" UUID,
    "profesional_id" UUID,
    "box_id" UUID,
    "tipo" "tipo_bloqueo_agenda" NOT NULL,
    "inicio_at" TIMESTAMP(6) NOT NULL,
    "fin_at" TIMESTAMP(6) NOT NULL,
    "motivo" TEXT,
    "creado_por_usuario_id" UUID NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bloqueos_agenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feriados" (
    "id" UUID NOT NULL,
    "institucion_id" UUID NOT NULL,
    "sede_id" UUID,
    "fecha" DATE NOT NULL,
    "nombre" VARCHAR(180) NOT NULL,
    "bloquea_todo_el_dia" BOOLEAN NOT NULL DEFAULT true,
    "hora_inicio" TIME(6),
    "hora_fin" TIME(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feriados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cupos_agenda" (
    "id" UUID NOT NULL,
    "disponibilidad_id" UUID NOT NULL,
    "inicio_at" TIMESTAMP(6) NOT NULL,
    "fin_at" TIMESTAMP(6) NOT NULL,
    "estado" "estado_cupo" NOT NULL DEFAULT 'DISPONIBLE',
    "bloqueado_hasta_at" TIMESTAMP(6),
    "version_lock" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cupos_agenda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "boxes_atencion_sede_id_idx" ON "boxes_atencion"("sede_id");

-- CreateIndex
CREATE UNIQUE INDEX "boxes_atencion_sede_id_codigo_key" ON "boxes_atencion"("sede_id", "codigo");

-- CreateIndex
CREATE INDEX "horarios_profesional_profesional_id_idx" ON "horarios_profesional"("profesional_id");

-- CreateIndex
CREATE INDEX "horarios_profesional_sede_id_idx" ON "horarios_profesional"("sede_id");

-- CreateIndex
CREATE INDEX "horarios_profesional_profesional_id_sede_id_dia_semana_idx" ON "horarios_profesional"("profesional_id", "sede_id", "dia_semana");

-- CreateIndex
CREATE INDEX "disponibilidades_profesional_id_idx" ON "disponibilidades"("profesional_id");

-- CreateIndex
CREATE INDEX "disponibilidades_servicio_id_idx" ON "disponibilidades"("servicio_id");

-- CreateIndex
CREATE INDEX "disponibilidades_sede_id_idx" ON "disponibilidades"("sede_id");

-- CreateIndex
CREATE INDEX "disponibilidades_fecha_idx" ON "disponibilidades"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "disponibilidades_profesional_id_fecha_hora_inicio_hora_fin_key" ON "disponibilidades"("profesional_id", "fecha", "hora_inicio", "hora_fin");

-- CreateIndex
CREATE INDEX "bloqueos_agenda_institucion_id_idx" ON "bloqueos_agenda"("institucion_id");

-- CreateIndex
CREATE INDEX "bloqueos_agenda_sede_id_idx" ON "bloqueos_agenda"("sede_id");

-- CreateIndex
CREATE INDEX "bloqueos_agenda_profesional_id_idx" ON "bloqueos_agenda"("profesional_id");

-- CreateIndex
CREATE INDEX "bloqueos_agenda_inicio_at_fin_at_idx" ON "bloqueos_agenda"("inicio_at", "fin_at");

-- CreateIndex
CREATE INDEX "feriados_fecha_idx" ON "feriados"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "feriados_institucion_id_sede_id_fecha_nombre_key" ON "feriados"("institucion_id", "sede_id", "fecha", "nombre");

-- CreateIndex
CREATE INDEX "cupos_agenda_estado_idx" ON "cupos_agenda"("estado");

-- CreateIndex
CREATE INDEX "cupos_agenda_inicio_at_idx" ON "cupos_agenda"("inicio_at");

-- CreateIndex
CREATE UNIQUE INDEX "cupos_agenda_disponibilidad_id_inicio_at_fin_at_key" ON "cupos_agenda"("disponibilidad_id", "inicio_at", "fin_at");

-- AddForeignKey
ALTER TABLE "boxes_atencion" ADD CONSTRAINT "boxes_atencion_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horarios_profesional" ADD CONSTRAINT "horarios_profesional_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "profesionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horarios_profesional" ADD CONSTRAINT "horarios_profesional_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horarios_profesional" ADD CONSTRAINT "horarios_profesional_box_id_fkey" FOREIGN KEY ("box_id") REFERENCES "boxes_atencion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disponibilidades" ADD CONSTRAINT "disponibilidades_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "profesionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disponibilidades" ADD CONSTRAINT "disponibilidades_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disponibilidades" ADD CONSTRAINT "disponibilidades_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disponibilidades" ADD CONSTRAINT "disponibilidades_box_id_fkey" FOREIGN KEY ("box_id") REFERENCES "boxes_atencion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueos_agenda" ADD CONSTRAINT "bloqueos_agenda_institucion_id_fkey" FOREIGN KEY ("institucion_id") REFERENCES "instituciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueos_agenda" ADD CONSTRAINT "bloqueos_agenda_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueos_agenda" ADD CONSTRAINT "bloqueos_agenda_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "profesionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueos_agenda" ADD CONSTRAINT "bloqueos_agenda_box_id_fkey" FOREIGN KEY ("box_id") REFERENCES "boxes_atencion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueos_agenda" ADD CONSTRAINT "bloqueos_agenda_creado_por_usuario_id_fkey" FOREIGN KEY ("creado_por_usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feriados" ADD CONSTRAINT "feriados_institucion_id_fkey" FOREIGN KEY ("institucion_id") REFERENCES "instituciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feriados" ADD CONSTRAINT "feriados_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cupos_agenda" ADD CONSTRAINT "cupos_agenda_disponibilidad_id_fkey" FOREIGN KEY ("disponibilidad_id") REFERENCES "disponibilidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
