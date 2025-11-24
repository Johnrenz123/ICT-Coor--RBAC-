-- Create the early_registration table for storing student registration data
CREATE TABLE early_registration (
    id SERIAL PRIMARY KEY,
    gmail_address VARCHAR(255) NOT NULL,
    school_year VARCHAR(20) NOT NULL,
    lrn VARCHAR(20),
    grade_level VARCHAR(20) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100),
    ext_name VARCHAR(20),
    birthday DATE NOT NULL,
    age INTEGER NOT NULL,
    sex VARCHAR(10) NOT NULL,
    religion VARCHAR(100),
    current_address TEXT NOT NULL,
    ip_community VARCHAR(10) NOT NULL,
    ip_community_specify VARCHAR(200),
    pwd VARCHAR(10) NOT NULL,
    pwd_specify VARCHAR(200),
    father_name VARCHAR(200),
    mother_name VARCHAR(200),
    guardian_name VARCHAR(200),
    contact_number VARCHAR(20),
    registration_date DATE NOT NULL,
    printed_name VARCHAR(200),
    signature_image_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create an index for better query performance
CREATE INDEX idx_early_registration_school_year ON early_registration(school_year);
CREATE INDEX idx_early_registration_grade_level ON early_registration(grade_level);
CREATE INDEX idx_early_registration_lrn ON early_registration(lrn);

-- ===================================================================
-- USEFUL QUERIES TO VIEW ALL DATA FROM THE early_registration TABLE
-- ===================================================================

-- 1. View all registrations with basic information (for dashboard table):
-- SELECT id, school_year, grade_level, last_name, first_name, lrn, mother_name, contact_number, registration_date FROM early_registration ORDER BY created_at DESC;

-- 2. View ALL data from the early_registration table:
-- SELECT * FROM early_registration ORDER BY created_at DESC;

-- 3. View complete student information with formatted name:
-- SELECT 
--     id, 
--     gmail_address,
--     school_year, 
--     grade_level,
--     CONCAT(last_name, ', ', first_name, ' ', COALESCE(middle_name, ''), ' ', COALESCE(ext_name, '')) as full_name,
--     lrn,
--     birthday,
--     age,
--     sex,
--     religion,
--     current_address,
--     ip_community,
--     ip_community_specify,
--     pwd,
--     pwd_specify,
--     father_name,
--     mother_name,
--     guardian_name,
--     contact_number,
--     registration_date,
--     signature_image_path,
--     created_at
-- FROM early_registration 
-- ORDER BY created_at DESC;

-- 4. Count total registrations:
-- SELECT COUNT(*) as total_registrations FROM early_registration;

-- 5. View registrations by school year:
-- SELECT school_year, COUNT(*) as count FROM early_registration GROUP BY school_year;

-- 6. View registrations by grade level:
-- SELECT grade_level, COUNT(*) as count FROM early_registration GROUP BY grade_level ORDER BY grade_level;

-- 7. Search for specific student by name:
-- SELECT * FROM early_registration WHERE 
-- LOWER(first_name) LIKE '%john%' OR 
-- LOWER(last_name) LIKE '%doe%' 
-- ORDER BY created_at DESC;

-- 8. View recent registrations (last 10):
-- SELECT * FROM early_registration ORDER BY created_at DESC LIMIT 10;