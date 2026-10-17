-- Runs only when the dedicated Docker volume is initialized for the first time.
-- Infrastructure marker, not a domain table or Prisma migration.
COMMENT ON DATABASE citajusta_docker IS 'citajusta-capstone-docker-v1';
