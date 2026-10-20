ALTER TABLE "usuarios"
  ADD COLUMN "emails_citas_habilitados" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "emails_ofertas_habilitados" BOOLEAN NOT NULL DEFAULT true;
