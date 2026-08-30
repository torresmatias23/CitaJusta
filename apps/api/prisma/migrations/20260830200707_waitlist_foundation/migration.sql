-- CreateTable
CREATE TABLE "estados_lista_espera" (
    "id" UUID NOT NULL,
    "codigo" VARCHAR(60) NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "descripcion" TEXT,
    "es_final" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "estados_lista_espera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prioridades" (
    "id" UUID NOT NULL,
    "institucion_id" UUID,
    "codigo" VARCHAR(60) NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "nivel" INTEGER NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "prioridades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listas_espera" (
    "id" UUID NOT NULL,
    "institucion_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "servicio_id" UUID NOT NULL,
    "sede_id" UUID,
    "prioridad_id" UUID NOT NULL,
    "estado_id" UUID NOT NULL,
    "fecha_ingreso_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_limite" DATE,
    "permite_otras_sedes" BOOLEAN NOT NULL DEFAULT false,
    "aviso_minimo_minutos" INTEGER NOT NULL DEFAULT 0,
    "observacion_operativa" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "listas_espera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preferencias_lista_espera" (
    "id" UUID NOT NULL,
    "lista_espera_id" UUID NOT NULL,
    "acepta_cualquier_profesional" BOOLEAN NOT NULL DEFAULT true,
    "acepta_cualquier_hora" BOOLEAN NOT NULL DEFAULT false,
    "acepta_fin_de_semana" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preferencias_lista_espera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dias_preferencia_lista_espera" (
    "id" UUID NOT NULL,
    "preferencia_id" UUID NOT NULL,
    "dia_semana" INTEGER NOT NULL,

    CONSTRAINT "dias_preferencia_lista_espera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rangos_horarios_lista_espera" (
    "id" UUID NOT NULL,
    "preferencia_id" UUID NOT NULL,
    "hora_inicio" TIME(6) NOT NULL,
    "hora_fin" TIME(6) NOT NULL,

    CONSTRAINT "rangos_horarios_lista_espera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sedes_preferidas_lista_espera" (
    "lista_espera_id" UUID NOT NULL,
    "sede_id" UUID NOT NULL,
    "orden_preferencia" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sedes_preferidas_lista_espera_pkey" PRIMARY KEY ("lista_espera_id","sede_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "estados_lista_espera_codigo_key" ON "estados_lista_espera"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "prioridades_institucion_id_codigo_key" ON "prioridades"("institucion_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "prioridades_institucion_id_nivel_key" ON "prioridades"("institucion_id", "nivel");

-- CreateIndex
CREATE INDEX "listas_espera_institucion_id_idx" ON "listas_espera"("institucion_id");

-- CreateIndex
CREATE INDEX "listas_espera_usuario_id_idx" ON "listas_espera"("usuario_id");

-- CreateIndex
CREATE INDEX "listas_espera_servicio_id_idx" ON "listas_espera"("servicio_id");

-- CreateIndex
CREATE INDEX "listas_espera_sede_id_idx" ON "listas_espera"("sede_id");

-- CreateIndex
CREATE INDEX "listas_espera_prioridad_id_idx" ON "listas_espera"("prioridad_id");

-- CreateIndex
CREATE INDEX "listas_espera_estado_id_idx" ON "listas_espera"("estado_id");

-- CreateIndex
CREATE INDEX "listas_espera_fecha_ingreso_at_idx" ON "listas_espera"("fecha_ingreso_at");

-- CreateIndex
CREATE UNIQUE INDEX "preferencias_lista_espera_lista_espera_id_key" ON "preferencias_lista_espera"("lista_espera_id");

-- CreateIndex
CREATE UNIQUE INDEX "dias_preferencia_lista_espera_preferencia_id_dia_semana_key" ON "dias_preferencia_lista_espera"("preferencia_id", "dia_semana");

-- CreateIndex
CREATE INDEX "rangos_horarios_lista_espera_preferencia_id_idx" ON "rangos_horarios_lista_espera"("preferencia_id");

-- CreateIndex
CREATE UNIQUE INDEX "sedes_preferidas_lista_espera_lista_espera_id_orden_prefere_key" ON "sedes_preferidas_lista_espera"("lista_espera_id", "orden_preferencia");

-- AddForeignKey
ALTER TABLE "prioridades" ADD CONSTRAINT "prioridades_institucion_id_fkey" FOREIGN KEY ("institucion_id") REFERENCES "instituciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listas_espera" ADD CONSTRAINT "listas_espera_institucion_id_fkey" FOREIGN KEY ("institucion_id") REFERENCES "instituciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listas_espera" ADD CONSTRAINT "listas_espera_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listas_espera" ADD CONSTRAINT "listas_espera_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listas_espera" ADD CONSTRAINT "listas_espera_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listas_espera" ADD CONSTRAINT "listas_espera_prioridad_id_fkey" FOREIGN KEY ("prioridad_id") REFERENCES "prioridades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listas_espera" ADD CONSTRAINT "listas_espera_estado_id_fkey" FOREIGN KEY ("estado_id") REFERENCES "estados_lista_espera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preferencias_lista_espera" ADD CONSTRAINT "preferencias_lista_espera_lista_espera_id_fkey" FOREIGN KEY ("lista_espera_id") REFERENCES "listas_espera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dias_preferencia_lista_espera" ADD CONSTRAINT "dias_preferencia_lista_espera_preferencia_id_fkey" FOREIGN KEY ("preferencia_id") REFERENCES "preferencias_lista_espera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rangos_horarios_lista_espera" ADD CONSTRAINT "rangos_horarios_lista_espera_preferencia_id_fkey" FOREIGN KEY ("preferencia_id") REFERENCES "preferencias_lista_espera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sedes_preferidas_lista_espera" ADD CONSTRAINT "sedes_preferidas_lista_espera_lista_espera_id_fkey" FOREIGN KEY ("lista_espera_id") REFERENCES "listas_espera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sedes_preferidas_lista_espera" ADD CONSTRAINT "sedes_preferidas_lista_espera_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
