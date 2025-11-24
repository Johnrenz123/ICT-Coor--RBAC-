/**
 * CREATE TEST DATA FOR DSS DEMONSTRATION
 * This script creates sample behavior reports that will trigger various DSS recommendations
 * Run with: node create_dss_test_data.js
 */

const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'ICTCOORdb',
    password: 'bello0517',
    port: 5432,
});

async function createTestData() {
    try {
        console.log('🚀 Creating DSS Test Data...\n');

        // Get first teacher ID
        const teacherResult = await pool.query('SELECT id FROM teachers LIMIT 1');
        if (teacherResult.rows.length === 0) {
            console.error('❌ No teachers found! Please create a teacher first.');
            process.exit(1);
        }
        const teacherId = teacherResult.rows[0].id;
        console.log(`✅ Using Teacher ID: ${teacherId}`);

        // Get first section ID
        const sectionResult = await pool.query('SELECT id FROM sections LIMIT 1');
        if (sectionResult.rows.length === 0) {
            console.error('❌ No sections found! Please create a section first.');
            process.exit(1);
        }
        const sectionId = sectionResult.rows[0].id;
        console.log(`✅ Using Section ID: ${sectionId}`);

        // Get student IDs (will work with what exists and create duplicates for demo)
        const studentsResult = await pool.query(
            'SELECT id, first_name, last_name FROM students'
        );
        if (studentsResult.rows.length < 1) {
            console.error('❌ Need at least 1 student for test data!');
            process.exit(1);
        }
        let students = studentsResult.rows;
        
        // If we have fewer than 10 students, duplicate them for demo
        if (students.length < 10) {
            console.log(`⚠️  Only ${students.length} student(s) found, will reuse them for demo\n`);
            const originalStudents = [...students];
            while (students.length < 10) {
                students.push(originalStudents[students.length % originalStudents.length]);
            }
        }
        console.log(`✅ Using ${students.length} student records for test data\n`);

        // Delete existing test data first
        await pool.query('DELETE FROM student_behavior_reports WHERE teacher_id = $1', [teacherId]);
        console.log('🧹 Cleared previous test data\n');

        // Test Case 1: ACADEMIC ISSUES - Multiple students with reading problems
        console.log('📚 Test Case 1: ACADEMIC - Reading Comprehension Issues');
        const academicReports = [
            {
                student: students[0],
                category: 'Academic',
                severity: 'Medium',
                notes: 'Maria struggles to understand what she reads. She can decode words but doesn\'t get the meaning. Needs to reread passages multiple times.'
            },
            {
                student: students[1],
                category: 'Academic',
                severity: 'Medium',
                notes: 'Carlos has difficulty with reading comprehension. Cannot explain what he just read. Struggles with academic performance in language arts.'
            },
            {
                student: students[2],
                category: 'Academic',
                severity: 'Low',
                notes: 'Juan reading skills need improvement. Has trouble understanding written instructions and text comprehension.'
            }
        ];

        for (const report of academicReports) {
            await pool.query(
                `INSERT INTO student_behavior_reports (student_id, section_id, teacher_id, category, severity, notes, report_date)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                [report.student.id, sectionId, teacherId, report.category, report.severity, report.notes]
            );
            console.log(`  ✅ ${report.student.first_name}: ${report.category} (${report.severity})`);
        }
        console.log('  → DSS will trigger: GROUP_INTERVENTION (3+ same issue)\n');

        // Test Case 2: HIGH SEVERITY - Urgent intervention needed
        console.log('⚠️  Test Case 2: HIGH SEVERITY - Urgent Cases');
        const highSeverityReports = [
            {
                student: students[3],
                category: 'Conduct',
                severity: 'High',
                notes: 'Miguel got into a physical altercation with another student. Punched and kicked. Aggressive behavior. Needs immediate intervention.'
            },
            {
                student: students[4],
                category: 'Disruption',
                severity: 'High',
                notes: 'Anna constantly interrupts class, uses offensive language, and refuses to follow instructions. Disruptive and aggressive toward teacher.'
            }
        ];

        for (const report of highSeverityReports) {
            await pool.query(
                `INSERT INTO student_behavior_reports (student_id, section_id, teacher_id, category, severity, notes, report_date)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                [report.student.id, sectionId, teacherId, report.category, report.severity, report.notes]
            );
            console.log(`  ✅ ${report.student.first_name}: ${report.category} (${report.severity})`);
        }
        console.log('  → DSS will trigger: URGENT_INTERVENTION (High Severity)\n');

        // Test Case 3: FREQUENT OFFENDER - At-risk student
        console.log('🚨 Test Case 3: FREQUENT OFFENDER - At-Risk Student (5+ reports)');
        const frequentReports = [
            {
                student: students[5],
                category: 'Disruption',
                severity: 'Medium',
                notes: 'Pedro talking during class again. Not paying attention to lessons.'
            },
            {
                student: students[5],
                category: 'Attendance',
                severity: 'High',
                notes: 'Pedro absent from class. Third time this week.'
            },
            {
                student: students[5],
                category: 'Conduct',
                severity: 'Medium',
                notes: 'Pedro was disrespectful to classmates. Arguing with peers.'
            },
            {
                student: students[5],
                category: 'Disruption',
                severity: 'High',
                notes: 'Pedro refusing to do schoolwork. Completely disruptive.'
            },
            {
                student: students[5],
                category: 'Conduct',
                severity: 'Medium',
                notes: 'Pedro caught cheating on quiz. Dishonest behavior.'
            }
        ];

        for (let i = 0; i < frequentReports.length; i++) {
            const report = frequentReports[i];
            const pastDate = new Date();
            pastDate.setDate(pastDate.getDate() - (5 - i)); // Spread over 5 days
            
            await pool.query(
                `INSERT INTO student_behavior_reports (student_id, section_id, teacher_id, category, severity, notes, report_date)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [report.student.id, sectionId, teacherId, report.category, report.severity, report.notes, pastDate]
            );
            console.log(`  ✅ ${report.student.first_name}: Report ${i + 1} - ${report.category} (${report.severity})`);
        }
        console.log('  → DSS will trigger: INDIVIDUAL_PLAN (5+ reports = at-risk)\n');

        // Test Case 4: BEHAVIORAL SUPPORT - Disruptive pattern
        console.log('🎭 Test Case 4: BEHAVIORAL ISSUES - Disruptive Pattern');
        const behavioralReports = [
            {
                student: students[6],
                category: 'Disruption',
                severity: 'Medium',
                notes: 'Sofia interrupts class constantly. Makes noise and seeks attention. Disrupts learning environment.'
            },
            {
                student: students[7],
                category: 'Disruption',
                severity: 'Medium',
                notes: 'Diego talks during lessons. Not respecting classroom rules. Causes distraction.'
            }
        ];

        for (const report of behavioralReports) {
            await pool.query(
                `INSERT INTO student_behavior_reports (student_id, section_id, teacher_id, category, severity, notes, report_date)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                [report.student.id, sectionId, teacherId, report.category, report.severity, report.notes]
            );
            console.log(`  ✅ ${report.student.first_name}: ${report.category} (${report.severity})`);
        }
        console.log('  → DSS will trigger: BEHAVIORAL_SUPPORT (Disruptive keywords)\n');

        // Test Case 5: SOCIAL-EMOTIONAL SUPPORT
        console.log('💙 Test Case 5: SOCIAL-EMOTIONAL ISSUES');
        const socialReports = [
            {
                student: students[8],
                category: 'Attendance',
                severity: 'Medium',
                notes: 'Rafael appears sad and withdrawn. Cries during class. Emotional distress. Sits alone. Isolated from peers.'
            }
        ];

        for (const report of socialReports) {
            await pool.query(
                `INSERT INTO student_behavior_reports (student_id, section_id, teacher_id, category, severity, notes, report_date)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                [report.student.id, sectionId, teacherId, report.category, report.severity, report.notes]
            );
            console.log(`  ✅ ${report.student.first_name}: ${report.category} (${report.severity})`);
        }
        console.log('  → DSS will trigger: COUNSELING_REFERRAL (Emotional keywords)\n');

        // Test Case 6: ATTENDANCE CONCERN
        console.log('📅 Test Case 6: ATTENDANCE & PUNCTUALITY');
        const attendanceReports = [
            {
                student: students[9],
                category: 'Attendance',
                severity: 'High',
                notes: 'Leo has been absent 8 times this month. Skipping classes frequently. Truant behavior.'
            }
        ];

        for (const report of attendanceReports) {
            await pool.query(
                `INSERT INTO student_behavior_reports (student_id, section_id, teacher_id, category, severity, notes, report_date)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                [report.student.id, sectionId, teacherId, report.category, report.severity, report.notes]
            );
            console.log(`  ✅ ${report.student.first_name}: ${report.category} (${report.severity})`);
        }
        console.log('  → DSS will trigger: PARENT_COMMUNICATION (Attendance issue)\n');

        // Summary
        console.log('═══════════════════════════════════════════════════════');
        console.log('✅ TEST DATA CREATED SUCCESSFULLY!');
        console.log('═══════════════════════════════════════════════════════\n');

        console.log('📊 WHAT TO EXPECT IN DR ADMIN DASHBOARD:\n');
        console.log('✓ Test Case 1: Academic Intervention (3 reading issues)');
        console.log('  → Recommendation: GROUP_INTERVENTION for reading support');
        console.log('  → Confidence: 88%\n');

        console.log('✓ Test Case 2: Urgent Intervention (High Severity)');
        console.log('  → Recommendation: URGENT_INTERVENTION');
        console.log('  → Confidence: 95%');
        console.log('  → Actions: Parent meeting, Intervention plan, Support staff\n');

        console.log('✓ Test Case 3: At-Risk Student (5+ reports)');
        console.log('  → Recommendation: INDIVIDUAL_PLAN');
        console.log('  → Confidence: 92%');
        console.log('  → Actions: BIP, Counselor, Parent meeting\n');

        console.log('✓ Test Case 4: Behavioral Support');
        console.log('  → Recommendation: BEHAVIORAL_SUPPORT');
        console.log('  → Confidence: 80%\n');

        console.log('✓ Test Case 5: Emotional Support');
        console.log('  → Recommendation: COUNSELING_REFERRAL');
        console.log('  → Confidence: 78%\n');

        console.log('✓ Test Case 6: Attendance Concern');
        console.log('  → Recommendation: PARENT_COMMUNICATION');
        console.log('  → Confidence: 90%\n');

        console.log('═══════════════════════════════════════════════════════');
        console.log('🎯 NEXT STEPS:');
        console.log('1. Go to DR Admin Dashboard: http://localhost:3000/dr-admin/login');
        console.log('2. Log in with DR Admin credentials');
        console.log('3. Click "📊 Behavior Analytics"');
        console.log('4. See DSS recommendations with confidence scores!');
        console.log('═══════════════════════════════════════════════════════\n');

        await pool.end();
        process.exit(0);

    } catch (error) {
        console.error('❌ Error creating test data:', error);
        await pool.end();
        process.exit(1);
    }
}

createTestData();
