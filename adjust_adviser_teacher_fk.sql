-- Adjust foreign key to avoid blocking teacher deletes
DO $$
BEGIN
    -- Drop existing FK if present (name may vary across systems)
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_type='FOREIGN KEY' 
          AND table_name='sections' 
          AND constraint_name='sections_adviser_teacher_id_fkey'
    ) THEN
        ALTER TABLE sections DROP CONSTRAINT sections_adviser_teacher_id_fkey;
    END IF;
EXCEPTION WHEN undefined_table THEN
    -- sections table or constraint might not exist yet; ignore
    NULL;
END $$;

-- Recreate with ON DELETE SET NULL (idempotent: constraint name consistent)
ALTER TABLE sections
    ADD CONSTRAINT sections_adviser_teacher_id_fkey
    FOREIGN KEY (adviser_teacher_id)
    REFERENCES teachers(id)
    ON DELETE SET NULL;
