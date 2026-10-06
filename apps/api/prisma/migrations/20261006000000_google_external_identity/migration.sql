-- CreateEnum
CREATE TYPE "proveedor_identidad_externa" AS ENUM ('GOOGLE');

-- AlterTable
ALTER TABLE "usuarios" ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "identidades_externas" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "proveedor" "proveedor_identidad_externa" NOT NULL,
    "sujeto_proveedor" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identidades_externas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "identidades_externas_proveedor_sujeto_proveedor_key" ON "identidades_externas"("proveedor", "sujeto_proveedor");

-- CreateIndex
CREATE UNIQUE INDEX "identidades_externas_usuario_id_proveedor_key" ON "identidades_externas"("usuario_id", "proveedor");

-- AddForeignKey
ALTER TABLE "identidades_externas" ADD CONSTRAINT "identidades_externas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
