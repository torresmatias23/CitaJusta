-- CreateEnum
CREATE TYPE "estado_profesional" AS ENUM ('ACTIVO', 'INACTIVO', 'SUSPENDIDO');

-- CreateTable
CREATE TABLE "categorias_servicio" (
    "id" UUID NOT NULL,
    "institucion_id" UUID NOT NULL,
    "nombre" VARCHAR(140) NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categorias_servicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicios" (
    "id" UUID NOT NULL,
    "institucion_id" UUID NOT NULL,
    "categoria_id" UUID,
    "codigo" VARCHAR(50) NOT NULL,
    "nombre" VARCHAR(180) NOT NULL,
    "descripcion" TEXT,
    "duracion_minutos" INTEGER NOT NULL,
    "anticipacion_minima_minutos" INTEGER NOT NULL DEFAULT 0,
    "anticipacion_maxima_dias" INTEGER,
    "permite_lista_espera" BOOLEAN NOT NULL DEFAULT true,
    "requiere_confirmacion" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "servicios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicios_sedes" (
    "servicio_id" UUID NOT NULL,
    "sede_id" UUID NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "servicios_sedes_pkey" PRIMARY KEY ("servicio_id","sede_id")
);

-- CreateTable
CREATE TABLE "requisitos_servicio" (
    "id" UUID NOT NULL,
    "servicio_id" UUID NOT NULL,
    "nombre" VARCHAR(180) NOT NULL,
    "descripcion" TEXT,
    "obligatorio" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requisitos_servicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profesionales" (
    "id" UUID NOT NULL,
    "institucion_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "codigo_interno" VARCHAR(60),
    "titulo_o_funcion" VARCHAR(160),
    "descripcion" TEXT,
    "estado" "estado_profesional" NOT NULL DEFAULT 'ACTIVO',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "profesionales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profesionales_servicios" (
    "profesional_id" UUID NOT NULL,
    "servicio_id" UUID NOT NULL,
    "duracion_personalizada_minutos" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profesionales_servicios_pkey" PRIMARY KEY ("profesional_id","servicio_id")
);

-- CreateTable
CREATE TABLE "profesionales_sedes" (
    "profesional_id" UUID NOT NULL,
    "sede_id" UUID NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profesionales_sedes_pkey" PRIMARY KEY ("profesional_id","sede_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categorias_servicio_institucion_id_nombre_key" ON "categorias_servicio"("institucion_id", "nombre");

-- CreateIndex
CREATE INDEX "servicios_institucion_id_idx" ON "servicios"("institucion_id");

-- CreateIndex
CREATE INDEX "servicios_categoria_id_idx" ON "servicios"("categoria_id");

-- CreateIndex
CREATE INDEX "servicios_activo_idx" ON "servicios"("activo");

-- CreateIndex
CREATE UNIQUE INDEX "servicios_institucion_id_codigo_key" ON "servicios"("institucion_id", "codigo");

-- CreateIndex
CREATE INDEX "requisitos_servicio_servicio_id_idx" ON "requisitos_servicio"("servicio_id");

-- CreateIndex
CREATE INDEX "profesionales_estado_idx" ON "profesionales"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "profesionales_institucion_id_usuario_id_key" ON "profesionales"("institucion_id", "usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "profesionales_institucion_id_codigo_interno_key" ON "profesionales"("institucion_id", "codigo_interno");

-- AddForeignKey
ALTER TABLE "categorias_servicio" ADD CONSTRAINT "categorias_servicio_institucion_id_fkey" FOREIGN KEY ("institucion_id") REFERENCES "instituciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_institucion_id_fkey" FOREIGN KEY ("institucion_id") REFERENCES "instituciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios_sedes" ADD CONSTRAINT "servicios_sedes_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios_sedes" ADD CONSTRAINT "servicios_sedes_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisitos_servicio" ADD CONSTRAINT "requisitos_servicio_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profesionales" ADD CONSTRAINT "profesionales_institucion_id_fkey" FOREIGN KEY ("institucion_id") REFERENCES "instituciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profesionales" ADD CONSTRAINT "profesionales_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profesionales_servicios" ADD CONSTRAINT "profesionales_servicios_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "profesionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profesionales_servicios" ADD CONSTRAINT "profesionales_servicios_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profesionales_sedes" ADD CONSTRAINT "profesionales_sedes_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "profesionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profesionales_sedes" ADD CONSTRAINT "profesionales_sedes_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
