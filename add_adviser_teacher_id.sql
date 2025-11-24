-- Add a foreign key to link a section's adviser to a teacher account
ALTER TABLE sections 
    ADD COLUMN IF NOT EXISTS adviser_teacher_id INTEGER REFERENCES teachers(id);

-- Helpful index for quick lookups by teacher
CREATE INDEX IF NOT EXISTS idx_sections_adviser_teacher ON sections(adviser_teacher_id);
