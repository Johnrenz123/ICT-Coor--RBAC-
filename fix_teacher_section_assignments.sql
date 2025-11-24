-- Script to fix teacher-section assignments
-- This script ensures that sections are properly linked to teachers

-- Step 1: Check current status
SELECT 'Current Sections Status' as info;
SELECT 
    s.id,
    s.section_name,
    s.grade_level,
    s.adviser_name,
    s.adviser_teacher_id,
    t.id as actual_teacher_id,
    t.username,
    CONCAT(t.first_name, ' ', COALESCE(t.middle_name || ' ', ''), t.last_name) as teacher_full_name
FROM sections s
LEFT JOIN teachers t ON s.adviser_teacher_id = t.id
WHERE s.is_active = true
ORDER BY s.section_name;

-- Step 2: Update sections to match teachers by name (if adviser_teacher_id is NULL but adviser_name exists)
-- This will attempt to link sections to teachers based on name matching
UPDATE sections s
SET adviser_teacher_id = t.id,
    updated_at = CURRENT_TIMESTAMP
FROM teachers t
WHERE s.adviser_teacher_id IS NULL
  AND s.adviser_name IS NOT NULL
  AND s.adviser_name != ''
  AND (
    -- Try exact match on concatenated name
    s.adviser_name = CONCAT(t.first_name, ' ', COALESCE(t.middle_name || ' ', ''), t.last_name)
    OR
    -- Try match with normalized spacing
    REPLACE(s.adviser_name, '  ', ' ') = REPLACE(CONCAT(t.first_name, ' ', COALESCE(t.middle_name || ' ', ''), t.last_name), '  ', ' ')
    OR
    -- Try match without middle name
    s.adviser_name = CONCAT(t.first_name, ' ', t.last_name)
    OR
    -- Try partial match on last name (be careful with this)
    s.adviser_name LIKE CONCAT('%', t.last_name, '%')
  );

-- Step 3: Verify the updates
SELECT 'Updated Sections Status' as info;
SELECT 
    s.id,
    s.section_name,
    s.grade_level,
    s.adviser_name,
    s.adviser_teacher_id,
    t.username as teacher_username,
    CONCAT(t.first_name, ' ', COALESCE(t.middle_name || ' ', ''), t.last_name) as teacher_full_name,
    COUNT(st.id) as student_count
FROM sections s
LEFT JOIN teachers t ON s.adviser_teacher_id = t.id
LEFT JOIN students st ON st.section_id = s.id AND st.enrollment_status = 'active'
WHERE s.is_active = true
GROUP BY s.id, s.section_name, s.grade_level, s.adviser_name, s.adviser_teacher_id, t.username, t.first_name, t.middle_name, t.last_name
ORDER BY s.section_name;

-- Step 4: Show teachers without sections
SELECT 'Teachers Without Sections' as info;
SELECT 
    t.id,
    t.username,
    CONCAT(t.first_name, ' ', COALESCE(t.middle_name || ' ', ''), t.last_name) as full_name,
    t.is_active
FROM teachers t
WHERE NOT EXISTS (
    SELECT 1 FROM sections s 
    WHERE s.adviser_teacher_id = t.id AND s.is_active = true
)
ORDER BY t.last_name, t.first_name;

-- Step 5: Show sections without teachers
SELECT 'Sections Without Teachers' as info;
SELECT 
    s.id,
    s.section_name,
    s.grade_level,
    s.adviser_name,
    s.current_count,
    s.max_capacity
FROM sections s
WHERE s.adviser_teacher_id IS NULL
  AND s.is_active = true
ORDER BY s.section_name;
