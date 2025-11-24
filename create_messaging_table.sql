-- Create table for guidance-teacher messaging system
CREATE TABLE IF NOT EXISTS guidance_teacher_messages (
    id SERIAL PRIMARY KEY,
    guidance_id INTEGER NOT NULL REFERENCES guidance_accounts(id) ON DELETE CASCADE,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_gtm_teacher ON guidance_teacher_messages(teacher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gtm_guidance ON guidance_teacher_messages(guidance_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gtm_unread ON guidance_teacher_messages(teacher_id, is_read) WHERE is_read = false;

-- Grant permissions
GRANT ALL PRIVILEGES ON guidance_teacher_messages TO postgres;
GRANT ALL PRIVILEGES ON SEQUENCE guidance_teacher_messages_id_seq TO postgres;
