-- CreateEnum
CREATE TYPE "estrategia_ranking_reasignacion" AS ENUM ('PRIORITY_THEN_WAITING', 'WAITING_THEN_PRIORITY');

-- AlterTable
ALTER TABLE "instituciones" ADD COLUMN     "politica_reasignacion_actual_id" UUID;

-- AlterTable
ALTER TABLE "reasignaciones" ADD COLUMN     "politica_id" UUID;

-- CreateTable
CREATE TABLE "politicas_reasignacion" (
    "id" UUID NOT NULL,
    "institucion_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "estrategia_ranking" "estrategia_ranking_reasignacion" NOT NULL,
    "duracion_oferta_minutos" INTEGER NOT NULL,
    "creada_por_usuario_id" UUID NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "politicas_reasignacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "politicas_reasignacion_creada_por_usuario_id_idx" ON "politicas_reasignacion"("creada_por_usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "politicas_reasignacion_institucion_id_version_key" ON "politicas_reasignacion"("institucion_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "politicas_reasignacion_institucion_id_id_key" ON "politicas_reasignacion"("institucion_id", "id");

-- CreateIndex
CREATE INDEX "reasignaciones_institucion_id_politica_id_idx" ON "reasignaciones"("institucion_id", "politica_id");

-- AddForeignKey
ALTER TABLE "instituciones" ADD CONSTRAINT "instituciones_id_politica_reasignacion_actual_id_fkey" FOREIGN KEY ("id", "politica_reasignacion_actual_id") REFERENCES "politicas_reasignacion"("institucion_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "politicas_reasignacion" ADD CONSTRAINT "politicas_reasignacion_institucion_id_fkey" FOREIGN KEY ("institucion_id") REFERENCES "instituciones"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "politicas_reasignacion" ADD CONSTRAINT "politicas_reasignacion_creada_por_usuario_id_fkey" FOREIGN KEY ("creada_por_usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reasignaciones" ADD CONSTRAINT "reasignaciones_institucion_id_politica_id_fkey" FOREIGN KEY ("institucion_id", "politica_id") REFERENCES "politicas_reasignacion"("institucion_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Domain bounds are enforced even for writes outside the HTTP API.
ALTER TABLE "politicas_reasignacion"
  ADD CONSTRAINT "politicas_reasignacion_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "politicas_reasignacion_ttl_range" CHECK ("duracion_oferta_minutos" BETWEEN 1 AND 60);

-- A new configuration must INSERT a version, never rewrite its history.
CREATE FUNCTION "reject_reassignment_policy_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Reassignment policy versions are immutable' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER "reassignment_policy_immutable"
  BEFORE UPDATE ON "politicas_reasignacion"
  FOR EACH ROW EXECUTE FUNCTION "reject_reassignment_policy_update"();

-- Freeze the original association, including NULL for legacy processes.
CREATE FUNCTION "protect_reassignment_policy_link"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."politica_id" IS DISTINCT FROM OLD."politica_id"
     OR NEW."institucion_id" IS DISTINCT FROM OLD."institucion_id" THEN
    RAISE EXCEPTION 'Reassignment policy association is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "reassignment_policy_link_immutable"
  BEFORE UPDATE OF "politica_id", "institucion_id" ON "reasignaciones"
  FOR EACH ROW EXECUTE FUNCTION "protect_reassignment_policy_link"();
