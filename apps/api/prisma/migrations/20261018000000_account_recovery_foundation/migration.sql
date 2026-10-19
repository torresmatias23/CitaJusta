CREATE TABLE "recuperaciones_cuenta" (
  "id" UUID NOT NULL,
  "usuario_id" UUID NOT NULL,
  "token_hash" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expira_at" TIMESTAMP(3) NOT NULL,
  "consumida_at" TIMESTAMP(3),
  "invalidada_at" TIMESTAMP(3),
  "contenido_cifrado" BYTEA,
  "clave_id" VARCHAR(40),
  "nonce" BYTEA,
  "tag" BYTEA,
  "estado_entrega" "estado_entrega_email" NOT NULL DEFAULT 'PENDING',
  "intentos" INTEGER NOT NULL DEFAULT 0,
  "proximo_intento_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "bloqueada_hasta" TIMESTAMP(3),
  "token_reclamo" UUID,
  "proveedor_mensaje_id" VARCHAR(100),
  "ultimo_error_codigo" VARCHAR(80),
  CONSTRAINT "recuperaciones_cuenta_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recuperaciones_cuenta_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "recuperaciones_cuenta_vigencia_check" CHECK ("expira_at" > "created_at" AND "intentos" >= 0),
  CONSTRAINT "recuperaciones_cuenta_cifrado_check" CHECK (
    ("contenido_cifrado" IS NULL AND "clave_id" IS NULL AND "nonce" IS NULL AND "tag" IS NULL) OR
    ("contenido_cifrado" IS NOT NULL AND "clave_id" IS NOT NULL AND octet_length("nonce") = 12 AND octet_length("tag") = 16 AND "nonce" IS NOT NULL AND "tag" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "recuperaciones_cuenta_token_hash_key" ON "recuperaciones_cuenta"("token_hash");
-- Expired outstanding rows are invalidated atomically before a replacement is created.
CREATE UNIQUE INDEX "recuperaciones_cuenta_usuario_abierta_key" ON "recuperaciones_cuenta"("usuario_id") WHERE "consumida_at" IS NULL AND "invalidada_at" IS NULL;
CREATE INDEX "recuperaciones_cuenta_usuario_id_idx" ON "recuperaciones_cuenta"("usuario_id");
CREATE INDEX "recuperaciones_cuenta_estado_entrega_proximo_intento_at_id_idx" ON "recuperaciones_cuenta"("estado_entrega", "proximo_intento_at", "id");
CREATE INDEX "recuperaciones_cuenta_expira_at_idx" ON "recuperaciones_cuenta"("expira_at");

CREATE TABLE "limites_recuperacion_cuenta" (
  "email_hmac" VARCHAR(64) NOT NULL,
  "ventana_inicio_at" TIMESTAMP(3) NOT NULL,
  "solicitudes" INTEGER NOT NULL,
  "ultima_admitida_at" TIMESTAMP(3) NOT NULL,
  "expira_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "limites_recuperacion_cuenta_pkey" PRIMARY KEY ("email_hmac"),
  CONSTRAINT "limites_recuperacion_cuenta_contador_check" CHECK ("solicitudes" >= 0 AND "expira_at" > "ventana_inicio_at")
);
CREATE INDEX "limites_recuperacion_cuenta_expira_at_idx" ON "limites_recuperacion_cuenta"("expira_at");
