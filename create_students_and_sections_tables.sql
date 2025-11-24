-- =====================================================
-- Create SECTIONS table for realistic section management
-- =====================================================
CREATE TABLE IF NOT EXISTS sections (
    id SERIAL PRIMARY KEY,
    section_name VARCHAR(100) NOT NULL UNIQUE,
    grade_level VARCHAR(50) NOT NULL,
    max_capacity INTEGER DEFAULT 40,
    current_count INTEGER DEFAULT 0,
    adviser_name VARCHAR(200),
    room_number VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_sections_grade ON sections(grade_level);
CREATE INDEX IF NOT EXISTS idx_sections_active ON sections(is_active);

-- =====================================================
-- Create STUDENTS table for officially enrolled students
-- =====================================================
CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    enrollment_id INTEGER REFERENCES early_registration(id),
    section_id INTEGER REFERENCES sections(id) ON DELETE SET NULL,
    
    -- Student identification
    lrn VARCHAR(20),
    student_id VARCHAR(50) UNIQUE,
    
    -- Personal information
    last_name VARCHAR(100) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100),
    ext_name VARCHAR(20),
    birthday DATE NOT NULL,
    age INTEGER NOT NULL,
    sex VARCHAR(10) NOT NULL,
    religion VARCHAR(100),
    
    -- Contact and address
    gmail_address VARCHAR(255),
    contact_number VARCHAR(20),
    current_address TEXT NOT NULL,
    
    -- Indigenous People / PWD
    ip_community VARCHAR(10) NOT NULL,
    ip_community_specify VARCHAR(200),
    pwd VARCHAR(10) NOT NULL,
    pwd_specify VARCHAR(200),
    
    -- Parent/Guardian information
    father_name VARCHAR(200),
    mother_name VARCHAR(200),
    guardian_name VARCHAR(200),
    
    -- Academic information
    school_year VARCHAR(20) NOT NULL,
    grade_level VARCHAR(20) NOT NULL,
    
    -- Enrollment details
    enrollment_date DATE DEFAULT CURRENT_DATE,
    enrollment_status VARCHAR(50) DEFAULT 'active',
    
    -- Document tracking
    printed_name VARCHAR(200),
    signature_image_path VARCHAR(500),
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX idx_students_section ON students(section_id);
CREATE INDEX idx_students_grade ON students(grade_level);
CREATE INDEX idx_students_sy ON students(school_year);
CREATE INDEX idx_students_lrn ON students(lrn);
CREATE INDEX idx_students_name ON students(last_name, first_name);
CREATE INDEX idx_students_status ON students(enrollment_status);

-- =====================================================
-- Seed SECTIONS table with the 18 existing sections
-- =====================================================
INSERT INTO sections (grade_level, section_name) VALUES
-- Kindergarten sections
('Kindergarten', 'angel'),
('Kindergarten', 'dahlia'),
('Kindergarten', 'lily'),
('Kindergarten', 'santan'),

-- Grade 1 sections
('Grade 1', 'rosal'),
('Grade 1', 'rose'),

-- Grade 2 sections
('Grade 2', 'camia'),
('Grade 2', 'daisy'),
('Grade 2', 'lirio'),

-- Grade 3 sections
('Grade 3', 'adelfa'),
('Grade 3', 'orchids'),

-- Grade 4 sections
('Grade 4', 'ilang-ilang'),
('Grade 4', 'sampaguita'),

-- Grade 5 sections
('Grade 5', 'blueberry'),
('Grade 5', 'everlasting'),

-- Grade 6 sections
('Grade 6', 'cattleya'),
('Grade 6', 'sunflower'),

-- Non-Graded section
('Non-Graded', 'tulips')

ON CONFLICT (section_name) DO NOTHING;

-- =====================================================
-- Helpful queries for managing sections and students
-- =====================================================

-- View all sections with current enrollment count
-- SELECT s.section_name, s.grade_level, s.current_count, s.max_capacity, 
--        (s.max_capacity - s.current_count) as available_slots
-- FROM sections s
-- WHERE s.is_active = true AND s.school_year = '2025 - 2026'
-- ORDER BY s.grade_level, s.section_name;

-- View all students with their section assignment
-- SELECT st.student_id, 
--        CONCAT(st.last_name, ', ', st.first_name) as full_name,
--        st.grade_level,
--        sec.section_name,
--        st.enrollment_status
-- FROM students st
-- LEFT JOIN sections sec ON st.section_id = sec.id
-- WHERE st.school_year = '2025 - 2026'
-- ORDER BY st.grade_level, sec.section_name, st.last_name;

-- Count students per section
-- SELECT s.section_name, COUNT(st.id) as student_count
-- FROM sections s
-- LEFT JOIN students st ON st.section_id = s.id AND st.enrollment_status = 'active'
-- WHERE s.school_year = '2025 - 2026' AND s.is_active = true
-- GROUP BY s.id, s.section_name
-- ORDER BY s.grade_level, s.section_name;
