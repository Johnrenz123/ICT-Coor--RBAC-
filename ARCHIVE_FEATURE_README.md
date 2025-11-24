# Archive Feature Documentation

## Overview
The archive feature allows ICT Coordinators to archive students who have been assigned to sections. This keeps the active students list clean while maintaining historical records of all students.

## Database Changes

### Required Migration
Run the SQL script `add_archive_column.sql` to add the archive functionality to your database:

```sql
psql -U your_username -d your_database -f add_archive_column.sql
```

This will:
- Add `is_archived` column (BOOLEAN, default: false) to the `students` table
- Create an index on `is_archived` for better query performance

## Features

### 1. Archive Students
- **Location**: Enrolled Students List → Actions column
- **Who**: Only students who have been assigned to sections can be archived
- **Button**: Yellow "Archive" button appears next to assigned students
- **Action**: Archives the student, removing them from the active students list

### 2. View Archived Students
- **Location**: Enrolled Students List section header
- **Button**: "Show Archived Students" (archive icon)
- **Toggle**: Click to switch between active and archived views
- **Count**: Shows the total number of archived students in the badge

### 3. Restore Students
- **Location**: Archived Students view → Actions column
- **Button**: "Restore" button (undo icon)
- **Action**: Moves student back to active students list
- **Auto-switch**: After restoring, view automatically switches back to active students

## API Endpoints

### Archive a Student
```
PUT /api/students/:id/archive
```
- **Access**: ICT Coordinator only
- **Action**: Sets `is_archived = true` for the student
- **Response**: Success message with student name

### Unarchive (Restore) a Student
```
PUT /api/students/:id/unarchive
```
- **Access**: ICT Coordinator only
- **Action**: Sets `is_archived = false` for the student
- **Response**: Success message with student name

### Get Archived Students
```
GET /api/students/archived
```
- **Access**: ICT Coordinator only
- **Returns**: List of all archived students with their details
- **Format**: `{ success: true, students: [...] }`

## User Workflow

### Archiving a Student
1. Go to "Students" tab in ICT Coordinator dashboard
2. Find a student who has been assigned to a section
3. Click the yellow "Archive" button in the Actions column
4. Confirm the archive action
5. Student is moved to archived list and removed from active view

### Viewing Archived Students
1. Go to "Students" tab
2. Click "Show Archived Students" button in the section header
3. View all archived students with their section assignments
4. Button changes to "Show Active Students" for easy toggle

### Restoring a Student
1. Switch to archived students view
2. Find the student to restore
3. Click the "Restore" button in the Actions column
4. Confirm the restore action
5. Student is moved back to active list
6. View automatically switches to active students

## Database Schema

### students table
```sql
- id (primary key)
- enrollment_id (foreign key → early_registration)
- section_id (foreign key → sections, nullable)
- lrn
- grade_level
- full_name
- ... (other student fields)
- enrollment_status ('active', 'pending', etc.)
- is_archived (BOOLEAN, default: false) ← NEW FIELD
- enrollment_date
- created_at
- updated_at
```

## Query Filters

### Active Students Query
```sql
WHERE enrollment_status = 'active' 
  AND (is_archived IS NULL OR is_archived = false)
```

### Archived Students Query
```sql
WHERE is_archived = true
```

## UI Components

### Archive Button (Active Students)
- **Color**: Amber/Warning color
- **Icon**: Archive icon (fas fa-archive)
- **Label**: "Archive"
- **Visibility**: Only shown for students with assigned sections

### Toggle View Button
- **Default**: "Show Archived Students" (archive icon)
- **Toggled**: "Show Active Students" (list icon)
- **Location**: Section header, next to title

### Restore Button (Archived Students)
- **Color**: Green/Edit color
- **Icon**: Undo icon (fas fa-undo)
- **Label**: "Restore"
- **Visibility**: Only in archived students view

## Security

All archive endpoints are protected:
- Requires active session
- Requires `ictcoor` role
- Returns 403 Forbidden for unauthorized access

## Transaction Safety

Both archive and unarchive operations use database transactions:
- BEGIN transaction
- Validate student exists
- Update is_archived flag
- COMMIT on success
- ROLLBACK on error

## Best Practices

1. **When to Archive**:
   - End of school year
   - Student transfers to another school
   - Student graduates
   - After final records are confirmed

2. **When NOT to Archive**:
   - Active students still attending
   - Students pending section assignment
   - Recent enrollments

3. **Data Retention**:
   - Archived students remain in the database
   - Section assignments are preserved
   - Can be restored at any time
   - Useful for historical reporting

## Troubleshooting

### "Failed to archive student"
- Check database connection
- Verify student exists in students table
- Check console for SQL errors

### Archive button not showing
- Student must be assigned to a section
- Only appears for students with `assigned_section` value
- Refresh the page if recently assigned

### Cannot restore student
- Verify student is in archived state
- Check session authentication
- Review server logs for errors

## Future Enhancements

Potential improvements:
- Bulk archive/restore operations
- Archive by grade level or section
- Archive date tracking
- Archived student statistics
- Export archived students to CSV
- Auto-archive based on school year

## Support

For issues or questions:
1. Check server console logs
2. Verify database migration completed
3. Test API endpoints directly
4. Review browser console for JavaScript errors
