-- Debug script to check teacher and section assignments
-- Run this to see what's in the database

-- 1. Check all teachers
SELECT id, username, first_name, middle_name, last_name, 
       CONCAT(first_name, ' ', COALESCE(middle_name || ' ', ''), last_name) AS full_name,
       is_active
FROM teachers
ORDER BY id;

-- 2. Check all sections with adviser info
SELECT id, section_name, grade_level, adviser_name, 
       adviser_teacher_id, current_count, max_capacity, is_active
FROM sections
WHERE is_active = true
ORDER BY section_name;

-- 3. Check students assigned to sections
SELECT s.id, s.section_name, COUNT(st.id) as student_count
FROM sections s
LEFT JOIN students st ON st.section_id = s.id AND st.enrollment_status = 'active'
WHERE s.is_active = true
GROUP BY s.id, s.section_name
ORDER BY s.section_name;

-- 4. Check if adviser_teacher_id column exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'sections' 
  AND column_name IN ('adviser_name', 'adviser_teacher_id');

-- 5. Find sections that might belong to a teacher (by name pattern)
SELECT s.id, s.section_name, s.adviser_name, 
       t.id as teacher_id, t.username,
       CONCAT(t.first_name, ' ', COALESCE(t.middle_name || ' ', ''), t.last_name) AS teacher_full_name
FROM sections s
LEFT JOIN teachers t ON s.adviser_name LIKE CONCAT('%', t.last_name, '%')
WHERE s.is_active = true
ORDER BY s.section_name;
