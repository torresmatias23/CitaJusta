-- CreateTable
CREATE TABLE "sesiones_autenticacion" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(255) NOT NULL,
    "expira_at" TIMESTAMP(6) NOT NULL,
    "revocada_at" TIMESTAMP(6),
    "ultimo_uso_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sesiones_autenticacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sesiones_autenticacion_usuario_id_idx" ON "sesiones_autenticacion"("usuario_id");

-- CreateIndex
CREATE INDEX "sesiones_autenticacion_expira_at_idx" ON "sesiones_autenticacion"("expira_at");

-- CreateIndex
CREATE INDEX "sesiones_autenticacion_revocada_at_idx" ON "sesiones_autenticacion"("revocada_at");

-- AddForeignKey
ALTER TABLE "sesiones_autenticacion" ADD CONSTRAINT "sesiones_autenticacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
