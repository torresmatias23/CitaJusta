-- CreateEnum
CREATE TYPE "estado_usuario" AS ENUM ('PENDIENTE', 'ACTIVO', 'INACTIVO', 'BLOQUEADO');

-- CreateEnum
CREATE TYPE "alcance_rol" AS ENUM ('GLOBAL', 'INSTITUCION', 'SEDE');

-- CreateEnum
CREATE TYPE "estado_institucion" AS ENUM ('ACTIVA', 'INACTIVA', 'SUSPENDIDA');

-- CreateEnum
CREATE TYPE "estado_sede" AS ENUM ('ACTIVA', 'INACTIVA');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "nombres" VARCHAR(120) NOT NULL,
    "apellidos" VARCHAR(120) NOT NULL,
    "telefono" VARCHAR(30),
    "rut" VARCHAR(20),
    "estado" "estado_usuario" NOT NULL DEFAULT 'PENDIENTE',
    "email_verificado_at" TIMESTAMP(6),
    "ultimo_login_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "codigo" VARCHAR(80) NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "descripcion" TEXT,
    "alcance" "alcance_rol" NOT NULL,
    "es_sistema" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permisos" (
    "id" UUID NOT NULL,
    "codigo" VARCHAR(120) NOT NULL,
    "modulo" VARCHAR(80) NOT NULL,
    "accion" VARCHAR(80) NOT NULL,
    "descripcion" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permisos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instituciones" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(180) NOT NULL,
    "nombre_legal" VARCHAR(220),
    "identificador_tributario" VARCHAR(30),
    "email_contacto" VARCHAR(254),
    "telefono" VARCHAR(30),
    "zona_horaria" VARCHAR(80) NOT NULL DEFAULT 'America/Santiago',
    "estado" "estado_institucion" NOT NULL DEFAULT 'ACTIVA',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "instituciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sedes" (
    "id" UUID NOT NULL,
    "institucion_id" UUID NOT NULL,
    "codigo" VARCHAR(50) NOT NULL,
    "nombre" VARCHAR(160) NOT NULL,
    "direccion_linea1" VARCHAR(220),
    "direccion_linea2" VARCHAR(220),
    "comuna" VARCHAR(120),
    "region" VARCHAR(120),
    "pais" VARCHAR(80) NOT NULL DEFAULT 'Chile',
    "latitud" DECIMAL(10,7),
    "longitud" DECIMAL(10,7),
    "telefono" VARCHAR(30),
    "email" VARCHAR(254),
    "estado" "estado_sede" NOT NULL DEFAULT 'ACTIVA',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "sedes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios_roles" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "rol_id" UUID NOT NULL,
    "institucion_id" UUID,
    "sede_id" UUID,
    "asignado_por_usuario_id" UUID,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "valid_from" TIMESTAMP(6),
    "valid_to" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles_permisos" (
    "rol_id" UUID NOT NULL,
    "permiso_id" UUID NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_permisos_pkey" PRIMARY KEY ("rol_id","permiso_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_rut_key" ON "usuarios"("rut");

-- CreateIndex
CREATE INDEX "usuarios_estado_idx" ON "usuarios"("estado");

-- CreateIndex
CREATE INDEX "usuarios_apellidos_nombres_idx" ON "usuarios"("apellidos", "nombres");

-- CreateIndex
CREATE UNIQUE INDEX "roles_codigo_key" ON "roles"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "permisos_codigo_key" ON "permisos"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "permisos_modulo_accion_key" ON "permisos"("modulo", "accion");

-- CreateIndex
CREATE UNIQUE INDEX "instituciones_identificador_tributario_key" ON "instituciones"("identificador_tributario");

-- CreateIndex
CREATE INDEX "instituciones_nombre_idx" ON "instituciones"("nombre");

-- CreateIndex
CREATE INDEX "sedes_institucion_id_idx" ON "sedes"("institucion_id");

-- CreateIndex
CREATE INDEX "sedes_estado_idx" ON "sedes"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "sedes_institucion_id_codigo_key" ON "sedes"("institucion_id", "codigo");

-- CreateIndex
CREATE INDEX "usuarios_roles_usuario_id_idx" ON "usuarios_roles"("usuario_id");

-- CreateIndex
CREATE INDEX "usuarios_roles_rol_id_idx" ON "usuarios_roles"("rol_id");

-- CreateIndex
CREATE INDEX "usuarios_roles_institucion_id_idx" ON "usuarios_roles"("institucion_id");

-- CreateIndex
CREATE INDEX "usuarios_roles_sede_id_idx" ON "usuarios_roles"("sede_id");

-- AddForeignKey
ALTER TABLE "sedes" ADD CONSTRAINT "sedes_institucion_id_fkey" FOREIGN KEY ("institucion_id") REFERENCES "instituciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios_roles" ADD CONSTRAINT "usuarios_roles_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios_roles" ADD CONSTRAINT "usuarios_roles_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios_roles" ADD CONSTRAINT "usuarios_roles_institucion_id_fkey" FOREIGN KEY ("institucion_id") REFERENCES "instituciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios_roles" ADD CONSTRAINT "usuarios_roles_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios_roles" ADD CONSTRAINT "usuarios_roles_asignado_por_usuario_id_fkey" FOREIGN KEY ("asignado_por_usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles_permisos" ADD CONSTRAINT "roles_permisos_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles_permisos" ADD CONSTRAINT "roles_permisos_permiso_id_fkey" FOREIGN KEY ("permiso_id") REFERENCES "permisos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
