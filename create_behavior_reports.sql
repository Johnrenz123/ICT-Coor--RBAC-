-- Teacher-submitted behavior reports for students
CREATE TABLE IF NOT EXISTS student_behavior_reports (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    section_id INTEGER REFERENCES sections(id) ON DELETE SET NULL,
    teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
    report_date DATE DEFAULT CURRENT_DATE,
    category VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_behavior_student ON student_behavior_reports(student_id);
CREATE INDEX IF NOT EXISTS idx_behavior_section ON student_behavior_reports(section_id);
CREATE INDEX IF NOT EXISTS idx_behavior_teacher ON student_behavior_reports(teacher_id);
