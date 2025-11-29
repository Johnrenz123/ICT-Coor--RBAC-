const dotenv = require('dotenv');
dotenv.config(); // Load environment variables from .env file

const express = require('express');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const path = require('path');
const session = require('express-session'); // 1. Import session
const multer = require('multer');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const dssEngine = require('./dss-engine'); // Import DSS Engine
const PDFDocument = require('pdfkit'); // Import pdfkit for PDF generation
const emailService = require('./email-service'); // Import email service for notifications
const compression = require('compression'); // Import compression middleware

const app = express();
const port = 3000;

// ============= PERFORMANCE: CACHE VARIABLES =============
let columnExistsCache = {
    adviser_teacher_id: null,
    checked_at: null
};
const CACHE_TTL = 5 * 60 * 1000; // Cache for 5 minutes

// ============= PRODUCTION: TRUST PROXY FOR CORRECT IP DETECTION =============
// CRITICAL: Enable this when deployed behind Nginx, Apache, or cloud platforms
// This allows Express to correctly read the real client IP from proxy headers
app.set('trust proxy', true);

// ============= PERFORMANCE: RESPONSE COMPRESSION =============
// Compress all responses to reduce bandwidth (text, JSON, HTML)
app.use(compression({
    filter: (req, res) => {
        // Don't compress responses with this request header
        if (req.headers['x-no-compression']) {
            return false;
        }
        // Use compression filter function
        return compression.filter(req, res);
    },
    level: 6 // Balance between speed and compression ratio
}));

// Ensure session and parsers are registered BEFORE any routes so req.session is available everywhere
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: false,
    name: 'connect.sid',
    cookie: {
        secure: false,
        httpOnly: false,
        maxAge: 1000 * 60 * 60 * 24,
        sameSite: 'lax'
    }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// ============= SECURITY ANALYTICS & IP MANAGEMENT ENDPOINTS =============

// Get submission logs (admin only - registrar for enrollment, guidance for document_request)
app.get('/api/analytics/submission-logs', async (req, res) => {
    if (!req.session.user || !['admin', 'guidance', 'registrar'].includes(req.session.user.role)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    try {
        const {type, status, limit = 100, offset = 0, ip, email, from, to} = req.query;
        let query = 'SELECT * FROM submission_logs WHERE 1=1';
        const values = [];
        let paramCount = 1;

        if (type) {
            query += ` AND submission_type = $${paramCount++}`;
            values.push(type);
        }
        if (status) {
            query += ` AND status = $${paramCount++}`;
            values.push(status);
        }
        if (ip) {
            query += ` AND ip_address = $${paramCount++}`;
            values.push(ip);
        }
        if (email) {
            query += ` AND email = $${paramCount++}`;
            values.push(email);
        }

        // Date range filtering (optional)
        if (from) {
            // Expecting 'YYYY-MM-DD' or ISO date string
            try {
                const fromDate = new Date(from);
                if (!isNaN(fromDate)) {
                    query += ` AND created_at >= $${paramCount++}`;
                    values.push(fromDate.toISOString());
                }
            } catch (e) { /* ignore invalid date */ }
        }
        if (to) {
            try {
                const toDate = new Date(to);
                if (!isNaN(toDate)) {
                    // include the entire day by setting to 23:59:59 if input had no time
                    toDate.setHours(23,59,59,999);
                    query += ` AND created_at <= $${paramCount++}`;
                    values.push(toDate.toISOString());
                }
            } catch (e) { /* ignore invalid date */ }
        }

        query += ` ORDER BY created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
        values.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, values);
        res.json({ success: true, logs: result.rows });
    } catch (err) {
        console.error('Error fetching logs:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get analytics stats
app.get('/api/analytics/stats', async (req, res) => {
    if (!req.session.user || !['admin', 'guidance', 'registrar'].includes(req.session.user.role)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    try {
        const {type} = req.query;
        const typeFilter = type ? `AND submission_type = '${type}'` : '';

        const statsQuery = `
            SELECT 
                submission_type,
                status,
                COUNT(*) as count,
                MAX(created_at) as last_occurrence
            FROM submission_logs
            WHERE created_at > NOW() - INTERVAL '24 hours' ${typeFilter}
            GROUP BY submission_type, status
        `;

        const suspiciousQuery = `
            SELECT 
                ip_address,
                COUNT(*) as attempt_count,
                MAX(created_at) as last_attempt,
                array_agg(DISTINCT status) as statuses
            FROM submission_logs
            WHERE created_at > NOW() - INTERVAL '1 hour' ${typeFilter}
            GROUP BY ip_address
            HAVING COUNT(*) >= 5
            ORDER BY attempt_count DESC
        `;

        const stats = await pool.query(statsQuery);
        const suspicious = await pool.query(suspiciousQuery);

        res.json({ 
            success: true, 
            stats: stats.rows,
            suspicious: suspicious.rows
        });
    } catch (err) {
        console.error('Error fetching stats:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get blocked IPs
app.get('/api/security/blocked-ips', async (req, res) => {
    if (!req.session.user || !['admin', 'guidance', 'registrar'].includes(req.session.user.role)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    try {
        const result = await pool.query(`
            SELECT b.*, g.username as blocked_by_name
            FROM blocked_ips b
            LEFT JOIN guidance_accounts g ON b.blocked_by = g.id
            WHERE b.is_active = true
            ORDER BY b.blocked_at DESC
        `);
        res.json({ success: true, blockedIPs: result.rows });
    } catch (err) {
        console.error('Error fetching blocked IPs:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Block an IP
app.post('/api/security/block-ip', async (req, res) => {
    try {
        console.log('='.repeat(50));
        console.log('🔒 BLOCK IP REQUEST RECEIVED');
        console.log('='.repeat(50));
        console.log('Session exists:', !!req.session);
        console.log('Session user:', JSON.stringify(req.session?.user, null, 2));
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        console.log('='.repeat(50));
        
        if (!req.session.user || !['admin', 'guidance', 'registrar'].includes(req.session.user.role)) {
            console.log('❌ [Block IP] Unauthorized - no session or wrong role');
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        const {ipAddress, reason, duration} = req.body;
        console.log('Parsed data:', { ipAddress, reason, duration, userId: req.session.user.id });
        
        if (!ipAddress || !reason) {
            console.log('❌ [Block IP] Missing required fields');
            return res.status(400).json({ success: false, error: 'IP address and reason required' });
        }

        let expiresAt = null;
        if (duration && duration !== 'permanent') {
            const hours = parseInt(duration);
            expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
        }

        const result = await pool.query(`
            INSERT INTO blocked_ips (ip_address, reason, blocked_by, expires_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (ip_address) 
            DO UPDATE SET is_active = true, blocked_by = $3, blocked_at = NOW(), reason = $2, expires_at = $4
            RETURNING *
        `, [ipAddress, reason, req.session.user.id, expiresAt]);

        const blockedByName = req.session.user.username || req.session.user.name || req.session.user.role || 'Admin';
        console.log(`🚫 IP ${ipAddress} blocked by ${blockedByName}. Reason: ${reason}`);
        res.json({ success: true, blockedIP: result.rows[0] });
    } catch (err) {
        console.error('='.repeat(50));
        console.error('❌ ERROR BLOCKING IP');
        console.error('='.repeat(50));
        console.error('Error message:', err.message);
        console.error('Error code:', err.code);
        console.error('Error detail:', err.detail);
        console.error('Stack:', err.stack);
        console.error('='.repeat(50));
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: err.message });
        }
    }
});

// Debug endpoint - check session
app.get('/api/debug/session', (req, res) => {
    res.json({
        hasSession: !!req.session,
        hasUser: !!req.session?.user,
        user: req.session?.user || null,
        sessionID: req.sessionID
    });
});

// Unblock an IP
app.post('/api/security/unblock-ip', async (req, res) => {
    if (!req.session.user || !['admin', 'guidance', 'registrar'].includes(req.session.user.role)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    try {
        const {ipAddress} = req.body;
        if (!ipAddress) {
            return res.status(400).json({ success: false, error: 'IP address required' });
        }

        const result = await pool.query(`
            UPDATE blocked_ips
            SET is_active = false, unblocked_by = $1, unblocked_at = NOW()
            WHERE ip_address = $2
            RETURNING *
        `, [req.session.user.id, ipAddress]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'IP not found in blocked list' });
        }

        const unblockedByName = req.session.user.username || req.session.user.name || req.session.user.role || 'Admin';
        console.log(`✅ IP ${ipAddress} unblocked by ${unblockedByName}`);
        res.json({ success: true, unblocked: result.rows[0] });
    } catch (err) {
        console.error('❌ Error unblocking IP:', err);
        console.error('Error details:', { message: err.message, code: err.code, detail: err.detail });
        res.status(500).json({ success: false, error: err.message });
    }
});


// ============= SECURITY: RATE LIMITING =============
// Limit enrollment submissions to 3 per hour per IP
const enrollmentLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 requests per hour
    message: { 
        success: false, 
        message: 'Too many enrollment requests from this IP. Please try again later.' 
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Limit document request submissions to 3 per hour per IP
const documentRequestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3,
    message: { 
        success: false, 
        message: 'Too many document requests from this IP. Please try again later.' 
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// General API rate limiter (100 requests per 15 minutes)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: { 
        success: false, 
        message: 'Too many requests. Please slow down.' 
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// (moved) session + parsers are now registered at the very top

// Helper: require logged-in teacher
function requireTeacher(req, res, next) {
    console.log('requireTeacher - Session ID:', req.sessionID);
    console.log('requireTeacher - Session user:', req.session.user);
    if (!req.session.user || req.session.user.role !== 'teacher') {
        console.log('requireTeacher - UNAUTHORIZED: No session or wrong role');
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    console.log('requireTeacher - AUTHORIZED');
    next();
}

// Configure multer for file uploads (signatures)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'uploads', 'signatures');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'signature-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// ======================== TEACHER-SCOPED ENDPOINTS ========================
// Current teacher profile
app.get('/api/teacher/me', requireTeacher, async (req, res) => {
    try {
        const t = await pool.query(
            'SELECT id, username, first_name, middle_name, last_name, email, contact_number FROM teachers WHERE id = $1',
            [req.session.user.id]
        );
        if (t.rows.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
        res.json({ success: true, teacher: t.rows[0] });
    } catch (err) {
        console.error('teacher/me error:', err);
        res.status(500).json({ success: false, error: 'Failed to load profile' });
    }
});

// Sections assigned to teacher
app.get('/api/teacher/sections', requireTeacher, async (req, res) => {
    try {
        console.log('Teacher requesting sections - ID:', req.session.user.id, 'Name:', req.session.user.name);
        let result;
        
        // Use cached column check instead of querying on every request
        const hasAdviserTeacherId = await checkColumnExistsCached('adviser_teacher_id');
        
        if (hasAdviserTeacherId) {
            // Try by teacher ID first
            result = await pool.query(
                `SELECT id, section_name, grade_level, max_capacity, current_count, adviser_name, room_number
                 FROM sections
                 WHERE adviser_teacher_id = $1 AND is_active = true
                 ORDER BY section_name`,
                [req.session.user.id]
            );
            console.log('Sections by teacher ID:', result.rows.length);
            
            // If no results, try by name as fallback
            if (result.rows.length === 0 && req.session.user.name) {
                console.log('No sections by ID, trying by name:', req.session.user.name);
                result = await pool.query(
                    `SELECT id, section_name, grade_level, max_capacity, current_count, adviser_name, room_number
                     FROM sections
                     WHERE adviser_name = $1 AND is_active = true
                     ORDER BY section_name`,
                    [req.session.user.name]
                );
                console.log('Sections by teacher name:', result.rows.length);
            }
        } else {
            // Column doesn't exist, use name-based lookup
            console.log('adviser_teacher_id column not found, using name-based lookup');
            result = await pool.query(
                `SELECT id, section_name, grade_level, max_capacity, current_count, adviser_name, room_number
                 FROM sections
                 WHERE adviser_name = $1 AND is_active = true
                 ORDER BY section_name`,
                [req.session.user.name]
            );
            console.log('Sections by teacher name:', result.rows.length);
        }
        
        console.log('Final sections result:', result.rows);
        res.json({ success: true, sections: result.rows });
    } catch (err) {
        console.error('teacher/sections error:', err);
        res.status(500).json({ success: false, error: 'Failed to load sections' });
    }
});

// Single, best-resolved section assignment for teacher
// Preference order:
//  1) Sections where adviser_teacher_id matches the logged-in teacher
//  2) If multiple, prefer Non-Graded
//  3) If still multiple, pick the most recently created (highest id)
//  4) Fallback to adviser_name match using same preference
app.get('/api/teacher/assigned-section', requireTeacher, async (req, res) => {
    try {
        const teacherId = req.session.user.id;
        const teacherName = req.session.user.name;

        // Use cached column check
        const hasAdviserTeacherId = await checkColumnExistsCached('adviser_teacher_id');

        const orderClause = `
            ORDER BY 
                CASE WHEN grade_level = 'Non-Graded' THEN 0 ELSE 1 END,
                id DESC
            LIMIT 1
        `;

        if (hasAdviserTeacherId) {
            // Strict by teacher ID
            const byId = await pool.query(
                `SELECT id, section_name, grade_level, max_capacity, current_count, adviser_name, room_number
                 FROM sections
                 WHERE adviser_teacher_id = $1 AND is_active = true
                 ${orderClause}`,
                [teacherId]
            );
            if (byId.rows.length > 0) {
                return res.json({ success: true, section: byId.rows[0], source: 'adviser_teacher_id' });
            }

            // Fallback by name
            const byName = await pool.query(
                `SELECT id, section_name, grade_level, max_capacity, current_count, adviser_name, room_number
                 FROM sections
                 WHERE adviser_name = $1 AND is_active = true
                 ${orderClause}`,
                [teacherName]
            );
            if (byName.rows.length > 0) {
                return res.json({ success: true, section: byName.rows[0], source: 'adviser_name' });
            }
        } else {
            // Column doesn't exist, use name-based lookup only
            const byName = await pool.query(
                `SELECT id, section_name, grade_level, max_capacity, current_count, adviser_name, room_number
                 FROM sections
                 WHERE adviser_name = $1 AND is_active = true
                 ${orderClause}`,
                [teacherName]
            );
            if (byName.rows.length > 0) {
                return res.json({ success: true, section: byName.rows[0], source: 'adviser_name' });
            }
        }

        // No assignment found
        return res.json({ success: true, section: null });
    } catch (err) {
        console.error('teacher/assigned-section error:', err);
        res.status(500).json({ success: false, error: 'Failed to resolve assigned section' });
    }
});

// Students of a section (teacher must own section)
app.get('/api/teacher/sections/:id/students', requireTeacher, async (req, res) => {
    const sectionId = req.params.id;
    try {
        let sec;
        try {
            sec = await pool.query('SELECT id FROM sections WHERE id = $1 AND adviser_teacher_id = $2', [sectionId, req.session.user.id]);
        } catch (e) {
            // Fallback when adviser_teacher_id column doesn't exist yet
            sec = await pool.query('SELECT id FROM sections WHERE id = $1 AND adviser_name = $2', [sectionId, req.session.user.name]);
        }
        if (sec.rows.length === 0) return res.status(403).json({ success: false, error: 'Access denied' });
        const students = await pool.query(`
            SELECT id, lrn, last_name, first_name, middle_name, ext_name, sex, age, grade_level, contact_number,
                   CONCAT(last_name, ', ', first_name, ' ', COALESCE(middle_name, ''), ' ', COALESCE(ext_name, '')) as full_name
            FROM students
            WHERE section_id = $1 AND enrollment_status = 'active'
            ORDER BY last_name, first_name
        `, [sectionId]);
        res.json({ success: true, students: students.rows });
    } catch (err) {
        console.error('teacher section students error:', err);
        res.status(500).json({ success: false, error: 'Failed to load students' });
    }
});

// Student details (teacher scoped)
app.get('/api/teacher/students/:id', requireTeacher, async (req, res) => {
    const studentId = req.params.id;
    try {
        const st = await pool.query('SELECT section_id FROM students WHERE id = $1', [studentId]);
        if (st.rows.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
        const secId = st.rows[0].section_id;
        let sec;
        try {
            sec = await pool.query('SELECT id FROM sections WHERE id = $1 AND adviser_teacher_id = $2', [secId, req.session.user.id]);
        } catch (e) {
            sec = await pool.query('SELECT id FROM sections WHERE id = $1 AND adviser_name = $2', [secId, req.session.user.name]);
        }
        if (sec.rows.length === 0) return res.status(403).json({ success: false, error: 'Access denied' });
        const detail = await pool.query(`
            SELECT id, enrollment_id, gmail_address, school_year, lrn, grade_level,
                   last_name, first_name, middle_name, ext_name,
                   CONCAT(last_name, ', ', first_name, ' ', COALESCE(middle_name, ''), ' ', COALESCE(ext_name, '')) AS full_name,
                   birthday, age, sex, religion, current_address,
                   father_name, mother_name, guardian_name, contact_number
            FROM students WHERE id = $1
        `, [studentId]);
        res.json({ success: true, student: detail.rows[0] });
    } catch (err) {
        console.error('teacher student detail error:', err);
        res.status(500).json({ success: false, error: 'Failed to load student details' });
    }
});

// Behavior reports: create
app.post('/api/behavior-reports', requireTeacher, async (req, res) => {
    const { studentId, sectionId, category, severity, notes, reportDate } = req.body || {};
    if (!studentId || !sectionId || !category || !severity) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    try {
        let sec;
        try {
            sec = await pool.query('SELECT id FROM sections WHERE id = $1 AND adviser_teacher_id = $2', [sectionId, req.session.user.id]);
        } catch (e) {
            sec = await pool.query('SELECT id FROM sections WHERE id = $1 AND adviser_name = $2', [sectionId, req.session.user.name]);
        }
        if (sec.rows.length === 0) return res.status(403).json({ success: false, error: 'Access denied' });
        const st = await pool.query('SELECT id FROM students WHERE id = $1 AND section_id = $2', [studentId, sectionId]);
        if (st.rows.length === 0) return res.status(400).json({ success: false, error: 'Student not in your section' });
        const result = await pool.query(`
            INSERT INTO student_behavior_reports (student_id, section_id, teacher_id, report_date, category, severity, notes)
            VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5, $6, $7)
            RETURNING id
        `, [studentId, sectionId, req.session.user.id, reportDate || null, category, severity, notes || null]);
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error('create behavior report error:', err);
        res.status(500).json({ success: false, error: 'Failed to save report' });
    }
});

// Behavior reports: list by student or section
app.get('/api/behavior-reports', requireTeacher, async (req, res) => {
    const { studentId, sectionId } = req.query;
    try {
        if (studentId) {
            const st = await pool.query('SELECT section_id FROM students WHERE id = $1', [studentId]);
            if (st.rows.length === 0) return res.status(404).json({ success: false, error: 'Student not found' });
            const secId = st.rows[0].section_id;
            let sec;
            try {
                sec = await pool.query('SELECT id FROM sections WHERE id = $1 AND adviser_teacher_id = $2', [secId, req.session.user.id]);
            } catch (e) {
                sec = await pool.query('SELECT id FROM sections WHERE id = $1 AND adviser_name = $2', [secId, req.session.user.name]);
            }
            if (sec.rows.length === 0) return res.status(403).json({ success: false, error: 'Access denied' });
            const list = await pool.query(`
                SELECT r.id, r.report_date, r.category, r.severity, r.notes
                FROM student_behavior_reports r
                WHERE r.student_id = $1
                ORDER BY r.report_date DESC, r.id DESC
            `, [studentId]);
            return res.json({ success: true, reports: list.rows });
        }
        if (sectionId) {
            let sec;
            try {
                sec = await pool.query('SELECT id FROM sections WHERE id = $1 AND adviser_teacher_id = $2', [sectionId, req.session.user.id]);
            } catch (e) {
                sec = await pool.query('SELECT id FROM sections WHERE id = $1 AND adviser_name = $2', [sectionId, req.session.user.name]);
            }
            if (sec.rows.length === 0) return res.status(403).json({ success: false, error: 'Access denied' });
            const list = await pool.query(`
                SELECT r.id, r.report_date, r.category, r.severity, r.notes, r.student_id,
                       CONCAT(s.last_name, ', ', s.first_name, ' ', COALESCE(s.middle_name,'')) AS student_name
                FROM student_behavior_reports r
                JOIN students s ON s.id = r.student_id
                WHERE r.section_id = $1
                ORDER BY r.report_date DESC, r.id DESC
            `, [sectionId]);
            return res.json({ success: true, reports: list.rows });
        }
        return res.status(400).json({ success: false, error: 'Provide studentId or sectionId' });
    } catch (err) {
        console.error('list behavior reports error:', err);
        res.status(500).json({ success: false, error: 'Failed to load reports' });
    }
});

// ======================== DR ADMIN: BEHAVIOR ANALYTICS ========================
// Get all behavior reports with student and teacher details for analytics + DSS recommendations
// NOTE: This endpoint is deprecated, use /api/guidance/behavior-analytics instead
app.get('/api/dr-admin/behavior-analytics', async (req, res) => {
    // Redirect to new endpoint
    res.redirect('/api/guidance/behavior-analytics');
});

// ======================== GUIDANCE COUNSELOR ROUTES ========================
// Guidance Login Page
app.get('/guidance/login', (req, res) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return res.redirect('/guidance/dashboard');
    }
    res.sendFile(path.join(__dirname, 'views', 'guidance', 'guidance-login.html'));
});

// Guidance Dashboard Page
app.get('/guidance/dashboard', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/guidance/login');
    }

    try {
        // Optional date range filter from query parameters (expected format: YYYY-MM-DD)
        const from = req.query.from;
        const to = req.query.to;
        const hasDateRange = from && to;

        // Basic validation: ensure dates are in YYYY-MM-DD format (very small validation)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (hasDateRange && (!dateRegex.test(from) || !dateRegex.test(to))) {
            return res.status(400).send('Invalid date format for filter. Use YYYY-MM-DD.');
        }
        // Basic aggregates for the dashboard
        // When a date range is provided, include it in the aggregate queries
        let totalQ, pendingQ, approvedQ, completedQ;
        if (hasDateRange) {
            totalQ = await pool.query("SELECT COUNT(*)::int AS total FROM document_requests WHERE created_at::date BETWEEN $1 AND $2", [from, to]);
            pendingQ = await pool.query("SELECT COUNT(*)::int AS count FROM document_requests WHERE status = 'pending' AND created_at::date BETWEEN $1 AND $2", [from, to]);
            approvedQ = await pool.query("SELECT COUNT(*)::int AS count FROM document_requests WHERE status IN ('processing','ready','approved') AND created_at::date BETWEEN $1 AND $2", [from, to]);
            completedQ = await pool.query("SELECT COUNT(*)::int AS count FROM document_requests WHERE status = 'completed' AND created_at::date BETWEEN $1 AND $2", [from, to]);
        } else {
            totalQ = await pool.query("SELECT COUNT(*)::int AS total FROM document_requests");
            pendingQ = await pool.query("SELECT COUNT(*)::int AS count FROM document_requests WHERE status = 'pending'");
            approvedQ = await pool.query("SELECT COUNT(*)::int AS count FROM document_requests WHERE status IN ('processing','ready','approved')");
            completedQ = await pool.query("SELECT COUNT(*)::int AS count FROM document_requests WHERE status = 'completed'");
        }

        // Breakdown by document type (top 10)
        let countsByTypeQ;
        if (hasDateRange) {
            countsByTypeQ = await pool.query(`
                SELECT document_type AS type, COUNT(*)::int AS count
                FROM document_requests
                WHERE created_at::date BETWEEN $1 AND $2
                GROUP BY document_type
                ORDER BY count DESC
                LIMIT 10
            `, [from, to]);
        } else {
            countsByTypeQ = await pool.query(`
                SELECT document_type AS type, COUNT(*)::int AS count
                FROM document_requests
                GROUP BY document_type
                ORDER BY count DESC
                LIMIT 10
            `);
        }

        // Monthly summary (last 6 months)
        let monthlySummaryQ;
        if (hasDateRange) {
            monthlySummaryQ = await pool.query(`
                SELECT TO_CHAR(date_trunc('month', created_at), 'Mon YYYY') AS month, COUNT(*)::int AS count
                FROM document_requests
                WHERE created_at::date BETWEEN $1 AND $2
                GROUP BY date_trunc('month', created_at)
                ORDER BY date_trunc('month', created_at) DESC
            `, [from, to]);
        } else {
            monthlySummaryQ = await pool.query(`
                SELECT TO_CHAR(date_trunc('month', created_at), 'Mon YYYY') AS month, COUNT(*)::int AS count
                FROM document_requests
                WHERE created_at >= (date_trunc('month', CURRENT_DATE) - INTERVAL '5 months')
                GROUP BY date_trunc('month', created_at)
                ORDER BY date_trunc('month', created_at) DESC
            `);
        }

        // Top requesters (by student_name or email)
        let topRequestersQ;
        if (hasDateRange) {
            topRequestersQ = await pool.query(`
                SELECT COALESCE(student_name, email) AS name, COUNT(*)::int AS count
                FROM document_requests
                WHERE created_at::date BETWEEN $1 AND $2
                GROUP BY COALESCE(student_name, email)
                ORDER BY count DESC
                LIMIT 5
            `, [from, to]);
        } else {
            topRequestersQ = await pool.query(`
                SELECT COALESCE(student_name, email) AS name, COUNT(*)::int AS count
                FROM document_requests
                GROUP BY COALESCE(student_name, email)
                ORDER BY count DESC
                LIMIT 5
            `);
        }

        // Average turnaround hours for completed requests
        let avgTurnQ;
        if (hasDateRange) {
            avgTurnQ = await pool.query(`
                SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (processed_at - created_at))/3600)::numeric, 2), NULL) AS avg_hours
                FROM document_requests
                WHERE status = 'completed' AND processed_at IS NOT NULL
                AND processed_at::date BETWEEN $1 AND $2
            `, [from, to]);
        } else {
            avgTurnQ = await pool.query(`
                SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (processed_at - created_at))/3600)::numeric, 2), NULL) AS avg_hours
                FROM document_requests
                WHERE status = 'completed' AND processed_at IS NOT NULL
            `);
        }

        // Recent requests
        let recentQ;
        if (hasDateRange) {
            recentQ = await pool.query(`
                SELECT id, request_token, student_name, email, document_type, purpose, status, created_at, processed_at
                FROM document_requests
                WHERE created_at::date BETWEEN $1 AND $2
                ORDER BY created_at DESC
                LIMIT 50
            `, [from, to]);
        } else {
            recentQ = await pool.query(`
                SELECT id, request_token, student_name, email, document_type, purpose, status, created_at, processed_at
                FROM document_requests
                ORDER BY created_at DESC
                LIMIT 50
            `);
        }

        const totalRequests = totalQ.rows[0]?.total || 0;
        const pendingRequests = pendingQ.rows[0]?.count || 0;
        const approvedRequests = approvedQ.rows[0]?.count || 0;
        const completedRequests = completedQ.rows[0]?.count || 0;
        const countsByType = countsByTypeQ.rows || [];
        const monthlySummary = monthlySummaryQ.rows.map(r => ({ month: r.month, count: r.count })) || [];
        const topRequesters = topRequestersQ.rows.map(r => ({ name: r.name, count: r.count })) || [];
        const avgTurnaround = avgTurnQ.rows[0] && avgTurnQ.rows[0].avg_hours ? `${avgTurnQ.rows[0].avg_hours} hrs` : 'N/A';
        const requests = recentQ.rows || [];

        return res.render('guidance/guidance-dashboard', {
            schoolName: req.session.user?.name || null,
            totalRequests,
            pendingRequests,
            approvedRequests,
            completedRequests,
            countsByType,
            monthlySummary,
            topRequesters,
            avgTurnaround,
            requests,
            // Echo back date filters for form prefill
            from: hasDateRange ? from : null,
            to: hasDateRange ? to : null,
            user: req.session.user,
            activePage: 'dashboard'
        });
    } catch (err) {
        console.error('Error rendering guidance dashboard:', err);
        // Rendering failed — return a simple error response instead of serving the static template
        return res.status(500).send('Failed to load guidance dashboard');
    }
});

// Guidance Behavior Analytics Page
app.get('/guidance/behavior-analytics', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/guidance/login');
    }
    res.sendFile(path.join(__dirname, 'views', 'guidance', 'guidance-behavior-analytics.html'));
});

// Guidance Archived Behavior Reports Page
app.get('/guidance/behavior-archive', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/guidance/login');
    }
    res.sendFile(path.join(__dirname, 'views', 'guidance', 'guidance-behavior-archive.html'));
});

// Guidance Behavior Analytics API (DSS-powered)
app.get('/api/guidance/behavior-analytics', async (req, res) => {
    try {
        // Get all behavior reports with full details
        const reportsResult = await pool.query(`
            SELECT 
                r.id,
                r.report_date,
                r.category,
                r.severity,
                r.notes,
                r.student_id,
                r.section_id,
                r.teacher_id,
                r.is_done,
                CONCAT(s.last_name, ', ', s.first_name, ' ', COALESCE(s.middle_name, '')) AS student_full_name,
                CONCAT(t.last_name, ', ', t.first_name) AS teacher_name,
                sec.section_name,
                sec.grade_level
            FROM student_behavior_reports r
            JOIN students s ON s.id = r.student_id
            JOIN teachers t ON t.id = r.teacher_id
            JOIN sections sec ON sec.id = r.section_id
            ORDER BY r.report_date DESC
        `);

        // Get unique students
        const studentsResult = await pool.query(`
            SELECT DISTINCT 
                s.id,
                s.first_name,
                s.middle_name,
                s.last_name,
                CONCAT(s.last_name, ', ', s.first_name, ' ', COALESCE(s.middle_name, '')) AS full_name,
                sec.section_name
            FROM students s
            JOIN sections sec ON sec.id = s.section_id
            WHERE s.id IN (
                SELECT DISTINCT student_id FROM student_behavior_reports
            )
        `);

        // ===== DSS ENGINE: ANALYZE ALL REPORTS =====
        const reports = reportsResult.rows;
        const dashboardAnalysis = dssEngine.analyzeAllReports(reports);

        // ===== ADD RECOMMENDATIONS TO EACH REPORT =====
        const reportsWithRecommendations = reports.map(report => {
            const recommendations = dssEngine.generateRecommendations(report, reports);
            return {
                ...report,
                recommendations: recommendations,
                hasRecommendations: recommendations.length > 0,
            };
        });

        res.json({
            success: true,
            reports: reportsWithRecommendations,
            students: studentsResult.rows,
            dashboardAnalysis: dashboardAnalysis,
        });
    } catch (err) {
        console.error('Guidance behavior analytics error:', err);
        res.status(500).json({ success: false, error: 'Failed to load analytics' });
    }
});

// ==================== GUIDANCE-TEACHER MESSAGING ====================

// Get all teachers for guidance dropdown
app.get('/api/guidance/teachers', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.id, t.first_name, t.middle_name, t.last_name, t.username, 
                   s.section_name, s.id as section_id
            FROM teachers t
            LEFT JOIN sections s ON s.adviser_teacher_id = t.id
            ORDER BY t.last_name, t.first_name
        `);
        res.json({ success: true, teachers: result.rows });
    } catch (err) {
        console.error('Failed to load teachers:', err);
        res.status(500).json({ success: false, error: 'Failed to load teachers' });
    }
});

// Get all students for guidance dropdown
app.get('/api/guidance/students', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT s.id, 
                   CONCAT(s.first_name, ' ', s.middle_name, ' ', s.last_name) as full_name,
                   s.lrn, 
                   sec.section_name
            FROM students s
            LEFT JOIN sections sec ON s.section_id = sec.id
            WHERE s.is_archived = false
            ORDER BY s.last_name, s.first_name
        `);
        res.json({ success: true, students: result.rows });
    } catch (err) {
        console.error('Failed to load students:', err);
        res.status(500).json({ success: false, error: 'Failed to load students' });
    }
});

// Send message from guidance to teacher
app.post('/api/guidance/messages', async (req, res) => {
    console.log('[DEBUG] POST /api/guidance/messages');
    console.log('[DEBUG] Session ID:', req.sessionID);
    console.log('[DEBUG] Session data:', JSON.stringify(req.session, null, 2));
    console.log('[DEBUG] Request body:', req.body);
    console.log('[DEBUG] Has guidance_id?', !!req.session.guidance_id);
    console.log('[DEBUG] Has user?', !!req.session.user);
    
    if (!req.session.guidance_id) {
        console.log('[DEBUG] ❌ Not authenticated - no guidance_id in session');
        console.log('[DEBUG] Full session object:', req.session);
        return res.status(401).json({ success: false, error: 'Not authenticated as guidance' });
    }

    const { teacherId, studentId, message } = req.body;

    if (!teacherId || !message || !message.trim()) {
        console.log('[DEBUG] Validation failed:', { teacherId, message });
        return res.status(400).json({ success: false, error: 'Teacher and message are required' });
    }

    try {
        console.log('[DEBUG] Inserting message:', { 
            guidance_id: req.session.guidance_id, 
            teacherId, 
            studentId, 
            message: message.substring(0, 50) 
        });
        
        const result = await pool.query(`
            INSERT INTO guidance_teacher_messages (guidance_id, teacher_id, student_id, message, created_at, is_read)
            VALUES ($1, $2, $3, $4, NOW(), false)
            RETURNING id
        `, [req.session.guidance_id, teacherId, studentId || null, message.trim()]);

        console.log('[DEBUG] Message inserted successfully, ID:', result.rows[0].id);
        res.json({ success: true, message: 'Message sent successfully' });
    } catch (err) {
        console.error('[ERROR] Failed to send message:', err);
        res.status(500).json({ success: false, error: 'Database error: ' + err.message });
    }
});

// Get sent messages history for guidance
app.get('/api/guidance/messages', async (req, res) => {
    if (!req.session.guidance_id) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    try {
        const result = await pool.query(`
            SELECT 
                gtm.id, gtm.message, gtm.created_at, gtm.is_read, COALESCE(gtm.is_archived, false) as is_archived,
                CONCAT(t.first_name, ' ', t.last_name) as teacher_name,
                CONCAT(s.first_name, ' ', s.middle_name, ' ', s.last_name) as student_name
            FROM guidance_teacher_messages gtm
            INNER JOIN teachers t ON gtm.teacher_id = t.id
            LEFT JOIN students s ON gtm.student_id = s.id
            WHERE gtm.guidance_id = $1
            ORDER BY gtm.created_at DESC
            LIMIT 100
        `, [req.session.guidance_id]);

        res.json({ success: true, messages: result.rows });
    } catch (err) {
        console.error('Failed to load message history:', err);
        res.status(500).json({ success: false, error: 'Failed to load messages' });
    }
});

// Get messages for teacher
app.get('/api/teacher/messages', requireTeacher, async (req, res) => {
    try {
        // Check if the table exists first
        const tableCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'guidance_teacher_messages'
            );
        `);
        
        if (!tableCheck.rows[0].exists) {
            // Table doesn't exist, return empty messages
            return res.json({ success: true, messages: [] });
        }
        
        const result = await pool.query(`
            SELECT 
                gtm.id, gtm.message, gtm.created_at, gtm.is_read,
                g.username as guidance_name,
                gtm.student_id
            FROM guidance_teacher_messages gtm
            INNER JOIN guidance_accounts g ON gtm.guidance_id = g.id
            WHERE gtm.teacher_id = $1
            ORDER BY gtm.created_at DESC
        `, [req.session.user.id]);

        res.json({ success: true, messages: result.rows });
    } catch (err) {
        console.error('Failed to load teacher messages:', err);
        // Return empty messages instead of error
        res.json({ success: true, messages: [] });
    }
});

// Get unread message count for teacher
app.get('/api/teacher/messages/unread-count', requireTeacher, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT COUNT(*) as count
            FROM guidance_teacher_messages
            WHERE teacher_id = $1 AND is_read = false
        `, [req.session.user.id]);

        res.json({ success: true, count: parseInt(result.rows[0].count) });
    } catch (err) {
        console.error('Failed to get unread count:', err);
        res.status(500).json({ success: false, error: 'Failed to get count' });
    }
});

// Mark message as read
app.put('/api/teacher/messages/:id/read', requireTeacher, async (req, res) => {
    const messageId = req.params.id;

    try {
        await pool.query(`
            UPDATE guidance_teacher_messages
            SET is_read = true
            WHERE id = $1 AND teacher_id = $2
        `, [messageId, req.session.user.id]);

        res.json({ success: true });
    } catch (err) {
        console.error('Failed to mark message as read:', err);
        res.status(500).json({ success: false, error: 'Failed to update message' });
    }
});

// Backward compatibility: redirect /dr-admin to /guidance
app.get('/dr-admin/login', (req, res) => res.redirect('/guidance/login'));
app.get('/dr-admin/dashboard', (req, res) => res.redirect('/guidance/dashboard'));
app.get('/dr-admin/behavior-analytics', (req, res) => res.redirect('/guidance/behavior-analytics'));
app.get('/dr-admin/logout', (req, res) => res.redirect('/guidance/logout'));
app.post('/api/dr-admin/login', (req, res) => res.redirect(307, '/api/guidance/login'));
app.get('/api/dr-admin/behavior-analytics', (req, res) => res.redirect('/api/guidance/behavior-analytics'));

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb('Error: Images Only!');
        }
    }
});

// PostgreSQL connection pool
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'ICTCOORdb',
    password: process.env.DB_PASSWORD || 'bello0517',
    port: parseInt(process.env.DB_PORT) || 5432,
    // ============= PERFORMANCE: CONNECTION POOL TUNING =============
    max: 15, // Maximum number of clients in the pool (reduced for stability)
    idleTimeoutMillis: 60000, // Close idle clients after 60 seconds
    connectionTimeoutMillis: 10000, // Connection attempt timeout (increased to 10 seconds)
    statement_timeout: 30000, // Statement timeout: 30 seconds
});

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Error connecting to database:', err.stack);
        console.error('Connection details:', {
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME || 'ICTCOORdb',
            user: process.env.DB_USER || 'postgres'
        });
        // Don't exit - allow app to continue in case DB recovers
        setTimeout(() => {
            console.log('Retrying database connection...');
            pool.connect((err2, client2, release2) => {
                if (!err2 && client2) {
                    console.log('✅ Database reconnected successfully');
                    release2();
                    initializeSchemas();
                }
            });
        }, 5000);
    } else {
        console.log('✅ Database connected successfully');
        release();
        initializeSchemas();
    }
});

/**
 * Initialize all database schemas and indexes
 */
async function initializeSchemas() {
    try {
        console.log('📋 Initializing database schemas...');
        
        // Initialize all schemas - catch errors individually so one failure doesn't stop others
        await ensureDocumentRequestsSchema().catch(e => console.error('Document requests schema error:', e.message));
        await ensureSubmissionLogsSchema().catch(e => console.error('Submission logs schema error:', e.message));
        await ensureBlockedIPsSchema().catch(e => console.error('Blocked IPs schema error:', e.message));
        await ensureTeachersArchiveSchema().catch(e => console.error('Teachers archive schema error:', e.message));
        await ensureEnrollmentRequestsSchema().catch(e => console.error('Enrollment requests schema error:', e.message));
        await ensureMessagingSchema().catch(e => console.error('Messaging schema error:', e.message));
        await createPerformanceIndexes().catch(e => console.error('Performance indexes error:', e.message));
        
        console.log('✅ All schemas and indexes initialized successfully');
    } catch (err) {
        console.error('❌ Schema initialization error:', err.message);
        // Retry after 5 seconds
        setTimeout(initializeSchemas, 5000);
    }
}

// ============= PERFORMANCE: CREATE INDEXES FOR COMMON QUERIES =============
async function createPerformanceIndexes() {
    const indexQueries = [
        // Sections table indexes
        `CREATE INDEX IF NOT EXISTS idx_sections_adviser_teacher_id ON sections(adviser_teacher_id) WHERE is_active = true`,
        `CREATE INDEX IF NOT EXISTS idx_sections_adviser_name ON sections(adviser_name) WHERE is_active = true`,
        `CREATE INDEX IF NOT EXISTS idx_sections_section_name ON sections(section_name) WHERE is_active = true`,
        
        // Students table indexes
        `CREATE INDEX IF NOT EXISTS idx_students_section_id ON students(section_id) WHERE enrollment_status = 'active'`,
        `CREATE INDEX IF NOT EXISTS idx_students_lrn ON students(lrn)`,
        
        // Behavior reports indexes
        `CREATE INDEX IF NOT EXISTS idx_behavior_reports_student_id ON student_behavior_reports(student_id)`,
        `CREATE INDEX IF NOT EXISTS idx_behavior_reports_section_id ON student_behavior_reports(section_id)`,
        `CREATE INDEX IF NOT EXISTS idx_behavior_reports_teacher_id ON student_behavior_reports(teacher_id)`,
        `CREATE INDEX IF NOT EXISTS idx_behavior_reports_report_date ON student_behavior_reports(report_date DESC)`,
        
        // Document requests indexes
        `CREATE INDEX IF NOT EXISTS idx_document_requests_created_at ON document_requests(created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_document_requests_status_created ON document_requests(status, created_at DESC)`,
        
        // Guidance teachers messages indexes
        `CREATE INDEX IF NOT EXISTS idx_guidance_messages_guidance_id ON guidance_teacher_messages(guidance_id)`,
        `CREATE INDEX IF NOT EXISTS idx_guidance_messages_teacher_id ON guidance_teacher_messages(teacher_id)`,
        `CREATE INDEX IF NOT EXISTS idx_guidance_messages_created ON guidance_teacher_messages(created_at DESC)`
    ];
    
    try {
        for (const query of indexQueries) {
            await pool.query(query);
        }
        console.log('✅ Performance indexes created successfully');
    } catch (err) {
        console.error('❌ Error creating indexes:', err.message);
    }
}

// ============= PERFORMANCE: CACHED COLUMN CHECK =============
async function checkColumnExistsCached(columnName) {
    // Return cached result if available and not expired
    if (columnExistsCache.adviser_teacher_id !== null && 
        Date.now() - columnExistsCache.checked_at < CACHE_TTL) {
        return columnExistsCache.adviser_teacher_id;
    }
    
    try {
        const result = await pool.query(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'sections' 
                AND column_name = $1
            ) AS has_column
        `, [columnName]);
        
        columnExistsCache.adviser_teacher_id = result.rows[0].has_column;
        columnExistsCache.checked_at = Date.now();
        return result.rows[0].has_column;
    } catch (err) {
        console.error('Error checking column:', err);
        return false;
    }
}

/**
 * Ensures the teachers_archive table exists. Safe to call multiple times.
 */
async function ensureTeachersArchiveSchema() {
    const ddl = `
    CREATE TABLE IF NOT EXISTS teachers_archive (
        id SERIAL PRIMARY KEY,
        original_id INTEGER,
        username VARCHAR(50),
        password VARCHAR(255),
        first_name VARCHAR(50),
        middle_name VARCHAR(50),
        last_name VARCHAR(50),
        ext_name VARCHAR(10),
        email VARCHAR(100),
        contact_number VARCHAR(20),
        birthday DATE,
        sex VARCHAR(10),
        address TEXT,
        employee_id VARCHAR(50),
        department VARCHAR(100),
        position VARCHAR(100),
        specialization VARCHAR(100),
        date_hired DATE,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP,
        updated_at TIMESTAMP,
        archived_by INTEGER,
        archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_teachers_archive_original_id ON teachers_archive(original_id);
    CREATE INDEX IF NOT EXISTS idx_teachers_archive_archived_at ON teachers_archive(archived_at);
    `;
    try {
        await pool.query(ddl);
        console.log('✅ teachers_archive schema ensured');
        
        // Also ensure is_archived column on teachers table
        await pool.query(`ALTER TABLE teachers ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_teachers_is_archived ON teachers(is_archived)`);
        console.log('✅ teachers.is_archived column ensured');
    } catch (err) {
        console.error('❌ Failed ensuring teachers_archive schema:', err.message);
        // Don't throw - allow other schemas to initialize
    }
}

/**
 * Ensures the enrollment_requests table exists.
 * Safe to call multiple times.
 */
async function ensureEnrollmentRequestsSchema() {
    const ddl = `
    CREATE TABLE IF NOT EXISTS enrollment_requests (
        id SERIAL PRIMARY KEY,
        request_token VARCHAR(20) UNIQUE NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        
        gmail_address VARCHAR(255) NOT NULL,
        school_year VARCHAR(50) NOT NULL,
        lrn VARCHAR(50),
        grade_level VARCHAR(50) NOT NULL,
        
        last_name VARCHAR(100) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        middle_name VARCHAR(100),
        ext_name VARCHAR(50),
        
        birthday DATE NOT NULL,
        age INTEGER NOT NULL,
        sex VARCHAR(20) NOT NULL,
        religion VARCHAR(100),
        current_address TEXT NOT NULL,
        
        ip_community VARCHAR(50) NOT NULL,
        ip_community_specify VARCHAR(100),
        pwd VARCHAR(50) NOT NULL,
        pwd_specify VARCHAR(100),
        
        father_name VARCHAR(200),
        mother_name VARCHAR(200),
        guardian_name VARCHAR(200),
        contact_number VARCHAR(50),
        
        registration_date DATE NOT NULL,
        printed_name VARCHAR(200) NOT NULL,
        signature_image_path TEXT,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reviewed_by INTEGER REFERENCES registraraccount(id),
        reviewed_at TIMESTAMP,
        rejection_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_request_token ON enrollment_requests(request_token);
    CREATE INDEX IF NOT EXISTS idx_status ON enrollment_requests(status);
    CREATE OR REPLACE FUNCTION update_enrollment_requests_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
    END;$$ LANGUAGE plpgsql;
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_update_enrollment_requests_updated_at') THEN
            CREATE TRIGGER trigger_update_enrollment_requests_updated_at
            BEFORE UPDATE ON enrollment_requests
            FOR EACH ROW EXECUTE FUNCTION update_enrollment_requests_updated_at();
        END IF;
    END$$;
    `;
    try {
        await pool.query(ddl);
        console.log('✅ enrollment_requests schema ensured');
    } catch (err) {
        console.error('❌ Failed ensuring enrollment_requests schema:', err.message);
        // Don't throw - allow other schemas to initialize
    }
}

/**
 * Ensures the document_requests table, indexes, and trigger exist.
 * Safe to call multiple times.
 */
async function ensureDocumentRequestsSchema() {
    const ddl = `
    CREATE TABLE IF NOT EXISTS document_requests (
        id SERIAL PRIMARY KEY,
        request_token VARCHAR(20) UNIQUE NOT NULL,
        student_name VARCHAR(255) NOT NULL,
        student_id VARCHAR(100),
        contact_number VARCHAR(50) NOT NULL,
        email VARCHAR(255) NOT NULL,
        document_type VARCHAR(100) NOT NULL,
        purpose TEXT NOT NULL,
        additional_notes TEXT,
        adviser_name VARCHAR(255),
        adviser_school_year VARCHAR(50),
        student_type VARCHAR(20) CHECK (student_type IN ('student','alumni')),
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','processing','ready','completed','rejected')),
        processed_by INTEGER REFERENCES guidance_accounts(id),
        processed_at TIMESTAMP,
        completion_notes TEXT,
        rejection_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_document_requests_token ON document_requests(request_token);
    CREATE INDEX IF NOT EXISTS idx_document_requests_status ON document_requests(status);
    CREATE INDEX IF NOT EXISTS idx_document_requests_email ON document_requests(email);
    CREATE OR REPLACE FUNCTION update_document_requests_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
    END;$$ LANGUAGE plpgsql;
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_update_document_requests_updated_at') THEN
            CREATE TRIGGER trigger_update_document_requests_updated_at
            BEFORE UPDATE ON document_requests
            FOR EACH ROW EXECUTE FUNCTION update_document_requests_updated_at();
        END IF;
    END$$;
    `;
    try {
        await pool.query(ddl);
        console.log('✅ document_requests schema ensured');
    } catch (err) {
        console.error('❌ Failed ensuring document_requests schema:', err.message);
        // Don't throw - allow other schemas to initialize
    }
}

/**
 * Ensures the submission_logs table exists for activity monitoring
 */
async function ensureSubmissionLogsSchema() {
    const ddl = `
    CREATE TABLE IF NOT EXISTS submission_logs (
        id SERIAL PRIMARY KEY,
        submission_type VARCHAR(50) NOT NULL,
        ip_address VARCHAR(45) NOT NULL,
        user_agent TEXT,
        email VARCHAR(255),
        lrn VARCHAR(12),
        form_data JSONB,
        status VARCHAR(20) NOT NULL,
        error_message TEXT,
        request_token VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_submission_logs_ip ON submission_logs(ip_address);
    CREATE INDEX IF NOT EXISTS idx_submission_logs_email ON submission_logs(email);
    CREATE INDEX IF NOT EXISTS idx_submission_logs_type ON submission_logs(submission_type);
    CREATE INDEX IF NOT EXISTS idx_submission_logs_status ON submission_logs(status);
    CREATE INDEX IF NOT EXISTS idx_submission_logs_created ON submission_logs(created_at);
    `;
    try {
        await pool.query(ddl);
        console.log('✅ submission_logs schema ensured');
    } catch (err) {
        console.error('❌ Failed ensuring submission_logs schema:', err.message);
        // Don't throw - allow other schemas to initialize
    }
}

    /**
     * Ensures the blocked_ips table exists for IP blocklist management
     */
    async function ensureBlockedIPsSchema() {
        const ddl = `
        CREATE TABLE IF NOT EXISTS blocked_ips (
            id SERIAL PRIMARY KEY,
            ip_address VARCHAR(45) UNIQUE NOT NULL,
            reason TEXT NOT NULL,
            blocked_by INTEGER REFERENCES guidance_accounts(id),
            blocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP,
            is_active BOOLEAN DEFAULT true,
            unblocked_by INTEGER REFERENCES guidance_accounts(id),
            unblocked_at TIMESTAMP,
            notes TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_blocked_ips_address ON blocked_ips(ip_address);
        CREATE INDEX IF NOT EXISTS idx_blocked_ips_active ON blocked_ips(is_active);
        CREATE INDEX IF NOT EXISTS idx_blocked_ips_expires ON blocked_ips(expires_at);
        `;
        try {
            await pool.query(ddl);
            console.log('✅ blocked_ips schema ensured');
    } catch (err) {
        console.error('❌ Failed ensuring blocked_ips schema:', err.message);
        // Don't throw - allow other schemas to initialize
    }
}    // ============= SECURITY: IP BLOCKLIST =============
    async function isIPBlocked(ip) {
        try {
            const result = await pool.query(`
                SELECT id, reason FROM blocked_ips
                WHERE ip_address = $1 
                AND is_active = true
                AND (expires_at IS NULL OR expires_at > NOW())
            `, [ip]);
            return result.rows.length > 0 ? result.rows[0] : null;
        } catch (err) {
            console.error('Error checking blocked IP:', err);
            return null;
        }
    }

// ============= SECURITY: ROBUST IP DETECTION =============
// Helper function to get real client IP (works in production with proxies)
function getClientIP(req) {
    // With trust proxy enabled, req.ip will be the real IP from X-Forwarded-For
    let ip = req.ip;
    
    // Fallback chain for different hosting environments
    if (!ip || ip === '::1' || ip === '127.0.0.1') {
        // Try X-Forwarded-For header (used by most proxies/load balancers)
        const forwarded = req.headers['x-forwarded-for'];
        if (forwarded) {
            // X-Forwarded-For can contain multiple IPs: "client, proxy1, proxy2"
            // The first one is the real client IP
            ip = forwarded.split(',')[0].trim();
        }
        
        // Try other common headers
        if (!ip) ip = req.headers['x-real-ip'];
        if (!ip) ip = req.headers['cf-connecting-ip']; // Cloudflare
        if (!ip) ip = req.headers['true-client-ip']; // Akamai/Cloudflare
        if (!ip) ip = req.connection.remoteAddress;
        if (!ip) ip = req.socket.remoteAddress;
    }
    
    // Clean up IPv6 localhost representations
    if (ip === '::1' || ip === '::ffff:127.0.0.1') {
        ip = '127.0.0.1';
    }
    
    // Remove IPv6 prefix if present (::ffff:192.168.1.1 -> 192.168.1.1)
    if (ip && ip.startsWith('::ffff:')) {
        ip = ip.substring(7);
    }
    
    return ip || 'unknown';
}

// ============= SECURITY: ACTIVITY LOGGING =============
async function logSubmission(type, req, status, errorMessage = null, token = null, formData = {}) {
    try {
        const ip = getClientIP(req);
        const userAgent = req.headers['user-agent'] || null;
        const email = formData.email || formData.gmail || null;
        const lrn = formData.lrn || null;
        
        await pool.query(`
            INSERT INTO submission_logs (
                submission_type, ip_address, user_agent, email, lrn,
                form_data, status, error_message, request_token
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [type, ip, userAgent, email, lrn, JSON.stringify(formData), status, errorMessage, token]);
    } catch (err) {
        console.error('❌ Error logging submission:', err.message);
        // Don't throw - logging failure shouldn't block submissions
    }
}

// Check for suspicious activity (multiple submissions from same IP)
async function checkSuspiciousActivity(ip, email, type) {
    try {
        // Check submissions in last hour
        const result = await pool.query(`
            SELECT COUNT(*) as count
            FROM submission_logs
            WHERE (ip_address = $1 OR email = $2)
            AND submission_type = $3
            AND created_at > NOW() - INTERVAL '1 hour'
        `, [ip, email, type]);
        
        const count = parseInt(result.rows[0].count);
        if (count >= 5) {
            console.warn(`⚠️ Suspicious activity detected: ${count} ${type} submissions from IP ${ip} or email ${email} in last hour`);
            return true;
        }
        return false;
    } catch (err) {
        console.error('Error checking suspicious activity:', err);
        return false;
    }
}

// ============= SECURITY: VALIDATION & SANITIZATION =============
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(String(email).toLowerCase());
}

function validatePhilippinePhone(phone) {
    // Accepts: 09123456789, +639123456789, 639123456789
    const re = /^(\+63|0)?9\d{9}$/;
    return re.test(String(phone).replace(/[\s\-()]/g, ''));
}

function validateLRN(lrn) {
    // LRN must be exactly 12 digits
    return /^\d{12}$/.test(String(lrn));
}

function sanitizeText(text) {
    if (!text) return '';
    // Remove potentially dangerous characters
    return String(text)
        .replace(/[<>]/g, '') // Remove < and >
        .replace(/javascript:/gi, '') // Remove javascript: protocol
        .replace(/on\w+\s*=/gi, '') // Remove event handlers like onclick=
        .trim()
        .substring(0, 1000); // Limit length
}

// Check for duplicate enrollment request
async function checkDuplicateEnrollment(email, lrn) {
    const query = `
        SELECT request_token, gmail, lrn, status 
        FROM enrollment_requests 
        WHERE (gmail = $1 OR (lrn = $2 AND lrn IS NOT NULL AND lrn != ''))
        AND status IN ('pending', 'approved')
        ORDER BY created_at DESC 
        LIMIT 1
    `;
    const result = await pool.query(query, [email, lrn || null]);
    return result.rows[0] || null;
}

// Check for duplicate document request
async function checkDuplicateDocumentRequest(email) {
    const query = `
        SELECT request_token, email, status 
        FROM document_requests 
        WHERE email = $1 
        AND status IN ('pending', 'processing', 'ready')
        ORDER BY created_at DESC 
        LIMIT 1
    `;
    const result = await pool.query(query, [email]);
    return result.rows[0] || null;
}

// EJS view engine configuration
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files from the public directory (for enrollment.html and assets)
app.use(express.static(path.join(__dirname, 'public')));
// Serve static files from the pictures directory
app.use('/pictures', express.static(path.join(__dirname, 'pictures')));
// Serve static files from the uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// Serve static files from the views directory (for role-specific JS/CSS)
app.use('/views', express.static(path.join(__dirname, 'views')));

// Session middleware was moved near the top to ensure availability for all routes.

// --- ROUTES ---

// ========== GUIDANCE ROUTES ==========
// Guidance Login API
app.post('/api/guidance/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('🔐 Guidance login attempt:', { username });
    
    try {
        // Check guidance_accounts table for valid credentials
        console.log('📋 Querying guidance_accounts table...');
        const result = await pool.query(
            'SELECT * FROM guidance_accounts WHERE username = $1 AND is_active = true',
            [username]
        );
        
        console.log('📊 Query result:', result.rows.length, 'users found');
        
        const user = result.rows[0];
        
        if (user) {
            console.log('👤 User found:', user.fullname);
            const passwordMatch = await bcrypt.compare(password, user.password);
            console.log('🔑 Password match:', passwordMatch);
            
            if (passwordMatch) {
                req.session.user = {
                    id: user.id,
                    role: 'admin',
                    name: user.fullname
                };
                req.session.guidance_id = user.id; // Set guidance_id for messaging endpoints
                
                // Explicitly save session before responding
                return req.session.save((err) => {
                    if (err) {
                        console.error('❌ Session save error:', err);
                        return res.status(500).json({ success: false, error: 'Failed to save session' });
                    }
                    console.log('✅ Login successful! Session saved:', { 
                        user_id: user.id, 
                        guidance_id: user.id,
                        session_id: req.sessionID 
                    });
                    return res.json({ success: true, message: 'Login successful' });
                });
            }
        }
        
        console.log('❌ Invalid credentials');
        res.status(401).json({ success: false, error: 'Invalid credentials' });
    } catch (err) {
        console.error('💥 Guidance login error:', err.message);
        console.error('Stack:', err.stack);
        res.status(500).json({ success: false, error: 'Login failed: ' + err.message });
    }
});

// Guidance Logout
app.get('/guidance/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/guidance/login');
});

// Note: guidance dashboard route is handled by the rendered EJS handler earlier in this file.

// Guidance Behavior Analytics Page
app.get('/guidance/behavior-analytics', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/guidance/login');
    }
    res.sendFile(path.join(__dirname, 'views', 'guidance', 'guidance-behavior-analytics.html'));
});

// Guidance Smart Recommendations Page
app.get('/guidance/recommendations', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/guidance/login');
    }
    res.sendFile(path.join(__dirname, 'views', 'guidance', 'guidance-recommendations.html'));
});

// Guidance Sent Messages Page
app.get('/guidance/sent-messages', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/guidance/login');
    }
    // Serve the static sent messages page
    res.sendFile(path.join(__dirname, 'views', 'guidance', 'guidance-sent-messages.html'));
});

// Registrar login page route
app.get('/registrarlogin', (req, res) => {
    // Allow force parameter to bypass redirect
    if (req.session.user && !req.query.force) {
        // Redirect to correct landing page based on role
        if (req.session.user.role === 'registrar') {
            return res.redirect('/registrar');
        } else if (req.session.user.role === 'ictcoor') {
            return res.redirect('/ictcoorLanding');
        }
    }
    // Clear session if force parameter is present
    if (req.query.force && req.session.user) {
        return req.session.destroy((err) => {
            if (err) console.error('Session destroy error:', err);
            res.render('registrarlogin', { error: null });
        });
    }
    res.render('registrarlogin', { error: null });
});
// Registrar login POST route
app.post('/registrarlogin', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM registraraccount WHERE username = $1', [username]);
        const user = result.rows[0];
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.user = { id: user.id, role: 'registrar' };
            return res.redirect('/registrar');
        } else {
            return res.render('registrarlogin', { error: 'Invalid username or password.' });
        }
    } catch (err) {
        console.error('Registrar login error:', err);
        res.render('registrarlogin', { error: 'An error occurred during login.' });
    }
});
// Delete registrar account (POST)
app.post('/delete-registrar-account', async (req, res) => {
    const { id } = req.body;
    try {
        await pool.query('DELETE FROM registraraccount WHERE id = $1', [id]);
        res.redirect('/registraracc');
    } catch (err) {
        const result = await pool.query('SELECT id, fullname, username FROM registraraccount');
        res.render('registraracc', { registrarAccounts: result.rows, error: 'Error deleting account.' });
    }
});
// Settings page (Registrar Account Management)


// Registrar & Teacher Account Management page
app.get('/registraracc', async (req, res) => {
    // Only allow access if logged in as ictcoor
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.redirect('/');
    }
    try {
        const result = await pool.query('SELECT id, fullname, username FROM registraraccount');
        res.render('registraracc', { registrarAccounts: result.rows });
    } catch (err) {
        res.render('registraracc', { registrarAccounts: [], error: 'Error loading accounts.' });
    }
});

// Create registrar account (POST)
app.post('/create-registrar-account', async (req, res) => {
    const { fullname, username, password } = req.body;
    try {
        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO registraraccount (fullname, username, password) VALUES ($1, $2, $3)', [fullname, username, hashedPassword]);
        // After creation, reload the list and stay on the same page
        const result = await pool.query('SELECT id, fullname, username FROM registraraccount');
        res.render('registraracc', { registrarAccounts: result.rows });
    } catch (err) {
        // Optionally, handle duplicate username error
        const result = await pool.query('SELECT id, fullname, username FROM registraraccount');
        res.render('registraracc', { registrarAccounts: result.rows, error: 'Error creating account. Username may already exist.' });
    }
});

// Guidance Account Management page
app.get('/guidanceacc', async (req, res) => {
    // Only allow access if logged in as ictcoor
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.redirect('/');
    }
    try {
        const result = await pool.query('SELECT id, fullname, username, email, contact_number, is_active FROM guidance_accounts ORDER BY id');
        res.render('guidanceacc', { guidanceAccounts: result.rows });
    } catch (err) {
        console.error('Error loading guidance accounts:', err);
        res.render('guidanceacc', { guidanceAccounts: [], error: 'Error loading accounts.' });
    }
});

// Create guidance account (POST)
app.post('/create-guidance-account', async (req, res) => {
    const { fullname, username, password, email, contact_number } = req.body;
    try {
        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO guidance_accounts (fullname, username, password, email, contact_number) VALUES ($1, $2, $3, $4, $5)', 
            [fullname, username, hashedPassword, email || null, contact_number || null]
        );
        // After creation, reload the list and stay on the same page
        const result = await pool.query('SELECT id, fullname, username, email, contact_number, is_active FROM guidance_accounts ORDER BY id');
        res.render('guidanceacc', { guidanceAccounts: result.rows });
    } catch (err) {
        console.error('Error creating guidance account:', err);
        // Optionally, handle duplicate username error
        const result = await pool.query('SELECT id, fullname, username, email, contact_number, is_active FROM guidance_accounts ORDER BY id');
        res.render('guidanceacc', { guidanceAccounts: result.rows, error: 'Error creating account. Username may already exist.' });
    }
});

// Delete guidance account (POST)
app.post('/delete-guidance-account', async (req, res) => {
    const { id } = req.body;
    try {
        await pool.query('DELETE FROM guidance_accounts WHERE id = $1', [id]);
        res.redirect('/guidanceacc');
    } catch (err) {
        console.error('Error deleting guidance account:', err);
        const result = await pool.query('SELECT id, fullname, username, email, contact_number, is_active FROM guidance_accounts ORDER BY id');
        res.render('guidanceacc', { guidanceAccounts: result.rows, error: 'Error deleting account.' });
    }
});
// Registrar dashboard route (protected)
app.get('/registrar', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'registrar') {
        return res.redirect('/registrarlogin');
    }
    
    try {
        // Fetch all registration records
        const result = await pool.query(`
            SELECT id, school_year, grade_level, 
                   CONCAT(last_name, ', ', first_name, ' ', COALESCE(middle_name, ''), ' ', COALESCE(ext_name, '')) as learner_name,
                   lrn, mother_name, contact_number, registration_date, created_at
            FROM early_registration 
            ORDER BY created_at DESC
        `);
        
        // Fetch pending enrollment requests
        const requestsResult = await pool.query(`
            SELECT id, request_token, 
                   CONCAT(last_name, ', ', first_name, ' ', COALESCE(middle_name, '')) as learner_name,
                   grade_level, gmail_address, contact_number, created_at, status
            FROM enrollment_requests 
            WHERE status = 'pending'
            ORDER BY created_at DESC
        `);
        
        // Fetch history of reviewed requests
        const historyResult = await pool.query(`
            SELECT id, request_token, 
                   CONCAT(last_name, ', ', first_name, ' ', COALESCE(middle_name, '')) as learner_name,
                   grade_level, gmail_address, status, reviewed_at, rejection_reason
            FROM enrollment_requests 
            WHERE status IN ('approved', 'rejected')
            ORDER BY reviewed_at DESC
        `);
        
        // Calculate metrics for insights
        const totalRequests = requestsResult.rows.length;
        const approvedCount = requestsResult.rows.filter(r => r.status === 'approved').length;
        const rejectedCount = requestsResult.rows.filter(r => r.status === 'rejected').length;
        const pendingCount = requestsResult.rows.filter(r => r.status === 'pending').length;
        
        // Count today's requests
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayRequests = requestsResult.rows.filter(r => {
            const requestDate = new Date(r.date_submitted);
            requestDate.setHours(0, 0, 0, 0);
            return requestDate.getTime() === today.getTime();
        }).length;
        
        res.render('registrarDashboard', { 
            registrations: result.rows,
            requests: requestsResult.rows,
            history: historyResult.rows,
            // Insights metrics
            totalRequests: totalRequests,
            approvedCount: approvedCount,
            rejectedCount: rejectedCount,
            pendingCount: pendingCount,
            todayRequests: todayRequests
        });
    } catch (err) {
        console.error('Error fetching registrations:', err);
        res.render('registrarDashboard', { 
            registrations: [],
            requests: [],
            history: [],
            totalRequests: 0,
            approvedCount: 0,
            rejectedCount: 0,
            pendingCount: 0,
            todayRequests: 0
        });
    }
});

// Handle early registration form submission
app.post('/add-registration', upload.single('signatureImage'), async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'registrar') {
        return res.status(403).json({ error: 'Access denied' });
    }

    const {
        gmail, schoolYear, lrn, gradeLevel, lastName, givenName, middleName, extName,
        birthday, age, sex, religion, address, ipCommunity, ipCommunitySpecify,
        pwd, pwdSpecify, fatherName, motherName, guardianName, contactNumber, date,
           signatureData, printedName
    } = req.body;

    try {
        let signatureImagePath = null;
        
        // Handle signature image upload
        if (req.file) {
            signatureImagePath = `/uploads/signatures/${req.file.filename}`;
        } else if (signatureData) {
            // Handle canvas signature data (base64)
            const base64Data = signatureData.replace(/^data:image\/png;base64,/, "");
            const fileName = `signature-${Date.now()}.png`;
            const filePath = path.join(__dirname, 'uploads', 'signatures', fileName);
            
            // Ensure directory exists
            const uploadDir = path.join(__dirname, 'uploads', 'signatures');
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            
            fs.writeFileSync(filePath, base64Data, 'base64');
            signatureImagePath = `/uploads/signatures/${fileName}`;
        }

        // Insert into database
        const insertQuery = `
            INSERT INTO early_registration (
                gmail_address, school_year, lrn, grade_level, last_name, first_name, 
                middle_name, ext_name, birthday, age, sex, religion, current_address,
                ip_community, ip_community_specify, pwd, pwd_specify, father_name, 
                mother_name, guardian_name, contact_number, registration_date, 
                printed_name, signature_image_path
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
            RETURNING id
        `;

        const values = [
            gmail, schoolYear, lrn || null, gradeLevel, lastName, givenName,
            middleName || null, extName || null, birthday, parseInt(age), sex,
            religion || null, address, ipCommunity, ipCommunitySpecify || null,
            pwd, pwdSpecify || null, fatherName || null, motherName || null,
            guardianName || null, contactNumber || null, date, printedName, signatureImagePath
        ];

        const result = await pool.query(insertQuery, values);
        
        // Return success response
        res.json({ 
            success: true, 
            message: 'Registration added successfully',
            id: result.rows[0].id 
        });

    } catch (err) {
        console.error('Error adding registration:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error adding registration: ' + err.message 
        });
    }
});

// Public landing for status check without token
app.get('/check-status', (req, res) => {
    res.redirect('/check-status.html');
});

// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.redirect('/');
        }
        res.redirect('/login');
    });
});

// Dedicated login page route (avoid conflict with static index.html)
app.get('/login', (req, res) => {
    // Allow force parameter to bypass redirect
    if (req.session.user && !req.query.force) {
        // Redirect to correct landing page based on role
        if (req.session.user.role === 'ictcoor') {
            return res.redirect('/ictcoorLanding');
        } else if (req.session.user.role === 'registrar') {
            return res.redirect('/registrar');
        }
    }
    // Clear session if force parameter is present
    if (req.query.force && req.session.user) {
        return req.session.destroy((err) => {
            if (err) console.error('Session destroy error:', err);
            res.render('login', { error: null });
        });
    }
    res.render('login', { error: null });
});

// Teacher login page route
app.get('/teacher-login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'teacher', 'teacher-login.html'));
});

// Teacher dashboard page (HTML)
app.get('/teacher', (req, res) => {
    console.log('=== /teacher route accessed ===');
    console.log('Session ID:', req.sessionID);
    console.log('Session data:', req.session);
    console.log('Session user:', req.session.user);
    console.log('Cookies:', req.headers.cookie);
    
    if (!req.session.user || req.session.user.role !== 'teacher') {
        console.log('❌ No valid session - redirecting to login');
        return res.redirect('/teacher-login');
    }
    
    console.log('✅ Valid session found - serving dashboard');
    res.sendFile(path.join(__dirname, 'views', 'teacher', 'teacher-demographics.html'));
});

// Teacher logout
app.get('/logout-teacher', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Teacher logout error:', err);
            return res.redirect('/teacher');
        }
        res.clearCookie('connect.sid');
        res.redirect('/teacher-login');
    });
});

// Login page route
app.get('/', (req, res) => {
    // 3. If a session exists, redirect to the landing page
    if (req.session.user) {
        // Redirect to correct landing page based on role
        if (req.session.user.role === 'ictcoor') {
            return res.redirect('/ictcoorLanding');
        } else if (req.session.user.role === 'registrar') {
            return res.redirect('/registrar');
        }
    }
    res.render('login', { error: null });
});

// Route to view registration details by ID
app.get('/registration/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'registrar') {
        return res.status(403).send('Access denied');
    }
    const regId = req.params.id;
    console.log('GET /registration/:id ->', regId);
    try {
        const result = await pool.query('SELECT * FROM early_registration WHERE id = $1', [regId]);
        if (result.rows.length === 0) {
            return res.status(404).send('Registration not found');
        }
        res.render('registrationView', { registration: result.rows[0] });
    } catch (err) {
        console.error('Error fetching registration:', err);
        res.status(500).send('Error fetching registration');
    }
});

// Render edit form for registration
app.get('/registration/:id/edit', async (req, res) => {
    const regId = req.params.id;
    try {
        const result = await pool.query('SELECT * FROM early_registration WHERE id = $1', [regId]);
        if (result.rows.length === 0) {
            return res.status(404).send('Registration not found');
        }
        res.render('registrationEdit', { registration: result.rows[0] });
    } catch (err) {
        console.error('Error fetching registration for edit:', err);
        res.status(500).send('Error fetching registration for edit');
    }
});

// Update registration (Edit)
app.post('/registration/:id/edit', upload.single('signatureImage'), async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'registrar') {
        return res.status(403).send('Access denied');
    }
    const regId = req.params.id;
    const body = req.body || {};
    const {
        printedName, gmail, schoolYear, lrn, gradeLevel,
        lastName, givenName, middleName, extName,
        birthday, age, sex, religion, address,
        ipCommunity, ipCommunitySpecify, pwd, pwdSpecify, fatherName, motherName, guardianName,
        contactNumber, date, signatureData
    } = body;
    try {
        // Determine if signature is being replaced
        let newSignaturePath = null;
        if (req.file) {
            newSignaturePath = `/uploads/signatures/${req.file.filename}`;
        } else if (signatureData) {
            // Save base64 PNG to file
            const base64Data = signatureData.replace(/^data:image\/png;base64,/, "");
            const fileName = `signature-${Date.now()}-${Math.round(Math.random()*1e9)}.png`;
            const dir = path.join(__dirname, 'uploads', 'signatures');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const fullPath = path.join(dir, fileName);
            fs.writeFileSync(fullPath, base64Data, 'base64');
            newSignaturePath = `/uploads/signatures/${fileName}`;
        }

        // If a new signature is provided, delete the old one after updating
        let oldSignaturePath = null;
        if (newSignaturePath) {
            const prev = await pool.query('SELECT signature_image_path FROM early_registration WHERE id = $1', [regId]);
            if (prev.rows.length > 0) oldSignaturePath = prev.rows[0].signature_image_path;
        }

        await pool.query(`
            UPDATE early_registration SET
                printed_name = $1,
                gmail_address = $2,
                school_year = $3,
                lrn = $4,
                grade_level = $5,
                last_name = $6,
                first_name = $7,
                middle_name = $8,
                ext_name = $9,
                birthday = $10,
                age = $11,
                sex = $12,
                religion = $13,
                current_address = $14,
                ip_community = $15,
                ip_community_specify = $16,
                pwd = $17,
                pwd_specify = $18,
                father_name = $19,
                mother_name = $20,
                guardian_name = $21,
                contact_number = $22,
                registration_date = $23,
                signature_image_path = COALESCE($24, signature_image_path),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $25
        `, [
            printedName, gmail, schoolYear, lrn || null, gradeLevel,
            lastName, givenName, middleName || null, extName || null,
            birthday, age, sex, religion || null, address,
            ipCommunity, ipCommunitySpecify || null, pwd, pwdSpecify || null, fatherName || null, motherName || null, guardianName || null,
            contactNumber || null, date, newSignaturePath, regId
        ]);

        // delete old signature file if replaced
        if (newSignaturePath && oldSignaturePath) {
            try {
                // Try as absolute
                if (fs.existsSync(oldSignaturePath)) fs.unlinkSync(oldSignaturePath);
                else {
                    const abs = path.join(__dirname, oldSignaturePath);
                    if (fs.existsSync(abs)) fs.unlinkSync(abs);
                    else {
                        const alt = path.join(__dirname, 'uploads', 'signatures', path.basename(oldSignaturePath));
                        if (fs.existsSync(alt)) fs.unlinkSync(alt);
                    }
                }
            } catch (e) {
                console.warn('Failed to delete old signature file:', e.message);
            }
        }
        res.redirect(`/registration/${regId}`);
    } catch (err) {
        console.error('Error updating registration:', err);
        res.status(500).send('Error updating registration.');
    }
});

// Delete registration
app.post('/registration/:id/delete', async (req, res) => {
    // Allow both registrar and ictcoor to delete registrations
    if (!req.session.user || (req.session.user.role !== 'registrar' && req.session.user.role !== 'ictcoor')) {
        return res.status(403).send('Access denied');
    }
    const regId = req.params.id;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // First, get the registration to find the signature image path
        const result = await client.query('SELECT signature_image_path FROM early_registration WHERE id = $1', [regId]);
        
        if (result.rows.length > 0 && result.rows[0].signature_image_path) {
            let imagePath = result.rows[0].signature_image_path;
            // Try as absolute path
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
                console.log('Deleted signature image (absolute path):', imagePath);
            }
            // Try as relative to project root
            else if (fs.existsSync(path.join(__dirname, imagePath))) {
                fs.unlinkSync(path.join(__dirname, imagePath));
                console.log('Deleted signature image (relative to root):', path.join(__dirname, imagePath));
            }
            // Try as uploads/signatures/<filename>
            else {
                const altPath = path.join(__dirname, 'uploads', 'signatures', path.basename(imagePath));
                if (fs.existsSync(altPath)) {
                    fs.unlinkSync(altPath);
                    console.log('Deleted signature image (uploads/signatures):', altPath);
                } else {
                    console.log('Signature image not found at:', imagePath, 'or', altPath);
                }
            }
        }
        
        // Delete from students table first (if exists) to avoid foreign key constraint
        await client.query('DELETE FROM students WHERE enrollment_id = $1', [regId]);
        
        // Delete the registration record
        await client.query('DELETE FROM early_registration WHERE id = $1', [regId]);
        
        await client.query('COMMIT');
        
        // Redirect based on user role
        if (req.session.user.role === 'registrar') {
            res.redirect('/registrar');
        } else {
            res.redirect('/ictcoorLanding');
        }
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error deleting registration:', err);
        res.status(500).json({ success: false, message: 'Error deleting registration.' });
    } finally {
        client.release();
    }
});

// JSON API: fetch registration details
app.get('/api/registration/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'registrar') {
        return res.status(403).json({ error: 'Access denied' });
    }
    const regId = req.params.id;
    try {
        const result = await pool.query('SELECT * FROM early_registration WHERE id = $1', [regId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Registration not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching registration (API):', err);
        res.status(500).json({ error: 'Error fetching registration' });
    }
});

// JSON API: fetch a pending enrollment request (for editing missing details)
app.get('/api/enrollment-request/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'registrar') {
        return res.status(403).json({ error: 'Access denied' });
    }
    const requestId = req.params.id;
    try {
        const result = await pool.query(`
            SELECT id, request_token, status,
                   gmail_address, school_year, lrn, grade_level,
                   last_name, first_name, middle_name, ext_name,
                   birthday, age, sex, religion, current_address,
                   ip_community, ip_community_specify, pwd, pwd_specify,
                   father_name, mother_name, guardian_name, contact_number,
                   registration_date, printed_name, signature_image_path,
                   created_at
            FROM enrollment_requests
            WHERE id = $1
        `, [requestId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Request not found' });
        }
        res.json({ success: true, request: result.rows[0] });
    } catch (err) {
        console.error('Error fetching enrollment request:', err);
        res.status(500).json({ success: false, error: 'Error fetching enrollment request' });
    }
});

// JSON API: update minimal fields on a pending enrollment request
app.post('/update-request/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'registrar') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const requestId = req.params.id;
    const { father_name, mother_name, guardian_name, contact_number, current_address, religion, ip_community, ip_community_specify, pwd, pwd_specify } = req.body || {};

    try {
        // Ensure request exists and is pending
        const check = await pool.query('SELECT status FROM enrollment_requests WHERE id = $1', [requestId]);
        if (check.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Request not found' });
        }
        if (check.rows[0].status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Only pending requests can be updated' });
        }

        // Build dynamic update
        const fields = [];
        const values = [];
        let idx = 1;
        function add(field, value) {
            if (typeof value !== 'undefined') {
                fields.push(`${field} = $${idx++}`);
                values.push(value === '' ? null : value);
            }
        }
        add('father_name', father_name);
        add('mother_name', mother_name);
        add('guardian_name', guardian_name);
        add('contact_number', contact_number);
        add('current_address', current_address);
        add('religion', religion);
        add('ip_community', ip_community);
        // Only keep specify fields if the flag is 'Yes'
        add('ip_community_specify', ip_community === 'Yes' ? ip_community_specify : null);
        add('pwd', pwd);
        add('pwd_specify', pwd === 'Yes' ? pwd_specify : null);

        if (fields.length === 0) {
            return res.json({ success: true, message: 'No changes provided' });
        }

        fields.push(`updated_at = CURRENT_TIMESTAMP`);
        const query = `UPDATE enrollment_requests SET ${fields.join(', ')} WHERE id = $${idx}`;
        values.push(requestId);

        await pool.query(query, values);
        res.json({ success: true, message: 'Request updated successfully' });
    } catch (err) {
        console.error('Error updating enrollment request:', err);
        res.status(500).json({ success: false, message: 'Error updating request: ' + err.message });
    }
});

// Login POST route
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (user && await bcrypt.compare(password, user.password)) {
            // 4. Store user info in the session
            req.session.user = { id: user.id, role: user.role };
            // Redirect based on role
            if (user.role === 'ictcoor') {
                return res.redirect('/ictcoorLanding');
            } else if (user.role === 'registrar') {
                return res.redirect('/registrar');
            } else {
                return res.redirect('/');
            }
        } else {
            return res.render('login', { error: 'Invalid username or password.' });
        }
    } catch (err) {
        console.error('Login error:', err);
        res.render('login', { error: 'An error occurred during login.' });
    }
});

// RBAC landing page route
app.get('/ictcoorLanding', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.redirect('/login');
    }
    
    try {
        // Fetch officially enrolled students from students table (joined with sections)
        const studentsResult = await pool.query(`
            SELECT 
                st.id,
                st.enrollment_id,
                CONCAT(st.last_name, ', ', st.first_name, ' ', COALESCE(st.middle_name, ''), ' ', COALESCE(st.ext_name, '')) as full_name,
                st.lrn,
                st.grade_level,
                st.sex,
                st.age,
                st.contact_number,
                sec.section_name as assigned_section,
                st.school_year,
                COALESCE(st.created_at, CURRENT_TIMESTAMP)::date as enrollment_date,
                st.enrollment_status
            FROM students st
            LEFT JOIN sections sec ON st.section_id = sec.id
            WHERE st.enrollment_status = 'active' 
                AND (st.is_archived IS NULL OR st.is_archived = false)
            ORDER BY 
                CASE 
                    WHEN st.grade_level = 'Kindergarten' THEN 1
                    WHEN st.grade_level = 'Grade 1' THEN 2
                    WHEN st.grade_level = 'Grade 2' THEN 3
                    WHEN st.grade_level = 'Grade 3' THEN 4
                    WHEN st.grade_level = 'Grade 4' THEN 5
                    WHEN st.grade_level = 'Grade 5' THEN 6
                    WHEN st.grade_level = 'Grade 6' THEN 7
                    WHEN st.grade_level = 'Non-Graded' THEN 8
                    ELSE 9
                END,
                st.last_name, st.first_name
        `);

        // Also fetch enrollees who haven't been assigned yet (for backward compatibility)
        const enrolleesResult = await pool.query(`
            SELECT 
                'ER' || er.id::text as id,
                er.id as enrollment_id,
                CONCAT(er.last_name, ', ', er.first_name, ' ', COALESCE(er.middle_name, ''), ' ', COALESCE(er.ext_name, '')) as full_name,
                er.lrn,
                er.grade_level,
                er.sex,
                er.age,
                er.contact_number,
                NULL as assigned_section,
                er.school_year,
                er.created_at as enrollment_date,
                'pending' as enrollment_status
            FROM early_registration er
            WHERE NOT EXISTS (
                SELECT 1 FROM students st WHERE st.enrollment_id = er.id::text
            )
            ORDER BY 
                CASE 
                    WHEN er.grade_level = 'Kindergarten' THEN 1
                    WHEN er.grade_level = 'Grade 1' THEN 2
                    WHEN er.grade_level = 'Grade 2' THEN 3
                    WHEN er.grade_level = 'Grade 3' THEN 4
                    WHEN er.grade_level = 'Grade 4' THEN 5
                    WHEN er.grade_level = 'Grade 5' THEN 6
                    WHEN er.grade_level = 'Grade 6' THEN 7
                    WHEN er.grade_level = 'Non-Graded' THEN 8
                    ELSE 9
                END,
                er.last_name, er.first_name
        `);

        // Combine both lists: officially enrolled students first, then pending enrollees
        const allStudents = [...studentsResult.rows, ...enrolleesResult.rows];

        res.render('ictcoorLanding', { students: allStudents });
    } catch (err) {
        console.error('ERROR fetching students:', err);
        res.render('ictcoorLanding', { students: [] });
    }
});

// Logout route
app.get('/logout', (req, res) => {
    // 6. Destroy the session
    req.session.destroy(err => {
        if (err) {
            return res.redirect('/registrarlogin');
        }
        res.clearCookie('connect.sid'); // Clear the session cookie
        res.redirect('/registrarlogin');
    });
});

// Logout for registrar: go to registrar login
app.get('/logout-registrar', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.redirect('/registrarlogin');
        }
        res.clearCookie('connect.sid');
        res.redirect('/registrarlogin');
    });
});

// Logout for ictcoor: go to main login page
app.get('/logout-ictcoor', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.redirect('/login');
        }
        res.clearCookie('connect.sid');
        res.redirect('/login');
    });
});

// ===== PUBLIC ENROLLMENT ROUTES =====

// Generate unique token
function generateToken() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude similar looking chars
    let token = '';
    for (let i = 0; i < 12; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
        if ((i + 1) % 4 === 0 && i < 11) token += '-'; // Add dash every 4 chars
    }
    return token;
}

// Public enrollment submission
app.post('/submit-enrollment', enrollmentLimiter, upload.single('signatureImage'), async (req, res) => {
    const {
        gmail, schoolYear, lrn, gradeLevel, lastName, givenName, middleName, extName,
        birthday, age, sex, religion, address, ipCommunity, ipCommunitySpecify,
        pwd, pwdSpecify, fatherName, motherName, guardianName, contactNumber, date,
        signatureData, printedName, honeypot
    } = req.body;

    // Note: Rate limiting is handled by enrollmentLimiter middleware (3 requests per hour per IP)

    // Build current_address from provided parts if 'address' is not present
    const currentAddress = (address && address.trim()) || [
        req.body.houseNo,
        req.body.sitioStreet,
        req.body.barangay,
        req.body.municipality,
        req.body.province,
        req.body.country,
        req.body.zipCode
    ].filter(Boolean).join(', ');

    // Compose parent/guardian names if not provided in single field
    const fatherNameFinal = (fatherName && fatherName.trim()) || [
        req.body.fatherLastName,
        req.body.fatherGivenName,
        req.body.fatherMiddleName,
        req.body.fatherExtName
    ].filter(Boolean).join(' ');

    const motherNameFinal = (motherName && motherName.trim()) || [
        req.body.motherLastName,
        req.body.motherGivenName,
        req.body.motherMiddleName,
        req.body.motherExtName
    ].filter(Boolean).join(' ');

    const guardianNameFinal = (guardianName && guardianName.trim()) || [
        req.body.guardianLastName,
        req.body.guardianGivenName,
        req.body.guardianMiddleName,
        req.body.guardianExtName
    ].filter(Boolean).join(' ');

    // Registration date from client or default now
    const registrationDate = date || req.body.dateSigned || new Date();

    // Ensure NOT NULL friendly values for ip_community and pwd
    const ipCommunityFinal = (ipCommunity || req.body.ipCommunity || 'No');
    const ipCommunitySpecifyFinal = ipCommunityFinal === 'Yes'
        ? (ipCommunitySpecify || req.body.ipCommunitySpecify || null)
        : null;

    const pwdFinal = (pwd || req.body.pwd || 'No');
    const pwdSpecifyFinal = pwdFinal === 'Yes'
        ? (pwdSpecify || req.body.pwdSpecify || null)
        : null;

    try {
        let signatureImagePath = null;
        
        // Handle signature image upload
        if (req.file) {
            signatureImagePath = `/uploads/signatures/${req.file.filename}`;
        } else if (signatureData) {
            // Handle canvas signature data (base64)
            const base64Data = signatureData.replace(/^data:image\/png;base64,/, "");
            const fileName = `signature-${Date.now()}-${Math.round(Math.random()*1e9)}.png`;
            const dir = path.join(__dirname, 'uploads', 'signatures');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const fullPath = path.join(dir, fileName);
            fs.writeFileSync(fullPath, base64Data, 'base64');
            signatureImagePath = `/uploads/signatures/${fileName}`;
        }

        // Generate unique token
        let requestToken;
        let tokenExists = true;
        while (tokenExists) {
            requestToken = generateToken();
            const check = await pool.query('SELECT id FROM enrollment_requests WHERE request_token = $1', [requestToken]);
            tokenExists = check.rows.length > 0;
        }

        const insertQuery = `
            INSERT INTO enrollment_requests (
                request_token, gmail_address, school_year, lrn, grade_level,
                last_name, first_name, middle_name, ext_name,
                birthday, age, sex, religion, current_address,
                ip_community, ip_community_specify, pwd, pwd_specify,
                father_name, mother_name, guardian_name, contact_number,
                registration_date, printed_name, signature_image_path
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
            RETURNING id, request_token
        `;

        // ============= SECURITY: SANITIZE TEXT INPUTS =============
        const values = [
            requestToken, 
            gmail.toLowerCase().trim(), 
            sanitizeText(schoolYear), 
            lrn || null, 
            sanitizeText(gradeLevel),
            sanitizeText(lastName), 
            sanitizeText(givenName), 
            sanitizeText(middleName) || null, 
            sanitizeText(extName) || null,
            birthday, 
            parseInt(age), 
            sex, 
            sanitizeText(religion) || null, 
            sanitizeText(currentAddress) || 'N/A',
            ipCommunityFinal, 
            sanitizeText(ipCommunitySpecifyFinal), 
            pwdFinal, 
            sanitizeText(pwdSpecifyFinal),
            sanitizeText(fatherNameFinal) || null, 
            sanitizeText(motherNameFinal) || null, 
            sanitizeText(guardianNameFinal) || null,
            contactNumber || null, 
            registrationDate, 
            sanitizeText(printedName), 
            signatureImagePath
        ];

        const result = await pool.query(insertQuery, values);
        const token = result.rows[0].request_token;
        
        // ============= SECURITY: LOG SUCCESSFUL SUBMISSION =============
        await logSubmission('enrollment', req, 'success', null, token, { 
            gmail, lrn, gradeLevel, lastName, givenName 
        });
        
        // Return success with token
        res.json({ 
            success: true, 
            message: 'Enrollment request submitted successfully!',
            token: token
        });

    } catch (err) {
        console.error('Error submitting enrollment:', err);
        
        // Auto-create schema if missing
        if (err.message && /relation "enrollment_requests" does not exist/i.test(err.message)) {
            console.warn('⚠️ enrollment_requests table missing – creating now...');
            try {
                await ensureEnrollmentRequestsSchema();
                
                // Retry the submission
                let requestToken;
                let tokenExists = true;
                while (tokenExists) {
                    requestToken = generateToken();
                    const check = await pool.query('SELECT id FROM enrollment_requests WHERE request_token = $1', [requestToken]);
                    tokenExists = check.rows.length > 0;
                }

                const insertQuery = `
                    INSERT INTO enrollment_requests (
                        request_token, gmail_address, school_year, lrn, grade_level,
                        last_name, first_name, middle_name, ext_name,
                        birthday, age, sex, religion, current_address,
                        ip_community, ip_community_specify, pwd, pwd_specify,
                        father_name, mother_name, guardian_name, contact_number,
                        registration_date, printed_name, signature_image_path
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
                    RETURNING id, request_token
                `;

                const values = [
                    requestToken, 
                    gmail.toLowerCase().trim(), 
                    sanitizeText(schoolYear), 
                    lrn || null, 
                    sanitizeText(gradeLevel),
                    sanitizeText(lastName), 
                    sanitizeText(givenName), 
                    sanitizeText(middleName) || null, 
                    sanitizeText(extName) || null,
                    birthday, 
                    parseInt(age), 
                    sex, 
                    sanitizeText(religion) || null, 
                    sanitizeText(currentAddress) || 'N/A',
                    ipCommunityFinal, 
                    sanitizeText(ipCommunitySpecifyFinal), 
                    pwdFinal, 
                    sanitizeText(pwdSpecifyFinal),
                    sanitizeText(fatherNameFinal) || null, 
                    sanitizeText(motherNameFinal) || null, 
                    sanitizeText(guardianNameFinal) || null,
                    contactNumber || null, 
                    registrationDate, 
                    sanitizeText(printedName), 
                    signatureImagePath
                ];

                const result = await pool.query(insertQuery, values);
                const token = result.rows[0].request_token;
                
                await logSubmission('enrollment', req, 'success', null, token, { 
                    gmail, lrn, gradeLevel, lastName, givenName 
                });
                
                return res.json({ 
                    success: true, 
                    message: 'Enrollment request submitted successfully!',
                    token: token
                });
            } catch (inner) {
                console.error('❌ Failed after creating schema:', inner.message);
                await logSubmission('enrollment', req, 'error', inner.message, null, { gmail, lrn });
                return res.status(500).json({ success: false, message: 'Error after schema creation: ' + inner.message });
            }
        }
        
        await logSubmission('enrollment', req, 'error', err.message, null, { gmail, lrn });
        res.status(500).json({ 
            success: false, 
            message: 'Error submitting enrollment: ' + err.message 
        });
    }
});

// Download enrollment form as text/JSON/PDF file
app.get('/download-enrollment/:token', async (req, res) => {
    const token = req.params.token;
    const format = req.query.format || 'pdf'; // 'txt', 'json', or 'pdf'

    try {
        const result = await pool.query(`
            SELECT * FROM enrollment_requests WHERE request_token = $1
        `, [token]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Enrollment request not found' });
        }

        const data = result.rows[0];
        const filename = `enrollment-${token}`;

        if (format === 'json') {
            // Download as JSON
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
            res.json(data);
        } else if (format === 'pdf') {
            // Generate PDF
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);

            const doc = new PDFDocument({ margin: 50 });
            doc.pipe(res);

            // Helper function to format date without time
            const formatDateOnly = (dateString) => {
                if (!dateString) return 'N/A';
                const date = new Date(dateString);
                return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            };

            // Title
            doc.fontSize(20).font('Helvetica-Bold').text('ENROLLMENT FORM', { align: 'center' });
            doc.fontSize(10).font('Helvetica').text('Copy/Download Record', { align: 'center' });
            doc.moveDown();

            // Metadata
            doc.fontSize(9).text(`Generated: ${formatDateOnly(new Date().toISOString())}`, { align: 'right' });
            doc.text(`Request Token: ${data.request_token}`, { align: 'right' });
            doc.text(`Status: ${data.status || 'Pending'}`, { align: 'right' });
            doc.moveDown();

            // Personal Information Section
            doc.fontSize(12).font('Helvetica-Bold').text('PERSONAL INFORMATION');
            doc.fontSize(9).font('Helvetica');
            doc.text(`Email: ${data.gmail_address}`);
            doc.text(`Name: ${data.last_name}, ${data.first_name} ${data.middle_name || ''} ${data.ext_name || ''}`.trim());
            doc.text(`Birthdate: ${data.birthday}`);
            doc.text(`Age: ${data.age}`);
            doc.text(`Sex: ${data.sex}`);
            doc.text(`Religion: ${data.religion || 'N/A'}`);
            doc.text(`LRN: ${data.lrn || 'N/A'}`);
            doc.moveDown();

            // Enrollment Details Section
            doc.fontSize(12).font('Helvetica-Bold').text('ENROLLMENT DETAILS');
            doc.fontSize(9).font('Helvetica');
            doc.text(`School Year: ${data.school_year}`);
            doc.text(`Grade Level: ${data.grade_level}`);
            doc.text(`Current Address: ${data.current_address || 'N/A'}`);
            doc.text(`Contact Number: ${data.contact_number || 'N/A'}`);
            doc.moveDown();

            // Special Information Section
            doc.fontSize(12).font('Helvetica-Bold').text('SPECIAL INFORMATION');
            doc.fontSize(9).font('Helvetica');
            doc.text(`IP Community: ${data.ip_community}`);
            if (data.ip_community_specify) {
                doc.text(`IP Community Specify: ${data.ip_community_specify}`);
            }
            doc.text(`PWD: ${data.pwd}`);
            if (data.pwd_specify) {
                doc.text(`PWD Specify: ${data.pwd_specify}`);
            }
            doc.moveDown();

            // Parent/Guardian Information Section
            doc.fontSize(12).font('Helvetica-Bold').text('PARENT/GUARDIAN INFORMATION');
            doc.fontSize(9).font('Helvetica');
            doc.text(`Father: ${data.father_name || 'N/A'}`);
            doc.text(`Mother: ${data.mother_name || 'N/A'}`);
            doc.text(`Guardian: ${data.guardian_name || 'N/A'}`);
            doc.moveDown();

            // Submission Details Section
            doc.fontSize(12).font('Helvetica-Bold').text('SUBMISSION DETAILS');
            doc.fontSize(9).font('Helvetica');
            doc.text(`Submitted: ${formatDateOnly(data.created_at)}`);
            doc.text(`Printed Name: ${data.printed_name || 'N/A'}`);
            doc.text(`Signature: ${data.signature_image_path ? 'Provided' : 'Not provided'}`);

            // Add footer
            doc.fontSize(8).text('---', { align: 'center' });
            doc.text('This is an official copy of the enrollment form', { align: 'center' });

            doc.end();
        } else {
            // Download as text file
            let content = `ENROLLMENT FORM - COPY/DOWNLOAD\n`;
            content += `===============================================\n`;
            content += `Generated: ${new Date().toLocaleString()}\n`;
            content += `Request Token: ${data.request_token}\n`;
            content += `Status: ${data.status || 'Pending'}\n\n`;
            
            content += `PERSONAL INFORMATION\n`;
            content += `-------------------\n`;
            content += `Gmail: ${data.gmail_address}\n`;
            content += `Name: ${data.last_name}, ${data.first_name} ${data.middle_name || ''} ${data.ext_name || ''}\n`;
            content += `Birthdate: ${data.birthday}\n`;
            content += `Age: ${data.age}\n`;
            content += `Sex: ${data.sex}\n`;
            content += `Religion: ${data.religion || 'N/A'}\n`;
            content += `LRN: ${data.lrn || 'N/A'}\n\n`;

            content += `ENROLLMENT DETAILS\n`;
            content += `------------------\n`;
            content += `School Year: ${data.school_year}\n`;
            content += `Grade Level: ${data.grade_level}\n`;
            content += `Current Address: ${data.current_address || 'N/A'}\n`;
            content += `Contact Number: ${data.contact_number || 'N/A'}\n\n`;

            content += `SPECIAL INFORMATION\n`;
            content += `-------------------\n`;
            content += `IP Community: ${data.ip_community}\n`;
            if (data.ip_community_specify) {
                content += `IP Community Specify: ${data.ip_community_specify}\n`;
            }
            content += `PWD: ${data.pwd}\n`;
            if (data.pwd_specify) {
                content += `PWD Specify: ${data.pwd_specify}\n`;
            }
            content += `\n`;

            content += `PARENT/GUARDIAN INFORMATION\n`;
            content += `---------------------------\n`;
            content += `Father: ${data.father_name || 'N/A'}\n`;
            content += `Mother: ${data.mother_name || 'N/A'}\n`;
            content += `Guardian: ${data.guardian_name || 'N/A'}\n\n`;

            content += `SUBMISSION DETAILS\n`;
            content += `------------------\n`;
            content += `Submitted: ${data.created_at}\n`;
            content += `Printed Name: ${data.printed_name || 'N/A'}\n`;
            content += `Signature: ${data.signature_image_path ? 'Provided' : 'Not provided'}\n`;

            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.txt"`);
            res.send(content);
        }
    } catch (err) {
        console.error('Error downloading enrollment:', err);
        res.status(500).json({ error: 'Error generating download' });
    }
});

// Get enrollment data for display (for copy to clipboard)
app.get('/api/enrollment/:token', async (req, res) => {
    const token = req.params.token;

    try {
        const result = await pool.query(`
            SELECT * FROM enrollment_requests WHERE request_token = $1
        `, [token]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Enrollment request not found' });
        }

        const data = result.rows[0];
        const formattedData = {
            requestToken: data.request_token,
            status: data.status || 'Pending',
            submissionDate: data.created_at,
            learnerName: `${data.last_name}, ${data.first_name} ${data.middle_name || ''} ${data.ext_name || ''}`.trim(),
            gmail: data.gmail_address,
            schoolYear: data.school_year,
            gradeLevel: data.grade_level,
            birthdate: data.birthday,
            age: data.age,
            sex: data.sex,
            lrn: data.lrn || 'N/A',
            address: data.current_address || 'N/A',
            contactNumber: data.contact_number || 'N/A'
        };

        res.json(formattedData);
    } catch (err) {
        console.error('Error fetching enrollment:', err);
        res.status(500).json({ error: 'Error fetching enrollment data' });
    }
});

// Check enrollment status by token
app.get('/check-status/:token', async (req, res) => {
    const token = req.params.token;
    try {
        const result = await pool.query(`
            SELECT id, request_token, status, gmail_address,
                   CONCAT(last_name, ', ', first_name, ' ', COALESCE(middle_name, '')) as learner_name,
                   grade_level, created_at, reviewed_at, rejection_reason
            FROM enrollment_requests 
            WHERE request_token = $1
        `, [token]);

        if (result.rows.length === 0) {
            return res.render('checkStatus', { error: 'Invalid token. Please check and try again.' });
        }

        res.render('checkStatus', { request: result.rows[0], error: null });
    } catch (err) {
        console.error('Error checking status:', err);
        res.render('checkStatus', { error: 'An error occurred. Please try again later.' });
    }
});

// Approve enrollment request
app.post('/approve-request/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'registrar') {
        return res.status(403).send('Access denied');
    }

    const requestId = req.params.id;
    const registrarId = req.session.user.id;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get request details
        const requestResult = await client.query('SELECT * FROM enrollment_requests WHERE id = $1', [requestId]);
        if (requestResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Request not found' });
        }

        const request = requestResult.rows[0];

        // Prevent double-approval
        if (request.status && request.status !== 'pending') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: `Request already ${request.status}.` });
        }

        // Safe defaults for NOT NULL columns in early_registration
        const currentAddress = (request.current_address && String(request.current_address).trim()) || 'N/A';
        const ipCommunity = (request.ip_community && String(request.ip_community).trim()) || 'No';
        const ipCommunitySpecify = ipCommunity === 'Yes' ? (request.ip_community_specify || null) : null;
        const pwd = (request.pwd && String(request.pwd).trim()) || 'No';
        const pwdSpecify = pwd === 'Yes' ? (request.pwd_specify || null) : null;

        const insertQuery = `
            INSERT INTO early_registration (
                gmail_address, school_year, lrn, grade_level,
                last_name, first_name, middle_name, ext_name,
                birthday, age, sex, religion, current_address,
                ip_community, ip_community_specify, pwd, pwd_specify,
                father_name, mother_name, guardian_name, contact_number,
                registration_date, printed_name, signature_image_path
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
            RETURNING id
        `;

        const insertValues = [
            request.gmail_address,
            request.school_year,
            request.lrn || null,
            request.grade_level,
            request.last_name,
            request.first_name,
            request.middle_name || null,
            request.ext_name || null,
            request.birthday,
            request.age,
            request.sex,
            request.religion || null,
            currentAddress,
            ipCommunity,
            ipCommunitySpecify,
            pwd,
            pwdSpecify,
            request.father_name || null,
            request.mother_name || null,
            request.guardian_name || null,
            request.contact_number || null,
            request.registration_date,
            request.printed_name,
            request.signature_image_path || null
        ];

        const inserted = await client.query(insertQuery, insertValues);

        // Update request status
        await client.query(
            `UPDATE enrollment_requests 
             SET status = 'approved', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP 
             WHERE id = $2`,
            [registrarId, requestId]
        );

        // Send approval notification email
        const learnerName = `${request.first_name} ${request.last_name}`;
        await emailService.sendEnrollmentStatusUpdate(request.gmail_address, learnerName, request.request_token, 'approved');

        await client.query('COMMIT');
        res.json({ success: true, message: 'Request approved successfully', early_registration_id: inserted.rows[0].id });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error approving request:', err);
        res.status(500).json({ success: false, message: 'Error approving request: ' + err.message });
    } finally {
        client.release();
    }
});

// Reject enrollment request
app.post('/reject-request/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'registrar') {
        return res.status(403).send('Access denied');
    }

    const requestId = req.params.id;
    const registrarId = req.session.user.id;
    const { reason } = req.body;

    try {
        // Get request details before updating (for email notification)
        const requestResult = await pool.query(`
            SELECT first_name, last_name, gmail_address, request_token 
            FROM enrollment_requests 
            WHERE id = $1
        `, [requestId]);
        
        if (requestResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Request not found' });
        }
        
        const enrollmentRequest = requestResult.rows[0];
        
        await pool.query(`
            UPDATE enrollment_requests 
            SET status = 'rejected', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP, rejection_reason = $2
            WHERE id = $3
        `, [registrarId, reason || 'No reason provided', requestId]);

        // Send rejection notification email
        const learnerName = `${enrollmentRequest.first_name} ${enrollmentRequest.last_name}`;
        await emailService.sendEnrollmentStatusUpdate(enrollmentRequest.gmail_address, learnerName, enrollmentRequest.request_token, 'rejected', reason || 'No reason provided');

        res.json({ success: true, message: 'Request rejected' });
    } catch (err) {
        console.error('Error rejecting request:', err);
        res.status(500).json({ success: false, message: 'Error rejecting request' });
    }
});

// ==================== DOCUMENT REQUEST ROUTES ====================

// Submit document request (public)
app.post('/api/document-request/submit', documentRequestLimiter, async (req, res) => {
    const {
        studentName, studentId, contactNumber, email,
        documentType, purpose, additionalNotes,
        adviserName, adviserSchoolYear, studentType, honeypot
    } = req.body || {};

    // Note: Rate limiting is handled by documentRequestLimiter middleware

    // Helper to insert request
    async function insertRequest() {
        let requestToken;
        let tokenExists = true;
        while (tokenExists) {
            requestToken = generateToken();
            const check = await pool.query('SELECT id FROM document_requests WHERE request_token = $1', [requestToken]);
            tokenExists = check.rows.length > 0;
        }
        const insertQuery = `
            INSERT INTO document_requests (
                request_token, student_name, student_id, contact_number, email,
                document_type, purpose, additional_notes,
                adviser_name, adviser_school_year, student_type, status
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')
            RETURNING id, request_token`;
        // ============= SECURITY: SANITIZE TEXT INPUTS =============
        const values = [
            requestToken, 
            sanitizeText(studentName), 
            sanitizeText(studentId) || null, 
            contactNumber, 
            email.toLowerCase().trim(),
            sanitizeText(documentType), 
            sanitizeText(purpose), 
            sanitizeText(additionalNotes) || null,
            sanitizeText(adviserName), 
            sanitizeText(adviserSchoolYear), 
            studentType
        ];
        const result = await pool.query(insertQuery, values);
        return result.rows[0].request_token;
    }

    try {
        const token = await insertRequest();
        // ============= SECURITY: LOG SUCCESSFUL SUBMISSION =============
        await logSubmission('document_request', req, 'success', null, token, { 
            email, studentName, documentType 
        });
        return res.json({ success: true, message: 'Document request submitted successfully!', token });
    } catch (err) {
        // Auto-create schema if missing
        if (err.message && /relation "document_requests" does not exist/i.test(err.message)) {
            console.warn('⚠️ document_requests table missing – creating now...');
            try {
                await ensureDocumentRequestsSchema();
                const token = await insertRequest();
                await logSubmission('document_request', req, 'success', null, token, { 
                    email, studentName, documentType 
                });
                return res.json({ success: true, message: 'Document request submitted successfully!', token });
            } catch (inner) {
                console.error('❌ Failed after creating schema:', inner.message);
                await logSubmission('document_request', req, 'error', inner.message, null, { email });
                return res.status(500).json({ success: false, message: 'Error after schema creation: ' + inner.message });
            }
        }
        console.error('Error submitting document request:', err.message);
        await logSubmission('document_request', req, 'error', err.message, null, { email });
        return res.status(500).json({ success: false, message: 'Error submitting request: ' + err.message });
    }
});

// Check document request status by token (public)
app.get('/api/document-request/status/:token', async (req, res) => {
    const token = req.params.token.trim().toUpperCase();

    try {
        const result = await pool.query(`
            SELECT id, request_token, status, student_name, student_id,
                   contact_number, email, document_type, purpose, 
                   additional_notes, adviser_name, adviser_school_year,
                   student_type, created_at, processed_at,
                   completion_notes, rejection_reason
            FROM document_requests
            WHERE request_token = $1
        `, [token]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Invalid token. Please check and try again.'
            });
        }

        res.json({
            success: true,
            request: result.rows[0]
        });

    } catch (err) {
        console.error('Error checking document request status:', err);
        res.status(500).json({
            success: false,
            message: 'Error checking status'
        });
    }
});

// Guidance: Get document requests page
app.get('/guidance/document-requests', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/guidance/login');
    }
    res.sendFile(path.join(__dirname, 'views', 'guidance', 'guidance-document-requests.html'));
});

// Guidance: Get all document requests
app.get('/api/guidance/document-requests', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    try {
        const result = await pool.query(`
            SELECT 
                dr.id, dr.request_token, dr.status,
                dr.student_name, dr.student_id, dr.contact_number, dr.email,
                dr.document_type, dr.purpose, dr.additional_notes,
                dr.adviser_name, dr.adviser_school_year, dr.student_type,
                dr.created_at, dr.updated_at, dr.processed_at,
                dr.completion_notes, dr.rejection_reason,
                ga.fullname as processed_by_name
            FROM document_requests dr
            LEFT JOIN guidance_accounts ga ON dr.processed_by = ga.id
            ORDER BY 
                CASE 
                    WHEN dr.status = 'pending' THEN 1
                    WHEN dr.status = 'processing' THEN 2
                    WHEN dr.status = 'ready' THEN 3
                    WHEN dr.status = 'completed' THEN 4
                    WHEN dr.status = 'rejected' THEN 5
                END,
                dr.created_at DESC
        `);

        res.json({
            success: true,
            requests: result.rows
        });

    } catch (err) {
        console.error('Error fetching document requests:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching requests'
        });
    }
});

// Guidance: Update document request status
app.put('/api/guidance/document-requests/:id/status', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const requestId = req.params.id;
    const { status, completion_notes, rejection_reason } = req.body;
    const guidanceId = req.session.guidance_id;

    // Validation
    const validStatuses = ['pending', 'processing', 'ready', 'completed', 'rejected'];
    if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid status'
        });
    }

    if (status === 'rejected' && !rejection_reason) {
        return res.status(400).json({
            success: false,
            message: 'Rejection reason is required'
        });
    }

    try {
        // Get request details before updating (for email notification)
        const getQuery = `SELECT * FROM document_requests WHERE id = $1`;
        const getResult = await pool.query(getQuery, [requestId]);
        
        if (getResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Request not found'
            });
        }
        
        const documentRequest = getResult.rows[0];
        
        const updateQuery = `
            UPDATE document_requests
            SET status = $1,
                processed_by = $2,
                processed_at = CURRENT_TIMESTAMP,
                completion_notes = $3,
                rejection_reason = $4,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $5
            RETURNING *
        `;

        const result = await pool.query(updateQuery, [
            status,
            guidanceId,
            completion_notes || null,
            rejection_reason || null,
            requestId
        ]);

        // Send email notification for status updates that warrant notification
        if (status === 'processing' || status === 'ready' || status === 'rejected') {
            await emailService.sendDocumentRequestStatusUpdate(
                documentRequest.email,
                documentRequest.student_name,
                documentRequest.request_token,
                documentRequest.document_type,
                status,
                rejection_reason || null
            );
        }

        res.json({
            success: true,
            message: 'Status updated successfully',
            request: result.rows[0]
        });

    } catch (err) {
        console.error('Error updating document request status:', err);
        res.status(500).json({
            success: false,
            message: 'Error updating status: ' + err.message
        });
    }
});

// Guidance: Delete a document request (permanent)
app.delete('/api/guidance/document-requests/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const requestId = req.params.id;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Optionally, fetch the request for logging/audit
        const existing = await client.query('SELECT id, request_token, student_name FROM document_requests WHERE id = $1', [requestId]);
        if (existing.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Request not found' });
        }

        // Delete the request
        const del = await client.query('DELETE FROM document_requests WHERE id = $1 RETURNING id', [requestId]);
        await client.query('COMMIT');

        // Optionally log deletion to submission_logs
        try {
            await pool.query(`
                INSERT INTO submission_logs (submission_type, ip_address, user_agent, email, form_data, status, request_token)
                VALUES ($1,$2,$3,$4,$5,$6,$7)
            `, ['document_request_delete', getClientIP(req), req.headers['user-agent'] || null, null, JSON.stringify({ deletedRequestId: requestId }), 'deleted', existing.rows[0].request_token || null]);
        } catch (e) {
            console.warn('Failed to log document request deletion:', e.message);
        }

        res.json({ success: true, message: 'Request deleted' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error deleting document request:', err);
        res.status(500).json({ success: false, message: 'Error deleting request: ' + err.message });
    } finally {
        client.release();
    }
});

// ICT Coordinator: Assign student to section
app.post('/assign-section/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const studentIdentifier = req.params.id;
    const { section } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if this is an early_registration student (ID starts with 'ER')
        if (String(studentIdentifier).startsWith('ER')) {
            // Extract the actual early_registration ID
            const earlyRegId = parseInt(String(studentIdentifier).substring(2));

            // Get early_registration details
            const enrolleeResult = await client.query(`
                SELECT * FROM early_registration WHERE id = $1
            `, [earlyRegId]);

            if (enrolleeResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Enrollee not found' });
            }

            const enrollee = enrolleeResult.rows[0];

            // Verify section exists and has capacity
            const sectionResult = await client.query(`
                SELECT id, section_name, max_capacity, current_count 
                FROM sections 
                WHERE id = $1 AND is_active = true
            `, [section]);

            if (sectionResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Section not found or inactive' });
            }

            const sectionData = sectionResult.rows[0];

            if (sectionData.current_count >= sectionData.max_capacity) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    success: false, 
                    message: `Section ${sectionData.section_name} is full (${sectionData.current_count}/${sectionData.max_capacity})` 
                });
            }

            // Check if this enrollee is already in students table
            const existingStudent = await client.query(`
                SELECT id FROM students WHERE enrollment_id = $1
            `, [earlyRegId]);

            if (existingStudent.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'This enrollee has already been assigned to a section' });
            }

            // Insert into students table
            const insertQuery = `
                INSERT INTO students (
                    enrollment_id, section_id,
                    gmail_address, school_year, lrn, grade_level,
                    last_name, first_name, middle_name, ext_name,
                    birthday, age, sex, religion, current_address,
                    ip_community, ip_community_specify, pwd, pwd_specify,
                    father_name, mother_name, guardian_name, contact_number,
                    enrollment_status, is_archived
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, 'active', false)
                RETURNING id
            `;

            const insertValues = [
                earlyRegId, section,
                enrollee.gmail_address, enrollee.school_year, enrollee.lrn, enrollee.grade_level,
                enrollee.last_name, enrollee.first_name, enrollee.middle_name, enrollee.ext_name,
                enrollee.birthday, enrollee.age, enrollee.sex, enrollee.religion, enrollee.current_address,
                enrollee.ip_community, enrollee.ip_community_specify, enrollee.pwd, enrollee.pwd_specify,
                enrollee.father_name, enrollee.mother_name, enrollee.guardian_name, enrollee.contact_number
            ];

            await client.query(insertQuery, insertValues);

            // Increment section current_count
            await client.query(`
                UPDATE sections 
                SET current_count = current_count + 1, updated_at = CURRENT_TIMESTAMP 
                WHERE id = $1
            `, [section]);

            // Mark the enrollee as processed
            await client.query(`
                UPDATE early_registration 
                SET assigned_section = $1, updated_at = CURRENT_TIMESTAMP 
                WHERE id = $2
            `, [sectionData.section_name, earlyRegId]);

            await client.query('COMMIT');
            res.json({ 
                success: true, 
                message: `Student successfully assigned to ${sectionData.section_name}`
            });
        } else {
            // Handle regular students table (unassigned students)
            const studentId = parseInt(studentIdentifier);

            // Get student details
            const studentResult = await client.query(`
                SELECT * FROM students WHERE id = $1 AND section_id IS NULL
            `, [studentId]);

            if (studentResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Unassigned student not found' });
            }

            // Verify section exists and has capacity
            const sectionResult = await client.query(`
                SELECT id, section_name, max_capacity, current_count 
                FROM sections 
                WHERE id = $1 AND is_active = true
            `, [section]);

            if (sectionResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Section not found or inactive' });
            }

            const sectionData = sectionResult.rows[0];

            if (sectionData.current_count >= sectionData.max_capacity) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    success: false, 
                    message: `Section ${sectionData.section_name} is full (${sectionData.current_count}/${sectionData.max_capacity})` 
                });
            }

            // Assign student to section
            await client.query(`
                UPDATE students SET section_id = $1 WHERE id = $2
            `, [section, studentId]);

            // Increment section current_count
            await client.query(`
                UPDATE sections 
                SET current_count = current_count + 1, updated_at = CURRENT_TIMESTAMP 
                WHERE id = $1
            `, [section]);

            await client.query('COMMIT');
            res.json({ 
                success: true, 
                message: `Student successfully assigned to ${sectionData.section_name}`
            });
        }
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error assigning student to section:', err);
        res.status(500).json({ success: false, message: 'Error assigning student: ' + err.message });
    } finally {
        client.release();
    }
});

// ICT Coordinator: Get active sections for dropdown
app.get('/api/sections', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    try {
        const result = await pool.query(`
            SELECT s.id,
                   s.section_name,
                   s.grade_level,
                   s.max_capacity,
                   COALESCE(cnt.cnt, 0) AS current_count,
                   (s.max_capacity - COALESCE(cnt.cnt, 0)) as available_slots,
                   s.adviser_name,
                   s.room_number
            FROM sections s
            LEFT JOIN (
                SELECT section_id, COUNT(*) AS cnt
                FROM students
                WHERE enrollment_status = 'active'
                GROUP BY section_id
            ) cnt ON cnt.section_id = s.id
            WHERE s.is_active = true
            ORDER BY 
                CASE 
                    WHEN grade_level = 'Kindergarten' THEN 1
                    WHEN grade_level = 'Grade 1' THEN 2
                    WHEN grade_level = 'Grade 2' THEN 3
                    WHEN grade_level = 'Grade 3' THEN 4
                    WHEN grade_level = 'Grade 4' THEN 5
                    WHEN grade_level = 'Grade 5' THEN 6
                    WHEN grade_level = 'Grade 6' THEN 7
                    WHEN grade_level = 'Grade 7' THEN 8
                    WHEN grade_level = 'Grade 8' THEN 9
                    WHEN grade_level = 'Grade 9' THEN 10
                    WHEN grade_level = 'Grade 10' THEN 11
                    WHEN grade_level = 'Non-Graded' THEN 12
                    ELSE 13
                END,
                section_name
        `);

        res.json({ success: true, sections: result.rows });
    } catch (err) {
        console.error('Error fetching sections:', err);
        res.status(500).json({ success: false, message: 'Error fetching sections' });
    }
});

// ICT Coordinator: Get all sections (including inactive) for management
app.get('/api/sections/all', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    try {
        const result = await pool.query(`
            SELECT s.id,
                   s.section_name,
                   s.grade_level,
                   s.max_capacity,
                   COALESCE(cnt.cnt, 0) AS current_count,
                   s.adviser_name,
                   s.room_number,
                   s.is_active,
                   s.created_at
            FROM sections s
            LEFT JOIN (
                SELECT section_id, COUNT(*) AS cnt
                FROM students
                WHERE enrollment_status = 'active'
                GROUP BY section_id
            ) cnt ON cnt.section_id = s.id
            ORDER BY 
                CASE 
                    WHEN grade_level = 'Kindergarten' THEN 1
                    WHEN grade_level = 'Grade 1' THEN 2
                    WHEN grade_level = 'Grade 2' THEN 3
                    WHEN grade_level = 'Grade 3' THEN 4
                    WHEN grade_level = 'Grade 4' THEN 5
                    WHEN grade_level = 'Grade 5' THEN 6
                    WHEN grade_level = 'Grade 6' THEN 7
                    WHEN grade_level = 'Grade 7' THEN 8
                    WHEN grade_level = 'Grade 8' THEN 9
                    WHEN grade_level = 'Grade 9' THEN 10
                    WHEN grade_level = 'Grade 10' THEN 11
                    WHEN grade_level = 'Non-Graded' THEN 12
                    ELSE 13
                END,
                section_name
        `);

        res.json({ success: true, sections: result.rows });
    } catch (err) {
        console.error('Error fetching all sections:', err);
        res.status(500).json({ success: false, message: 'Error fetching sections' });
    }
});

// New snapshot/grouped snapshot endpoints
app.post('/api/sections/snapshots', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
        return res.status(400).json({ success: false, message: 'Snapshot name is required' });
    }

    const snapshotName = String(name).trim();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Create groups and items tables if missing
        await client.query(`
            CREATE TABLE IF NOT EXISTS section_snapshot_groups (
                id SERIAL PRIMARY KEY,
                snapshot_name TEXT NOT NULL,
                created_by INTEGER,
                is_archived BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS section_snapshot_items (
                id SERIAL PRIMARY KEY,
                group_id INTEGER REFERENCES section_snapshot_groups(id) ON DELETE CASCADE,
                section_id INTEGER,
                section_name TEXT,
                grade_level TEXT,
                count INTEGER,
                adviser_name TEXT
            )
        `);

        // Insert group
        const g = await client.query(`INSERT INTO section_snapshot_groups (snapshot_name, created_by) VALUES ($1, $2) RETURNING id, snapshot_name, created_at`, [snapshotName, req.session.user.id || null]);
        const groupId = g.rows[0].id;

        // Get current section counts
        const counts = await client.query(`
            SELECT s.id AS section_id, s.section_name, s.grade_level, COALESCE(cnt.cnt, 0) AS count, s.adviser_name
            FROM sections s
            LEFT JOIN (
                SELECT section_id, COUNT(*) AS cnt
                FROM students
                WHERE enrollment_status = 'active'
                GROUP BY section_id
            ) cnt ON cnt.section_id = s.id
        `);

        for (const r of counts.rows) {
            await client.query(`
                INSERT INTO section_snapshot_items (group_id, section_id, section_name, grade_level, count, adviser_name)
                VALUES ($1,$2,$3,$4,$5,$6)
            `, [groupId, r.section_id, r.section_name, r.grade_level, r.count, r.adviser_name || null]);
        }

        await client.query('COMMIT');
        res.json({ success: true, message: `Snapshot '${snapshotName}' saved`, group: g.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating snapshot group:', err);
        res.status(500).json({ success: false, message: 'Error creating snapshot' });
    } finally {
        client.release();
    }
});

// List snapshot groups
app.get('/api/sections/snapshots', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS section_snapshot_groups (
                id SERIAL PRIMARY KEY,
                snapshot_name TEXT NOT NULL,
                created_by INTEGER,
                is_archived BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS section_snapshot_items (
                id SERIAL PRIMARY KEY,
                group_id INTEGER REFERENCES section_snapshot_groups(id) ON DELETE CASCADE,
                section_id INTEGER,
                section_name TEXT,
                grade_level TEXT,
                count INTEGER,
                adviser_name TEXT
            )
        `);

        const groups = await pool.query(`SELECT id, snapshot_name, created_by, is_archived, created_at FROM section_snapshot_groups ORDER BY created_at DESC`);
        res.json({ success: true, groups: groups.rows });
    } catch (err) {
        console.error('Error listing snapshot groups:', err);
        res.status(500).json({ success: false, message: 'Error listing snapshots' });
    }
});

// Get items for a snapshot group
app.get('/api/sections/snapshots/:id/items', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const gid = req.params.id;
    try {
        const items = await pool.query('SELECT id, section_id, section_name, grade_level, count, adviser_name FROM section_snapshot_items WHERE group_id = $1 ORDER BY grade_level, section_name', [gid]);
        res.json({ success: true, items: items.rows });
    } catch (err) {
        console.error('Error fetching snapshot items:', err);
        res.status(500).json({ success: false, message: 'Error fetching snapshot items' });
    }
});

// Archive (soft-delete) snapshot group
app.put('/api/sections/snapshots/:id/archive', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') return res.status(403).json({ success: false, message: 'Access denied' });
    const gid = req.params.id;
    try {
        const r = await pool.query('UPDATE section_snapshot_groups SET is_archived = true WHERE id = $1 RETURNING id', [gid]);
        if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Snapshot not found' });
        res.json({ success: true, message: 'Snapshot archived' });
    } catch (err) {
        console.error('Error archiving snapshot:', err);
        res.status(500).json({ success: false, message: 'Error archiving snapshot' });
    }
});

// Recover snapshot group
app.put('/api/sections/snapshots/:id/recover', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') return res.status(403).json({ success: false, message: 'Access denied' });
    const gid = req.params.id;
    try {
        const r = await pool.query('UPDATE section_snapshot_groups SET is_archived = false WHERE id = $1 RETURNING id', [gid]);
        if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Snapshot not found' });
        res.json({ success: true, message: 'Snapshot recovered' });
    } catch (err) {
        console.error('Error recovering snapshot:', err);
        res.status(500).json({ success: false, message: 'Error recovering snapshot' });
    }
});

// Permanently delete snapshot group and its items
app.delete('/api/sections/snapshots/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') return res.status(403).json({ success: false, message: 'Access denied' });
    const gid = req.params.id;
    try {
        const r = await pool.query('DELETE FROM section_snapshot_groups WHERE id = $1 RETURNING id', [gid]);
        if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Snapshot not found' });
        res.json({ success: true, message: 'Snapshot permanently deleted' });
    } catch (err) {
        console.error('Error deleting snapshot:', err);
        res.status(500).json({ success: false, message: 'Error deleting snapshot' });
    }
});

// ICT Coordinator: Reset all sections (unassign students). Optionally save snapshot first by providing { snapshotName }
app.post('/api/sections/reset', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { snapshotName } = req.body || {};
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Optionally save snapshot
        if (snapshotName && String(snapshotName).trim()) {
            const name = String(snapshotName).trim();
            await client.query(`
                CREATE TABLE IF NOT EXISTS section_snapshots (
                    id SERIAL PRIMARY KEY,
                    snapshot_name TEXT NOT NULL,
                    section_id INTEGER,
                    section_name TEXT,
                    grade_level TEXT,
                    count INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            const counts = await client.query(`
                SELECT s.id AS section_id, s.section_name, s.grade_level, COALESCE(cnt.cnt, 0) AS count
                FROM sections s
                LEFT JOIN (
                    SELECT section_id, COUNT(*) AS cnt
                    FROM students
                    WHERE enrollment_status = 'active'
                    GROUP BY section_id
                ) cnt ON cnt.section_id = s.id
            `);

            for (const r of counts.rows) {
                await client.query(`
                    INSERT INTO section_snapshots (snapshot_name, section_id, section_name, grade_level, count)
                    VALUES ($1, $2, $3, $4, $5)
                `, [name, r.section_id, r.section_name, r.grade_level, r.count]);
            }
        }

        // Count how many students will be unassigned
        const countRes = await client.query(`SELECT COUNT(*)::int AS cnt FROM students WHERE enrollment_status = 'active' AND section_id IS NOT NULL`);
        const toUnassign = countRes.rows[0].cnt || 0;

        // Unassign students from sections (move to unassigned)
        await client.query(`UPDATE students SET section_id = NULL WHERE enrollment_status = 'active' AND section_id IS NOT NULL`);

        await client.query('COMMIT');
        res.json({ success: true, message: `Reset completed. ${toUnassign} student(s) moved to Unassigned.`, unassigned: toUnassign });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error performing reset of sections:', err);
        res.status(500).json({ success: false, message: 'Error resetting sections' });
    } finally {
        client.release();
    }
});

// ICT Coordinator: Create new section
app.post('/api/sections', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { section_name, grade_level, max_capacity, adviser_name, room_number } = req.body;

    try {
        // Check if section name already exists
        const existing = await pool.query('SELECT id FROM sections WHERE section_name = $1', [section_name]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Section name already exists' });
        }

        const result = await pool.query(`
            INSERT INTO sections (section_name, grade_level, max_capacity, adviser_name, room_number)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [section_name, grade_level, max_capacity || 40, adviser_name || null, room_number || null]);

        res.json({ success: true, message: 'Section created successfully', section: result.rows[0] });
    } catch (err) {
        console.error('Error creating section:', err);
        res.status(500).json({ success: false, message: 'Error creating section: ' + err.message });
    }
});

// ICT Coordinator: Update section
app.put('/api/sections/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const sectionId = req.params.id;
    const { section_name, grade_level, max_capacity, adviser_name, room_number, is_active } = req.body;

    try {
        // Check if new section name conflicts with existing (excluding current section)
        if (section_name) {
            const existing = await pool.query(
                'SELECT id FROM sections WHERE section_name = $1 AND id != $2', 
                [section_name, sectionId]
            );
            if (existing.rows.length > 0) {
                return res.status(400).json({ success: false, message: 'Section name already exists' });
            }
        }

        const result = await pool.query(`
            UPDATE sections 
            SET section_name = COALESCE($1, section_name),
                grade_level = COALESCE($2, grade_level),
                max_capacity = COALESCE($3, max_capacity),
                adviser_name = $4,
                room_number = $5,
                is_active = COALESCE($6, is_active),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $7
            RETURNING *
        `, [section_name, grade_level, max_capacity, adviser_name, room_number, is_active, sectionId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Section not found' });
        }

        res.json({ success: true, message: 'Section updated successfully', section: result.rows[0] });
    } catch (err) {
        console.error('Error updating section:', err);
        res.status(500).json({ success: false, message: 'Error updating section: ' + err.message });
    }
});

// ICT Coordinator: Delete section (soft delete - mark as inactive)
app.delete('/api/sections/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const sectionId = req.params.id;

    try {
        // Check if section has enrolled students
        const students = await pool.query('SELECT COUNT(*) FROM students WHERE section_id = $1', [sectionId]);
        const studentCount = parseInt(students.rows[0].count);

        if (studentCount > 0) {
            return res.status(400).json({ 
                success: false, 
                message: `Cannot delete section with ${studentCount} enrolled student(s). Please reassign students first.` 
            });
        }

        // Soft delete - mark as inactive
        const result = await pool.query(`
            UPDATE sections 
            SET is_active = false, updated_at = CURRENT_TIMESTAMP 
            WHERE id = $1
            RETURNING *
        `, [sectionId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Section not found' });
        }

        res.json({ success: true, message: 'Section deactivated successfully' });
    } catch (err) {
        console.error('Error deleting section:', err);
        res.status(500).json({ success: false, message: 'Error deleting section: ' + err.message });
    }
});

// ICT Coordinator: Toggle section active/inactive status
app.put('/api/sections/:id/toggle', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const sectionId = req.params.id;

    try {
        // Get current status and toggle it
        const current = await pool.query('SELECT is_active FROM sections WHERE id = $1', [sectionId]);
        
        if (current.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Section not found' });
        }

        const newStatus = !current.rows[0].is_active;

        const result = await pool.query(`
            UPDATE sections 
            SET is_active = $1, updated_at = CURRENT_TIMESTAMP 
            WHERE id = $2
            RETURNING *
        `, [newStatus, sectionId]);

        const statusText = newStatus ? 'activated' : 'deactivated';
        res.json({ success: true, message: `Section ${statusText} successfully`, is_active: newStatus });
    } catch (err) {
        console.error('Error toggling section status:', err);
        res.status(500).json({ success: false, message: 'Error toggling section status: ' + err.message });
    }
});

// ICT Coordinator: Remove adviser from a section
app.put('/api/sections/:id/adviser/remove', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const sectionId = req.params.id;

    try {
        let result;
        try {
            // Clear both name and teacher id if column exists
            result = await pool.query(
                `UPDATE sections SET adviser_name = NULL, adviser_teacher_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id, section_name`,
                [sectionId]
            );
        } catch (e) {
            // Fallback when adviser_teacher_id doesn't exist
            result = await pool.query(
                `UPDATE sections SET adviser_name = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id, section_name`,
                [sectionId]
            );
        }

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Section not found' });
        }

        res.json({ success: true, message: `Adviser removed from section ${result.rows[0].section_name}` });
    } catch (err) {
        console.error('Error removing adviser:', err);
        res.status(500).json({ success: false, message: 'Error removing adviser: ' + err.message });
    }
});

// ICT Coordinator: Permanently delete section
app.delete('/api/sections/:id/permanent', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const sectionId = req.params.id;

    try {
        // Check if section has enrolled students
        const students = await pool.query('SELECT COUNT(*) FROM students WHERE section_id = $1', [sectionId]);
        const studentCount = parseInt(students.rows[0].count);

        if (studentCount > 0) {
            return res.status(400).json({ 
                success: false, 
                message: `Cannot permanently delete section with ${studentCount} enrolled student(s). Please reassign students first.` 
            });
        }

        // Permanently delete from database
        const result = await pool.query('DELETE FROM sections WHERE id = $1 RETURNING *', [sectionId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Section not found' });
        }

        res.json({ success: true, message: 'Section permanently deleted' });
    } catch (err) {
        console.error('Error permanently deleting section:', err);
        res.status(500).json({ success: false, message: 'Error permanently deleting section: ' + err.message });
    }
});

// ICT Coordinator: Get students by section ID
// ICT Coordinator: View section details page (full page, not modal)
app.get('/sections/:id/view', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.redirect('/login');
    }

    const sectionId = req.params.id;

    try {
        // Get section details
        const sectionResult = await pool.query(`
            SELECT id, section_name, grade_level, max_capacity, current_count, adviser_name, room_number, is_active
            FROM sections 
            WHERE id = $1
        `, [sectionId]);

        if (sectionResult.rows.length === 0) {
            return res.status(404).send('Section not found');
        }

        const section = sectionResult.rows[0];

        // Get students in this section with full details
        const studentsResult = await pool.query(`
            SELECT 
                st.id,
                st.enrollment_id,
                st.lrn,
                st.grade_level,
                st.last_name,
                st.first_name,
                st.middle_name,
                st.ext_name,
                CONCAT(st.last_name, ', ', st.first_name, ' ', COALESCE(st.middle_name, ''), ' ', COALESCE(st.ext_name, '')) as full_name,
                st.sex,
                st.age,
                st.contact_number,
                st.birthday,
                st.religion,
                st.current_address,
                COALESCE(st.created_at, CURRENT_TIMESTAMP)::date as enrollment_date,
                st.enrollment_status
            FROM students st
            WHERE st.section_id = $1 AND st.enrollment_status = 'active'
            ORDER BY st.last_name, st.first_name
        `, [sectionId]);

        res.render('sectionView', { 
            section: section,
            students: studentsResult.rows
        });
    } catch (err) {
        console.error('Error loading section view:', err);
        res.status(500).send('Error loading section details');
    }
});

app.get('/api/sections/:id/students', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const sectionId = req.params.id;

    try {
        // Get section details
        const sectionResult = await pool.query(`
            SELECT id, section_name, grade_level, max_capacity, current_count, adviser_name, room_number
            FROM sections 
            WHERE id = $1
        `, [sectionId]);

        if (sectionResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Section not found' });
        }

        const section = sectionResult.rows[0];

        // Get students in this section
        const studentsResult = await pool.query(`
            SELECT 
                st.id,
                st.lrn,
                CONCAT(st.last_name, ', ', st.first_name, ' ', COALESCE(st.middle_name, ''), ' ', COALESCE(st.ext_name, '')) as full_name,
                st.last_name,
                st.first_name,
                st.sex,
                st.age,
                st.contact_number,
                COALESCE(st.created_at, CURRENT_TIMESTAMP)::date as enrollment_date,
                st.enrollment_status
            FROM students st
            WHERE st.section_id = $1 AND st.enrollment_status = 'active'
            ORDER BY st.last_name, st.first_name
        `, [sectionId]);

        // Count male and female students
        const maleCount = studentsResult.rows.filter(s => s.sex === 'Male').length;
        const femaleCount = studentsResult.rows.filter(s => s.sex === 'Female').length;

        res.json({ 
            success: true, 
            section: section,
            students: studentsResult.rows,
            statistics: {
                total: studentsResult.rows.length,
                male: maleCount,
                female: femaleCount
            }
        });
    } catch (err) {
        console.error('Error fetching section students:', err);
        res.status(500).json({ success: false, message: 'Error fetching section students' });
    }
});

// ICT Coordinator: Reassign student to a new section
app.put('/api/students/:id/reassign', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const studentId = req.params.id;
    const { newSectionId } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if this is an early_registration student (ID starts with 'ER')
        if (String(studentId).startsWith('ER')) {
            // Extract the actual early_registration ID
            const earlyRegId = parseInt(String(studentId).substring(2));

            // Get early_registration details
            const earlyRegResult = await client.query('SELECT * FROM early_registration WHERE id = $1', [earlyRegId]);
            if (earlyRegResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Early registration record not found' });
            }

            const earlyReg = earlyRegResult.rows[0];

            // Verify new section exists and has capacity
            const newSectionResult = await client.query(`
                SELECT id, section_name, max_capacity, current_count 
                FROM sections 
                WHERE id = $1 AND is_active = true
            `, [newSectionId]);

            if (newSectionResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'New section not found or inactive' });
            }

            const newSection = newSectionResult.rows[0];

            if (newSection.current_count >= newSection.max_capacity) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    success: false, 
                    message: `Section ${newSection.section_name} is full (${newSection.current_count}/${newSection.max_capacity})` 
                });
            }

            // Insert into students table from early_registration
            await client.query(`
                INSERT INTO students (
                    lrn, school_year, grade_level, last_name, first_name, middle_name, ext_name,
                    birthday, age, sex, religion, current_address, contact_number,
                    enrollment_status, section_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                ON CONFLICT DO NOTHING
            `, [
                earlyReg.lrn,
                earlyReg.school_year,
                earlyReg.grade_level,
                earlyReg.last_name,
                earlyReg.first_name,
                earlyReg.middle_name || null,
                earlyReg.ext_name || null,
                earlyReg.birthday,
                earlyReg.age,
                earlyReg.sex,
                earlyReg.religion || null,
                earlyReg.current_address,
                earlyReg.contact_number || null,
                'active',
                newSectionId
            ]);

            // Increment new section count
            await client.query('UPDATE sections SET current_count = current_count + 1 WHERE id = $1', [newSectionId]);

            await client.query('COMMIT');
            res.json({ success: true, message: `Student enrolled and assigned to ${newSection.section_name}` });
        } else {
            // Handle regular students table
            // Get current student info
            const studentResult = await client.query('SELECT section_id FROM students WHERE id = $1', [studentId]);
            if (studentResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Student not found' });
            }

            const oldSectionId = studentResult.rows[0].section_id;

            // Verify new section exists and has capacity
            const newSectionResult = await client.query(`
                SELECT id, section_name, max_capacity, current_count 
                FROM sections 
                WHERE id = $1 AND is_active = true
            `, [newSectionId]);

            if (newSectionResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'New section not found or inactive' });
            }

            const newSection = newSectionResult.rows[0];

            if (newSection.current_count >= newSection.max_capacity) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    success: false, 
                    message: `Section ${newSection.section_name} is full (${newSection.current_count}/${newSection.max_capacity})` 
                });
            }

            // Update student's section
            await client.query('UPDATE students SET section_id = $1 WHERE id = $2', [newSectionId, studentId]);

            // Decrement old section count (if student had a section)
            if (oldSectionId) {
                await client.query('UPDATE sections SET current_count = current_count - 1 WHERE id = $1', [oldSectionId]);
            }

            // Increment new section count
            await client.query('UPDATE sections SET current_count = current_count + 1 WHERE id = $1', [newSectionId]);

            await client.query('COMMIT');
            res.json({ success: true, message: `Student reassigned to ${newSection.section_name}` });
        }
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error reassigning student:', err);
        res.status(500).json({ success: false, message: 'Error reassigning student: ' + err.message });
    } finally {
        client.release();
    }
});

// ICT Coordinator: Remove student from section (unassign)
app.put('/api/students/:id/remove-section', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const studentId = req.params.id;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get current student info
        const studentResult = await client.query('SELECT section_id FROM students WHERE id = $1', [studentId]);
        if (studentResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        const currentSectionId = studentResult.rows[0].section_id;

        if (!currentSectionId) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'Student is not assigned to any section' });
        }

        // Remove student from section (set section_id to NULL)
        await client.query('UPDATE students SET section_id = NULL WHERE id = $1', [studentId]);

        // Decrement section count
        await client.query('UPDATE sections SET current_count = current_count - 1 WHERE id = $1', [currentSectionId]);

        await client.query('COMMIT');
        res.json({ success: true, message: 'Student removed from section and moved to unassigned' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error removing student from section:', err);
        res.status(500).json({ success: false, message: 'Error removing student: ' + err.message });
    } finally {
        client.release();
    }
});

// ICT Coordinator: Get unassigned students (students with section_id = NULL from students table OR newly approved from early_registration)
app.get('/api/students/unassigned', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    try {
        // Query 1: Get unassigned students from students table (section_id IS NULL)
        const studentsResult = await pool.query(`
            SELECT 
                st.id,
                st.lrn,
                CONCAT(st.last_name, ', ', st.first_name, ' ', COALESCE(st.middle_name, ''), ' ', COALESCE(st.ext_name, '')) as full_name,
                st.grade_level,
                st.sex,
                st.age,
                st.contact_number,
                COALESCE(st.created_at, CURRENT_TIMESTAMP)::date as enrollment_date,
                st.enrollment_status,
                'students' as source
            FROM students st
            WHERE st.section_id IS NULL 
              AND st.enrollment_status = 'active'
            ORDER BY st.grade_level, st.last_name, st.first_name
        `);

        // Query 2: Get newly approved students from early_registration (not yet added to students table)
        const earlyRegResult = await pool.query(`
            SELECT 
                'ER' || er.id as id,
                er.lrn,
                CONCAT(er.last_name, ', ', er.first_name, ' ', COALESCE(er.middle_name, ''), ' ', COALESCE(er.ext_name, '')) as full_name,
                er.grade_level,
                er.sex,
                er.age,
                er.contact_number,
                er.registration_date as enrollment_date,
                'active' as enrollment_status,
                'early_registration' as source
            FROM early_registration er
            LEFT JOIN students st ON st.lrn = er.lrn AND st.school_year = er.school_year
            WHERE st.id IS NULL
            ORDER BY er.grade_level, er.last_name, er.first_name
        `);

        // Combine results: students first, then early_registration
        const combinedResults = [...studentsResult.rows, ...earlyRegResult.rows];

        res.json(combinedResults);
    } catch (err) {
        console.error('Error fetching unassigned students:', err);
        res.status(500).json({ success: false, message: 'Error fetching unassigned students' });
    }
});

// ICT Coordinator: Archive a student
app.put('/api/students/:id/archive', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const studentId = req.params.id;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Get student info
        const studentResult = await client.query(
            'SELECT full_name, section_id FROM students WHERE id = $1',
            [studentId]
        );

        if (studentResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        const student = studentResult.rows[0];

        // Archive the student
        await client.query(
            'UPDATE students SET is_archived = true WHERE id = $1',
            [studentId]
        );

        await client.query('COMMIT');
        res.json({ 
            success: true, 
            message: `Student "${student.full_name}" has been archived successfully.`
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error archiving student:', err);
        res.status(500).json({ success: false, message: 'Error archiving student' });
    } finally {
        client.release();
    }
});

// ICT Coordinator: Unarchive (restore) a student
app.put('/api/students/:id/unarchive', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const studentId = req.params.id;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Get student info
        const studentResult = await client.query(
            'SELECT full_name FROM students WHERE id = $1',
            [studentId]
        );

        if (studentResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        const student = studentResult.rows[0];

        // Restore the student
        await client.query(
            'UPDATE students SET is_archived = false WHERE id = $1',
            [studentId]
        );

        await client.query('COMMIT');
        res.json({ 
            success: true, 
            message: `Student "${student.full_name}" has been restored successfully.`
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error restoring student:', err);
        res.status(500).json({ success: false, message: 'Error restoring student' });
    } finally {
        client.release();
    }
});

// ICT Coordinator: Get archived students
app.get('/api/students/archived', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    try {
        const result = await pool.query(`
            SELECT 
                s.id,
                s.enrollment_id,
                s.lrn,
                s.grade_level,
                s.last_name,
                s.first_name,
                s.middle_name,
                s.ext_name,
                CONCAT(s.last_name, ', ', s.first_name, ' ', COALESCE(s.middle_name, ''), ' ', COALESCE(s.ext_name, '')) AS full_name,
                s.age,
                s.sex,
                s.contact_number,
                sec.section_name as assigned_section,
                COALESCE(s.created_at, CURRENT_TIMESTAMP)::date as enrollment_date
            FROM students s
            LEFT JOIN sections sec ON s.section_id = sec.id
            WHERE s.is_archived = true
            ORDER BY s.grade_level, s.last_name, s.first_name
        `);

        res.json({ success: true, students: result.rows });
    } catch (err) {
        console.error('Error fetching archived students:', err);
        res.status(500).json({ success: false, message: 'Error fetching archived students' });
    }
});

// ICT Coordinator: Get ALL students (both active and archived) for checkbox filtering
app.get('/api/students/all', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    try {
        // Get students from students table (both active and archived)
        const studentsResult = await pool.query(`
            SELECT 
                s.id,
                s.enrollment_id,
                s.lrn,
                s.grade_level,
                s.last_name,
                s.first_name,
                s.middle_name,
                s.ext_name,
                CONCAT(s.last_name, ', ', s.first_name, ' ', COALESCE(s.middle_name, ''), ' ', COALESCE(s.ext_name, '')) AS full_name,
                s.age,
                s.sex,
                s.contact_number,
                sec.section_name as assigned_section,
                COALESCE(s.created_at, CURRENT_TIMESTAMP)::date as enrollment_date,
                s.enrollment_status,
                COALESCE(s.is_archived, false) as is_archived
            FROM students s
            LEFT JOIN sections sec ON s.section_id = sec.id
            WHERE s.enrollment_status = 'active'
            ORDER BY 
                CASE 
                    WHEN s.grade_level = 'Kindergarten' THEN 1
                    WHEN s.grade_level = 'Grade 1' THEN 2
                    WHEN s.grade_level = 'Grade 2' THEN 3
                    WHEN s.grade_level = 'Grade 3' THEN 4
                    WHEN s.grade_level = 'Grade 4' THEN 5
                    WHEN s.grade_level = 'Grade 5' THEN 6
                    WHEN s.grade_level = 'Grade 6' THEN 7
                    WHEN s.grade_level = 'Non-Graded' THEN 8
                    ELSE 9
                END,
                s.last_name, s.first_name
        `);

        // Also get enrollees who haven't been assigned yet (pending)
        const enrolleesResult = await pool.query(`
            SELECT 
                'ER' || er.id::text as id,
                er.id as enrollment_id,
                er.lrn,
                er.grade_level,
                er.last_name,
                er.first_name,
                er.middle_name,
                er.ext_name,
                CONCAT(er.last_name, ', ', er.first_name, ' ', COALESCE(er.middle_name, ''), ' ', COALESCE(er.ext_name, '')) as full_name,
                er.age,
                er.sex,
                er.contact_number,
                NULL as assigned_section,
                er.created_at as enrollment_date,
                'pending' as enrollment_status,
                false as is_archived
            FROM early_registration er
            WHERE NOT EXISTS (
                SELECT 1 FROM students st WHERE st.enrollment_id = er.id::text
            )
            ORDER BY 
                CASE 
                    WHEN er.grade_level = 'Kindergarten' THEN 1
                    WHEN er.grade_level = 'Grade 1' THEN 2
                    WHEN er.grade_level = 'Grade 2' THEN 3
                    WHEN er.grade_level = 'Grade 3' THEN 4
                    WHEN er.grade_level = 'Grade 4' THEN 5
                    WHEN er.grade_level = 'Grade 5' THEN 6
                    WHEN er.grade_level = 'Grade 6' THEN 7
                    WHEN er.grade_level = 'Non-Graded' THEN 8
                    ELSE 9
                END,
                er.last_name, er.first_name
        `);

        // Combine: pending enrollees + all students (active & archived)
        const allStudents = [...enrolleesResult.rows, ...studentsResult.rows];

        res.json({ success: true, students: allStudents });
    } catch (err) {
        console.error('Error fetching all students:', err);
        res.status(500).json({ success: false, message: 'Error fetching students' });
    }
});

// ICT Coordinator: Get full student details by ID
app.get('/api/student/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    let studentId = req.params.id;
    try {
        // Check if this is an early_registration student (ID starts with 'ER')
        if (String(studentId).startsWith('ER')) {
            // Extract the numeric ID from the ER prefix
            const erNumericId = parseInt(String(studentId).substring(2));
            
            // Query early_registration table
            const result = await pool.query(`
                SELECT 
                    $1 as id,
                    gmail_address,
                    school_year,
                    lrn,
                    grade_level,
                    last_name,
                    first_name,
                    middle_name,
                    ext_name,
                    CONCAT(last_name, ', ', first_name, ' ', COALESCE(middle_name, ''), ' ', COALESCE(ext_name, '')) AS full_name,
                    birthday,
                    age,
                    sex,
                    religion,
                    current_address,
                    ip_community,
                    ip_community_specify,
                    pwd,
                    pwd_specify,
                    father_name,
                    mother_name,
                    guardian_name,
                    contact_number,
                    registration_date as enrollment_date,
                    printed_name,
                    NULL as assigned_section,
                    signature_image_path,
                    created_at,
                    updated_at
                FROM early_registration
                WHERE id = $2
            `, [studentId, erNumericId]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Early registration student not found' });
            }
            
            return res.json(result.rows[0]);
        }
        
        // For regular students, query students table
        let result = await pool.query(`
            SELECT 
                id,
                enrollment_id,
                gmail_address,
                school_year,
                lrn,
                grade_level,
                last_name,
                first_name,
                middle_name,
                ext_name,
                CONCAT(last_name, ', ', first_name, ' ', COALESCE(middle_name, ''), ' ', COALESCE(ext_name, '')) AS full_name,
                birthday,
                age,
                sex,
                religion,
                current_address,
                ip_community,
                ip_community_specify,
                pwd,
                pwd_specify,
                father_name,
                mother_name,
                guardian_name,
                contact_number,
                enrollment_date,
                enrollment_status
            FROM students
            WHERE id = $1
        `, [studentId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching student details:', err);
        res.status(500).json({ success: false, message: 'Error fetching student details' });
    }
});

// ======================== TEACHERS MANAGEMENT ENDPOINTS ========================

// Debug endpoint to check current session
app.get('/api/debug/session', (req, res) => {
    res.json({
        session: req.session,
        user: req.session.user || null,
        role: req.session.user?.role || 'none'
    });
});

// Get all teachers
app.get('/api/teachers', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    try {
        // Fetch active teachers
        const activeResult = await pool.query(`
            SELECT 
                id,
                username,
                first_name,
                middle_name,
                last_name,
                ext_name,
                CONCAT(first_name, ' ', COALESCE(middle_name || ' ', ''), last_name, COALESCE(' ' || ext_name, '')) AS full_name,
                email,
                contact_number,
                birthday,
                sex,
                address,
                employee_id,
                department,
                position,
                specialization,
                date_hired,
                is_active,
                created_at,
                false AS is_archived
            FROM teachers
            ORDER BY last_name, first_name
        `);

        // Fetch archived teachers (if table exists)
        let archivedTeachers = [];
        try {
            const tbl = await pool.query(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'teachers_archive'
                ) AS exists
            `);
            if (tbl.rows[0]?.exists) {
                const archivedResult = await pool.query(`
                    SELECT 
                        original_id AS id,
                        username,
                        first_name,
                        middle_name,
                        last_name,
                        ext_name,
                        CONCAT(first_name, ' ', COALESCE(middle_name || ' ', ''), last_name, COALESCE(' ' || ext_name, '')) AS full_name,
                        email,
                        contact_number,
                        birthday,
                        sex,
                        address,
                        employee_id,
                        department,
                        position,
                        specialization,
                        date_hired,
                        is_active,
                        created_at,
                        true AS is_archived
                    FROM teachers_archive
                    ORDER BY last_name, first_name
                `);
                archivedTeachers = archivedResult.rows;
            }
        } catch (err) {
            console.warn('Warning: Could not fetch archived teachers:', err.message);
        }

        // Combine active and archived teachers
        const allTeachers = [...activeResult.rows, ...archivedTeachers];
        res.json({ success: true, teachers: allTeachers });
    } catch (err) {
        console.error('Error fetching teachers:', err);
        res.status(500).json({ success: false, message: 'Error fetching teachers' });
    }
});

// Get single teacher by ID
app.get('/api/teachers/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const teacherId = req.params.id;

    try {
        const result = await pool.query(`
            SELECT 
                id,
                username,
                first_name,
                middle_name,
                last_name,
                ext_name,
                email,
                contact_number,
                birthday,
                sex,
                address,
                employee_id,
                department,
                position,
                specialization,
                date_hired,
                is_active
            FROM teachers
            WHERE id = $1
        `, [teacherId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Teacher not found' });
        }

        res.json({ success: true, teacher: result.rows[0] });
    } catch (err) {
        console.error('Error fetching teacher:', err);
        res.status(500).json({ success: false, message: 'Error fetching teacher' });
    }
});

// Create new teacher
app.post('/api/teachers', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const {
        username,
        password,
        first_name,
        middle_name,
        last_name,
        ext_name,
        email,
        contact_number,
        birthday,
        sex,
        address,
        employee_id,
        department,
        position,
        specialization,
        date_hired
    } = req.body;

    // Debug: log incoming contact number
    console.log('DEBUG POST /api/teachers contact_number:', req.body && req.body.contact_number);

    // Validate required fields
    if (!username || !password || !first_name || !last_name) {
        return res.status(400).json({ 
            success: false, 
            message: 'Username, password, first name, and last name are required' 
        });
    }

    try {
        // Check if username already exists
        const existingUser = await pool.query(
            'SELECT id FROM teachers WHERE username = $1',
            [username]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Username already exists' 
            });
        }

        // Check if employee_id already exists (if provided)
        if (employee_id) {
            const existingEmpId = await pool.query(
                'SELECT id FROM teachers WHERE employee_id = $1',
                [employee_id]
            );

            if (existingEmpId.rows.length > 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Employee ID already exists' 
                });
            }
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert new teacher
        const result = await pool.query(`
            INSERT INTO teachers (
                username, password, first_name, middle_name, last_name, ext_name,
                email, contact_number, birthday, sex, address,
                employee_id, department, position, specialization, date_hired
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            RETURNING id, username, first_name, middle_name, last_name, ext_name
        `, [
            username, hashedPassword, first_name, middle_name || null, last_name, ext_name || null,
            email || null, contact_number || null, birthday || null, sex || null, address || null,
            employee_id || null, department || null, position || null, specialization || null, date_hired || null
        ]);

        res.json({ 
            success: true, 
            message: 'Teacher account created successfully',
            teacher: result.rows[0]
        });
    } catch (err) {
        console.error('Error creating teacher:', err);
        res.status(500).json({ success: false, message: 'Error creating teacher account' });
    }
});

// Update teacher
app.put('/api/teachers/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const teacherId = req.params.id;
    const {
        username,
        password,
        first_name,
        middle_name,
        last_name,
        ext_name,
        email,
        contact_number,
        birthday,
        sex,
        address,
        employee_id,
        department,
        position,
        specialization,
        date_hired,
        is_active
    } = req.body;

    // Debug: log incoming contact number for update
    console.log('DEBUG PUT /api/teachers/:id contact_number:', req.body && req.body.contact_number);

    try {
        // Check if teacher exists
        const existingTeacher = await pool.query(
            'SELECT id FROM teachers WHERE id = $1',
            [teacherId]
        );

        if (existingTeacher.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Teacher not found' });
        }

        // Check if new username conflicts with another teacher
        if (username) {
            const usernameCheck = await pool.query(
                'SELECT id FROM teachers WHERE username = $1 AND id != $2',
                [username, teacherId]
            );

            if (usernameCheck.rows.length > 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Username already taken by another teacher' 
                });
            }
        }

        // Check if new employee_id conflicts
        if (employee_id) {
            const empIdCheck = await pool.query(
                'SELECT id FROM teachers WHERE employee_id = $1 AND id != $2',
                [employee_id, teacherId]
            );

            if (empIdCheck.rows.length > 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Employee ID already taken by another teacher' 
                });
            }
        }

        // Build update query
        let updateQuery = `
            UPDATE teachers SET
                username = $1,
                first_name = $2,
                middle_name = $3,
                last_name = $4,
                ext_name = $5,
                email = $6,
                contact_number = $7,
                birthday = $8,
                sex = $9,
                address = $10,
                employee_id = $11,
                department = $12,
                position = $13,
                specialization = $14,
                date_hired = $15,
                is_active = $16,
                updated_at = CURRENT_TIMESTAMP
        `;

        let queryParams = [
            username, first_name, middle_name || null, last_name, ext_name || null,
            email || null, contact_number || null, birthday || null, sex || null, address || null,
            employee_id || null, department || null, position || null, specialization || null, 
            date_hired || null, is_active !== undefined ? is_active : true
        ];

        // If password is provided, hash and update it
        if (password && password.trim() !== '') {
            const hashedPassword = await bcrypt.hash(password, 10);
            updateQuery += `, password = $${queryParams.length + 1}`;
            queryParams.push(hashedPassword);
        }

        updateQuery += ` WHERE id = $${queryParams.length + 1} RETURNING id, username, first_name, last_name`;
        queryParams.push(teacherId);

        const result = await pool.query(updateQuery, queryParams);

        res.json({ 
            success: true, 
            message: 'Teacher updated successfully',
            teacher: result.rows[0]
        });
    } catch (err) {
        console.error('Error updating teacher:', err);
        res.status(500).json({ success: false, message: 'Error updating teacher' });
    }
});

// Delete teacher
app.delete('/api/teachers/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const teacherId = req.params.id;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // First check if teacher is in active teachers table
        let t = await client.query(
            'SELECT id, first_name, middle_name, last_name FROM teachers WHERE id = $1',
            [teacherId]
        );
        
        let teacher = null;
        let fromArchive = false;

        if (t.rows.length === 0) {
            // Check if teacher is in archive table (by original_id)
            const archCheck = await client.query(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'teachers_archive'
                ) AS has_table
            `);
            
            if (archCheck.rows[0]?.has_table) {
                const archRes = await client.query(
                    'SELECT original_id, first_name, last_name FROM teachers_archive WHERE original_id = $1',
                    [teacherId]
                );
                if (archRes.rows.length > 0) {
                    teacher = archRes.rows[0];
                    fromArchive = true;
                }
            }
            
            if (!teacher) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Teacher not found' });
            }
        } else {
            teacher = t.rows[0];
        }

        const adviserName = `${teacher.first_name} ${teacher.middle_name || ''} ${teacher.last_name}`.replace(/\s+/g, ' ').trim();

        // Clear all section adviser references (both by ID and name) without aborting the transaction
        // 1) Check if sections.adviser_teacher_id exists before updating
        const colCheck = await client.query(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_schema = 'public' AND table_name = 'sections' AND column_name = 'adviser_teacher_id'
            ) AS has_col
        `);
        if (colCheck.rows[0]?.has_col) {
            await client.query('UPDATE sections SET adviser_teacher_id = NULL WHERE adviser_teacher_id = $1', [teacherId]);
        }
        // 2) Always clear by name for backward compatibility
        await client.query('UPDATE sections SET adviser_name = NULL WHERE adviser_name = $1', [adviserName]);

        // Clear behavior reports teacher reference only if the table exists
        const tblCheck = await client.query(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'student_behavior_reports'
            ) AS has_table
        `);
        if (tblCheck.rows[0]?.has_table) {
            await client.query('UPDATE student_behavior_reports SET teacher_id = NULL WHERE teacher_id = $1', [teacherId]);
        }

        // Delete from the appropriate table
        let result;
        if (fromArchive) {
            result = await client.query(
                'DELETE FROM teachers_archive WHERE original_id = $1 RETURNING original_id as id, first_name, last_name',
                [teacherId]
            );
        } else {
            result = await client.query(
                'DELETE FROM teachers WHERE id = $1 RETURNING id, first_name, last_name',
                [teacherId]
            );
        }

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Teacher not found or already deleted' });
        }

        await client.query('COMMIT');

        res.json({ 
            success: true, 
            message: `Teacher ${result.rows[0].first_name} ${result.rows[0].last_name} deleted successfully` 
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error deleting teacher:', err);
        console.error('Error details:', {
            message: err.message,
            code: err.code,
            detail: err.detail,
            constraint: err.constraint
        });
        res.status(500).json({ 
            success: false, 
            message: `Error deleting teacher: ${err.message || 'Database error'}` 
        });
    } finally {
        client.release();
    }
});

// Toggle teacher active status
app.put('/api/teachers/:id/toggle', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const teacherId = req.params.id;

    try {
        const result = await pool.query(`
            UPDATE teachers 
            SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP 
            WHERE id = $1 
            RETURNING id, first_name, last_name, is_active
        `, [teacherId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Teacher not found' });
        }

        const teacher = result.rows[0];
        const status = teacher.is_active ? 'activated' : 'deactivated';

        res.json({ 
            success: true, 
            message: `Teacher ${teacher.first_name} ${teacher.last_name} has been ${status}`,
            is_active: teacher.is_active
        });
    } catch (err) {
        console.error('Error toggling teacher status:', err);
        res.status(500).json({ success: false, message: 'Error toggling teacher status' });
    }
});

// Assign teacher as adviser to a section
app.put('/api/teachers/:teacherId/assign-section', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const teacherId = req.params.teacherId;
    const { sectionId } = req.body;

    try {
        // Get teacher details
        const teacherResult = await pool.query(
            'SELECT id, first_name, middle_name, last_name FROM teachers WHERE id = $1',
            [teacherId]
        );

        if (teacherResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Teacher not found' });
        }

        const teacher = teacherResult.rows[0];
        const adviserName = `${teacher.first_name} ${teacher.middle_name || ''} ${teacher.last_name}`.replace(/\s+/g, ' ').trim();

        // Exclusively assign: clear teacher as adviser from any other sections first
        // Prefer clearing by adviser_teacher_id if column exists; otherwise by adviser_name
        try {
            await pool.query(
                `UPDATE sections 
                 SET adviser_name = NULL, adviser_teacher_id = NULL, updated_at = CURRENT_TIMESTAMP 
                 WHERE adviser_teacher_id = $1 AND id != $2`,
                [teacherId, sectionId]
            );
        } catch (e) {
            // Column may not exist; clear by name
            await pool.query(
                `UPDATE sections 
                 SET adviser_name = NULL, updated_at = CURRENT_TIMESTAMP 
                 WHERE adviser_name = $1 AND id != $2`,
                [adviserName, sectionId]
            );
        }

        // Update target section with adviser (store teacher id if column exists)
        let result;
        try {
            result = await pool.query(`
                UPDATE sections 
                SET adviser_name = $1, adviser_teacher_id = $2, updated_at = CURRENT_TIMESTAMP 
                WHERE id = $3 
                RETURNING id, section_name, adviser_name
            `, [adviserName, teacherId, sectionId]);
        } catch (e) {
            // Fallback if adviser_teacher_id doesn't exist yet
            result = await pool.query(`
                UPDATE sections 
                SET adviser_name = $1, updated_at = CURRENT_TIMESTAMP 
                WHERE id = $2 
                RETURNING id, section_name, adviser_name
            `, [adviserName, sectionId]);
        }

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Section not found' });
        }

        res.json({ 
            success: true, 
            message: `${adviserName} has been assigned as adviser to ${result.rows[0].section_name}`,
            section: result.rows[0]
        });
    } catch (err) {
        console.error('Error assigning teacher to section:', err);
        res.status(500).json({ success: false, message: 'Error assigning teacher as adviser' });
    }
});

    // Serve Registrar Analytics Page
    app.get('/registrar/analytics', (req, res) => {
        if (!req.session.user || req.session.user.role !== 'registrar') {
            return res.redirect('/registrarlogin');
        }
        res.render('registrarAnalytics', { user: req.session.user });
    });

    // Serve Guidance Analytics Page
    app.get('/guidance/analytics', (req, res) => {
        if (!req.session.user || req.session.user.role !== 'admin') {
            return res.redirect('/guidance/login');
        }
        res.render('guidance/guidanceAnalytics', { user: req.session.user });
    });

// Initialize database schemas on startup
async function initializeSchemas() {
    try {
        await ensureEnrollmentRequestsSchema();
        await ensureDocumentRequestsSchema();
        await ensureSubmissionLogsSchema();
        await ensureBlockedIPsSchema();
    } catch (err) {
        console.error('Error initializing schemas:', err.message);
    }
}

// Dashboard summary and charts data
app.get('/api/dashboard/summary', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    try {
        // Aggregate counts
        const [teacherCounts, studentCounts, sectionCounts, avgClassSize] = await Promise.all([
            pool.query(`
                SELECT 
                    COUNT(*)::int AS total,
                    SUM(CASE WHEN is_active THEN 1 ELSE 0 END)::int AS active,
                    SUM(CASE WHEN NOT is_active THEN 1 ELSE 0 END)::int AS inactive
                FROM teachers
            `),
            pool.query(`
                SELECT 
                    COUNT(*)::int AS total,
                    SUM(CASE WHEN COALESCE(is_archived, false) = false THEN 1 ELSE 0 END)::int AS active,
                    SUM(CASE WHEN COALESCE(is_archived, false) = true THEN 1 ELSE 0 END)::int AS archived,
                    SUM(CASE WHEN sex = 'Male' THEN 1 ELSE 0 END)::int AS male,
                    SUM(CASE WHEN sex = 'Female' THEN 1 ELSE 0 END)::int AS female
                FROM students
            `),
            pool.query(`
                SELECT 
                    COUNT(*)::int AS total,
                    SUM(CASE WHEN is_active THEN 1 ELSE 0 END)::int AS active
                FROM sections
            `),
            pool.query(`
                SELECT COALESCE(ROUND(AVG(current_count)::numeric, 2), 0)::float AS avg_size,
                       COALESCE(SUM(current_count),0)::int AS total_enrolled,
                       COALESCE(SUM(max_capacity),0)::int AS total_capacity
                FROM sections
            `)
        ]);

        // Grade-level distribution (by sections joined with students)
        const gradeDist = await pool.query(`
            SELECT s.grade_level, COUNT(st.id)::int AS count
            FROM sections s
            LEFT JOIN students st ON st.section_id = s.id AND st.enrollment_status = 'active'
            GROUP BY s.grade_level
            ORDER BY s.grade_level
        `);

        // Enrollment trend by month (this year)
        const enrollTrend = await pool.query(`
            SELECT TO_CHAR(date_trunc('month', st.created_at), 'YYYY-MM') AS ym,
                   COUNT(*)::int AS count
            FROM students st
            WHERE st.created_at >= date_trunc('year', CURRENT_DATE)
            GROUP BY ym
            ORDER BY ym
        `);

        // Sections overview breakdown
        const sectionsOverview = await pool.query(`
            SELECT s.id, s.section_name,
                   COALESCE(SUM(CASE WHEN st.enrollment_status = 'active' THEN 1 ELSE 0 END),0)::int AS total,
                   COALESCE(SUM(CASE WHEN st.enrollment_status = 'active' AND st.sex = 'Female' THEN 1 ELSE 0 END),0)::int AS girls,
                   COALESCE(SUM(CASE WHEN st.enrollment_status = 'active' AND st.sex = 'Male' THEN 1 ELSE 0 END),0)::int AS boys
            FROM sections s
            LEFT JOIN students st ON st.section_id = s.id
            GROUP BY s.id, s.section_name
            ORDER BY s.section_name
        `);

        const tc = teacherCounts.rows[0];
        const sc = studentCounts.rows[0];
        const sec = sectionCounts.rows[0];
        const avg = avgClassSize.rows[0];

        const capacityUtil = avg.total_capacity > 0 ? Math.round((avg.total_enrolled / avg.total_capacity) * 100) : 0;

        return res.json({
            success: true,
            metrics: {
                teachers: { total: tc.total, active: tc.active, inactive: tc.inactive },
                students: { total: sc.total, active: sc.active, archived: sc.archived, male: sc.male, female: sc.female },
                sections: { total: sec.total, active: sec.active },
                avgClassSize: avg.avg_size,
                capacityUtilization: capacityUtil
            },
            charts: {
                gradeDistribution: gradeDist.rows,
                enrollmentTrend: enrollTrend.rows
            },
            sectionsOverview: sectionsOverview.rows
        });
    } catch (err) {
        console.error('Dashboard summary error:', err);
        return res.status(500).json({ success: false, message: 'Failed to load dashboard summary' });
    }
});

// ======================== TEACHER AUTH & PORTAL ========================
// Teacher Login API
app.post('/api/teacher/login', async (req, res) => {
    const { username, password, rememberMe } = req.body || {};
    console.log('Login attempt for username:', username);
    try {
        const result = await pool.query(
                'SELECT id, username, password, first_name, middle_name, last_name, is_active FROM teachers WHERE username = $1',
            [username]
        );
        const teacher = result.rows[0];
        if (!teacher || !teacher.is_active) {
            console.log('Login failed: Invalid credentials or inactive account');
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        const ok = await bcrypt.compare(password, teacher.password);
        if (!ok) {
            console.log('Login failed: Wrong password');
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        
        console.log('Password verified for teacher:', teacher.id);
        req.session.user = { id: teacher.id, role: 'teacher', name: `${teacher.first_name} ${teacher.middle_name || ''} ${teacher.last_name}`.replace(/\s+/g, ' ').trim() };
        
        if (rememberMe) {
            req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30; // 30 days
        } else {
            req.session.cookie.expires = false; // Session cookie only
        }
        
        console.log('Session before save:', req.session);
        
        // Save session before responding to ensure it's persisted
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).json({ success: false, error: 'Session save failed' });
            }
            console.log('Session saved successfully. Session ID:', req.sessionID);
            console.log('Session user:', req.session.user);
            return res.json({ success: true });
        });
    } catch (err) {
        console.error('Teacher login error:', err);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

// Teacher Logout
app.get('/logout-teacher', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.redirect('/teacher');
        }
        res.clearCookie('connect.sid');
        res.redirect('/teacher-login');
    });
});

// Guidance: Archive a behavior report (moves to archived table)
app.post('/api/guidance/behavior-reports/:id/archive', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const id = req.params.id;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Ensure archive table exists (safe to run multiple times)
        await client.query(`
            CREATE TABLE IF NOT EXISTS student_behavior_reports_archive (
                id SERIAL PRIMARY KEY,
                original_id INTEGER,
                student_id INTEGER,
                section_id INTEGER,
                teacher_id INTEGER,
                report_date DATE,
                category VARCHAR(255),
                severity VARCHAR(50),
                notes TEXT,
                archived_by INTEGER,
                archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Fetch the report
        const r = await client.query('SELECT * FROM student_behavior_reports WHERE id = $1', [id]);
        if (r.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Report not found' });
        }
        const row = r.rows[0];

        // Insert into archive
        await client.query(`
            INSERT INTO student_behavior_reports_archive
                (original_id, student_id, section_id, teacher_id, report_date, category, severity, notes, archived_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `, [row.id, row.student_id, row.section_id, row.teacher_id, row.report_date, row.category, row.severity, row.notes, req.session.user.id]);

        // Delete original
        await client.query('DELETE FROM student_behavior_reports WHERE id = $1', [id]);

        await client.query('COMMIT');
        res.json({ success: true, message: 'Report archived' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Failed to archive report:', err);
        res.status(500).json({ success: false, error: 'Failed to archive report' });
    } finally {
        client.release();
    }
});

// Guidance: List archived behavior reports
app.get('/api/guidance/behavior-reports/archived', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Access denied' });
    }
    try {
        // If archive table doesn't exist, return empty
        const tableCheck = await pool.query(`
            SELECT to_regclass('public.student_behavior_reports_archive') IS NOT NULL AS exists
        `);
        if (!tableCheck.rows[0].exists) {
            return res.json({ success: true, reports: [] });
        }

        const result = await pool.query(`
            SELECT a.id, a.original_id, a.student_id, a.section_id, a.teacher_id, a.report_date, a.category, a.severity, a.notes, a.archived_by, a.archived_at,
                   CONCAT(s.last_name, ', ', s.first_name, ' ', COALESCE(s.middle_name, '')) AS student_full_name,
                   CONCAT(t.last_name, ', ', t.first_name) AS teacher_name,
                   sec.section_name
            FROM student_behavior_reports_archive a
            LEFT JOIN students s ON s.id = a.student_id
            LEFT JOIN teachers t ON t.id = a.teacher_id
            LEFT JOIN sections sec ON sec.id = a.section_id
            ORDER BY a.archived_at DESC
        `);

        res.json({ success: true, reports: result.rows });
    } catch (err) {
        console.error('Failed to load archived reports:', err);
        res.status(500).json({ success: false, error: 'Failed to load archived reports' });
    }
});

// Guidance: Permanently delete an archived behavior report
app.delete('/api/guidance/behavior-reports/archived/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const id = req.params.id;
    try {
        const result = await pool.query('DELETE FROM student_behavior_reports_archive WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Archived report not found' });
        res.json({ success: true, message: 'Archived report permanently deleted' });
    } catch (err) {
        console.error('Failed to delete archived report:', err);
        res.status(500).json({ success: false, error: 'Failed to delete archived report' });
    }
});

// Guidance: Recover an archived behavior report back to active reports
app.post('/api/guidance/behavior-reports/archived/:id/recover', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const archiveId = req.params.id;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Fetch the archived row
        const ar = await client.query('SELECT * FROM student_behavior_reports_archive WHERE id = $1', [archiveId]);
        if (ar.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Archived report not found' });
        }
        const a = ar.rows[0];

        // Try insert with original foreign keys first
        try {
            const insert = await client.query(`
                INSERT INTO student_behavior_reports (student_id, section_id, teacher_id, report_date, category, severity, notes)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
            `, [a.student_id, a.section_id, a.teacher_id, a.report_date, a.category, a.severity, a.notes]);

            // Delete archive record
            await client.query('DELETE FROM student_behavior_reports_archive WHERE id = $1', [archiveId]);
            await client.query('COMMIT');
            return res.json({ success: true, restored_id: insert.rows[0].id });
        } catch (insertErr) {
            // If insert failed (likely FK constraint), attempt a fallback: insert without FK references
            console.warn('Primary restore insert failed, attempting fallback insert (nullify FK refs):', insertErr.message);
            const fallbackNotes = (a.notes || '') + `\n[RESTORED-FROM-ARCHIVE original_ids: original_id=${a.original_id || 'NULL'}, student_id=${a.student_id || 'NULL'}, section_id=${a.section_id || 'NULL'}, teacher_id=${a.teacher_id || 'NULL'}]`;
            const fallback = await client.query(`
                INSERT INTO student_behavior_reports (student_id, section_id, teacher_id, report_date, category, severity, notes)
                VALUES (NULL, NULL, NULL, $1, $2, $3, $4)
                RETURNING id
            `, [a.report_date, a.category, a.severity, fallbackNotes]);

            // Delete archive record
            await client.query('DELETE FROM student_behavior_reports_archive WHERE id = $1', [archiveId]);
            await client.query('COMMIT');
            return res.json({ success: true, restored_id: fallback.rows[0].id, note: 'Restored with FK references set to NULL; original ids added to notes.' });
        }

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Failed to recover archived report:', err);
        // Provide error details to client for easier debugging
        const message = err && err.message ? err.message : 'Failed to recover archived report';
        res.status(500).json({ success: false, error: message, detail: err && err.detail ? err.detail : null });
    } finally {
        client.release();
    }
});

// Guidance: Mark behavior report as done/undone (adds is_done column if missing)
app.put('/api/guidance/behavior-reports/:id/done', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const id = req.params.id;
    const doneFlag = req.body && typeof req.body.done !== 'undefined' ? !!req.body.done : true;
    const client = await pool.connect();
    try {
        // Ensure column exists
        await client.query(`ALTER TABLE student_behavior_reports ADD COLUMN IF NOT EXISTS is_done BOOLEAN DEFAULT false`);

        const result = await client.query(`UPDATE student_behavior_reports SET is_done = $1 WHERE id = $2 RETURNING id`, [doneFlag, id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Report not found' });
        res.json({ success: true, message: doneFlag ? 'Report marked as done' : 'Report marked as active' });
    } catch (err) {
        console.error('Failed to mark report done:', err);
        res.status(500).json({ success: false, error: 'Failed to update report status' });
    } finally {
        client.release();
    }
});

// Ensure messaging schema includes is_archived column (safe to run at startup)
async function ensureMessagingSchema() {
    try {
        // create table if missing (keeps prior setup_messaging behavior)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS guidance_teacher_messages (
                id SERIAL PRIMARY KEY,
                guidance_id INTEGER NOT NULL REFERENCES guidance_accounts(id) ON DELETE CASCADE,
                teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
                student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
                message TEXT NOT NULL,
                is_read BOOLEAN DEFAULT false,
                is_archived BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Add column if missing (safe alter)
        const colCheck = await pool.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'guidance_teacher_messages' AND column_name = 'is_archived'
        `);
        if (colCheck.rows.length === 0) {
            await pool.query(`ALTER TABLE guidance_teacher_messages ADD COLUMN is_archived BOOLEAN DEFAULT false;`);
        }

        // Create helpful indexes (idempotent)
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_gtm_teacher ON guidance_teacher_messages(teacher_id, created_at DESC);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_gtm_guidance ON guidance_teacher_messages(guidance_id, created_at DESC);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_gtm_unread ON guidance_teacher_messages(teacher_id, is_read) WHERE is_read = false;`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_gtm_archived ON guidance_teacher_messages(guidance_id, is_archived);`);

        console.log('✅ ensureMessagingSchema OK');
    } catch (err) {
        console.error('❌ ensureMessagingSchema failed:', err.message);
    }
}

// All schema initialization is now handled by initializeSchemas() function
// (called automatically after database connection is established)

// Archive a sent message (soft-delete)
app.post('/api/guidance/messages/:id/archive', async (req, res) => {
    if (!req.session.guidance_id) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const id = req.params.id;
    try {
        const result = await pool.query(`
            UPDATE guidance_teacher_messages
            SET is_archived = true
            WHERE id = $1 AND guidance_id = $2
            RETURNING id
        `, [id, req.session.guidance_id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Message not found' });
        res.json({ success: true });
    } catch (err) {
        console.error('Failed to archive message:', err);
        res.status(500).json({ success: false, error: 'Failed to archive message' });
    }
});

// Recover an archived message
app.post('/api/guidance/messages/:id/recover', async (req, res) => {
    if (!req.session.guidance_id) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const id = req.params.id;
    try {
        const result = await pool.query(`
            UPDATE guidance_teacher_messages
            SET is_archived = false
            WHERE id = $1 AND guidance_id = $2
            RETURNING id
        `, [id, req.session.guidance_id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Message not found' });
        res.json({ success: true });
    } catch (err) {
        console.error('Failed to recover message:', err);
        res.status(500).json({ success: false, error: 'Failed to recover message' });
    }
});

// Permanently delete a message (guidance only)
app.delete('/api/guidance/messages/:id', async (req, res) => {
    if (!req.session.guidance_id) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const id = req.params.id;
    try {
        const result = await pool.query(`DELETE FROM guidance_teacher_messages WHERE id = $1 AND guidance_id = $2 RETURNING id`, [id, req.session.guidance_id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Message not found' });
        res.json({ success: true });
    } catch (err) {
        console.error('Failed to delete message:', err);
        res.status(500).json({ success: false, error: 'Failed to delete message' });
    }
});

// Archive (move teacher to teachers_archive table)
// Get archived teachers (from teachers_archive)
app.get('/api/teachers/archived', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }
    try {
        // If archive table doesn't exist yet, return empty list instead of 500
        const tbl = await pool.query(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = $1
            ) AS exists
        `, ['teachers_archive']);
        if (!tbl.rows[0] || !tbl.rows[0].exists) {
            return res.json({ success: true, teachers: [] });
        }

        const result = await pool.query(`
            SELECT id AS archive_id, original_id, username, first_name, middle_name, last_name, ext_name, email, contact_number, is_active, archived_at, archived_by, created_at, updated_at
            FROM teachers_archive
            ORDER BY archived_at DESC
        `);
        res.json({ success: true, teachers: result.rows });
    } catch (err) {
        console.error('Error fetching archived teachers:', err);
        res.status(500).json({ success: false, message: 'Error fetching archived teachers' });
    }
});

// Archive teacher (soft delete) - move from active to archive
app.put('/api/teachers/:id/archive', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const teacherId = req.params.id;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const tRes = await client.query('SELECT * FROM teachers WHERE id = $1', [teacherId]);
        if (tRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Teacher not found' });
        }
        const teacher = tRes.rows[0];

        // Ensure archive table exists
        await client.query(`
            CREATE TABLE IF NOT EXISTS teachers_archive (
                id SERIAL PRIMARY KEY,
                original_id INTEGER,
                username VARCHAR(50),
                password VARCHAR(255),
                first_name VARCHAR(50),
                middle_name VARCHAR(50),
                last_name VARCHAR(50),
                ext_name VARCHAR(10),
                email VARCHAR(100),
                contact_number VARCHAR(20),
                birthday DATE,
                sex VARCHAR(10),
                address TEXT,
                employee_id VARCHAR(50),
                department VARCHAR(100),
                position VARCHAR(100),
                specialization VARCHAR(100),
                date_hired DATE,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP,
                updated_at TIMESTAMP,
                archived_by INTEGER,
                archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Insert teacher into archive
        const insertRes = await client.query(`
            INSERT INTO teachers_archive (
                original_id, username, password, first_name, middle_name, last_name, ext_name,
                email, contact_number, birthday, sex, address, employee_id, department, position,
                specialization, date_hired, is_active, created_at, updated_at, archived_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
            RETURNING id
        `, [
            teacher.id, teacher.username, teacher.password, teacher.first_name, teacher.middle_name || null, teacher.last_name, teacher.ext_name || null,
            teacher.email || null, teacher.contact_number || null, teacher.birthday || null, teacher.sex || null, teacher.address || null,
            teacher.employee_id || null, teacher.department || null, teacher.position || null, teacher.specialization || null,
            teacher.date_hired || null, teacher.is_active !== undefined ? teacher.is_active : true, teacher.created_at || null, teacher.updated_at || null, req.session.user.id
        ]);

        // Clear adviser references in sections (both by id and by name)
        const adviserName = `${teacher.first_name} ${teacher.middle_name || ''} ${teacher.last_name}`.replace(/\s+/g, ' ').trim();
        try {
            await client.query('UPDATE sections SET adviser_teacher_id = NULL WHERE adviser_teacher_id = $1', [teacherId]);
        } catch (e) {
            // ignore
        }
        await client.query('UPDATE sections SET adviser_name = NULL WHERE adviser_name = $1', [adviserName]);

        // Clear behavior reports teacher reference if table exists
        const tblCheck = await client.query(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'student_behavior_reports'
            ) AS has_table
        `);
        if (tblCheck.rows[0]?.has_table) {
            await client.query('UPDATE student_behavior_reports SET teacher_id = NULL WHERE teacher_id = $1', [teacherId]);
        }

        // Finally remove from teachers
        await client.query('DELETE FROM teachers WHERE id = $1', [teacherId]);

        await client.query('COMMIT');

        res.json({ success: true, message: `Teacher ${teacher.first_name} ${teacher.last_name} archived`, archive_id: insertRes.rows[0].id });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error archiving teacher (move):', err);
        res.status(500).json({ success: false, message: 'Error archiving teacher' });
    } finally {
        client.release();
    }
});

// Recover archived teacher (move back to active teachers table)
app.put('/api/teachers/:id/recover', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const teacherId = req.params.id;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if archive table exists and get archived teacher
        const tblCheck = await client.query(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'teachers_archive'
            ) AS has_table
        `);
        
        if (!tblCheck.rows[0]?.has_table) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Archived teacher not found' });
        }

        // Get archived teacher by original_id
        const archRes = await client.query('SELECT * FROM teachers_archive WHERE original_id = $1', [teacherId]);
        if (archRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Archived teacher not found' });
        }
        const archived = archRes.rows[0];

        // Insert back into active teachers table
        const insertRes = await client.query(`
            INSERT INTO teachers (
                id, username, password, first_name, middle_name, last_name, ext_name,
                email, contact_number, birthday, sex, address, employee_id, department, position,
                specialization, date_hired, is_active, created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
            RETURNING id
        `, [
            archived.original_id, archived.username, archived.password, archived.first_name, 
            archived.middle_name || null, archived.last_name, archived.ext_name || null,
            archived.email || null, archived.contact_number || null, archived.birthday || null, 
            archived.sex || null, archived.address || null, archived.employee_id || null, 
            archived.department || null, archived.position || null, archived.specialization || null,
            archived.date_hired || null, archived.is_active !== undefined ? archived.is_active : true, 
            archived.created_at || null, archived.updated_at || null
        ]);

        // Delete from archive table
        await client.query('DELETE FROM teachers_archive WHERE original_id = $1', [teacherId]);

        await client.query('COMMIT');

        res.json({ success: true, message: `Teacher ${archived.first_name} ${archived.last_name} recovered` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error recovering teacher:', err);
        res.status(500).json({ success: false, message: 'Error recovering teacher' });
    } finally {
        client.release();
    }
});

// Recover an archived teacher (move back from teachers_archive to teachers)
app.put('/api/teachers/:archiveId/recover', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const archiveId = req.params.archiveId;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Ensure archive table exists
        const tbl = await client.query(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = $1
            ) AS exists
        `, ['teachers_archive']);
        if (!tbl.rows[0] || !tbl.rows[0].exists) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Archive table not found' });
        }

        const ar = await client.query('SELECT * FROM teachers_archive WHERE id = $1', [archiveId]);
        if (ar.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Archived teacher not found' });
        }
        const a = ar.rows[0];

        // Try to restore with original_id if possible
        let insertRes;
        try {
            insertRes = await client.query(`
                INSERT INTO teachers (
                    id, username, password, first_name, middle_name, last_name, ext_name,
                    email, contact_number, birthday, sex, address, employee_id, department, position,
                    specialization, date_hired, is_active, created_at, updated_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
                RETURNING id
            `, [
                a.original_id || null, a.username, a.password, a.first_name, a.middle_name || null, a.last_name, a.ext_name || null,
                a.email || null, a.contact_number || null, a.birthday || null, a.sex || null, a.address || null,
                a.employee_id || null, a.department || null, a.position || null, a.specialization || null,
                a.date_hired || null, a.is_active !== undefined ? a.is_active : true, a.created_at || null, a.updated_at || null
            ]);
        } catch (insertErr) {
            // Fallback: insert without specifying id (let sequence pick one)
            console.warn('Primary restore insert failed, attempting fallback insert:', insertErr.message);
            insertRes = await client.query(`
                INSERT INTO teachers (
                    username, password, first_name, middle_name, last_name, ext_name,
                    email, contact_number, birthday, sex, address, employee_id, department, position,
                    specialization, date_hired, is_active, created_at, updated_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
                RETURNING id
            `, [
                a.username, a.password, a.first_name, a.middle_name || null, a.last_name, a.ext_name || null,
                a.email || null, a.contact_number || null, a.birthday || null, a.sex || null, a.address || null,
                a.employee_id || null, a.department || null, a.position || null, a.specialization || null,
                a.date_hired || null, a.is_active !== undefined ? a.is_active : true, a.created_at || null, a.updated_at || null
            ]);
        }

        // Delete archive row
        await client.query('DELETE FROM teachers_archive WHERE id = $1', [archiveId]);

        await client.query('COMMIT');

        res.json({ success: true, message: 'Teacher recovered', id: insertRes.rows[0].id });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error recovering archived teacher:', err);
        res.status(500).json({ success: false, message: 'Error recovering archived teacher' });
    } finally {
        client.release();
    }
});

// Permanently delete an archived teacher
app.delete('/api/teachers/archive/:archiveId', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const archiveId = req.params.archiveId;
    try {
        // Check archive table exists
        const tbl = await pool.query(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = $1
            ) AS exists
        `, ['teachers_archive']);
        if (!tbl.rows[0] || !tbl.rows[0].exists) {
            return res.status(404).json({ success: false, message: 'Archive table not found' });
        }

        const result = await pool.query('DELETE FROM teachers_archive WHERE id = $1 RETURNING id, original_id, first_name, last_name', [archiveId]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Archived teacher not found' });
        const r = result.rows[0];
        res.json({ success: true, message: `Archived teacher ${r.first_name} ${r.last_name} permanently deleted` });
    } catch (err) {
        console.error('Failed to delete archived teacher:', err);
        res.status(500).json({ success: false, message: 'Failed to delete archived teacher' });
    }
});

// DEBUG: inspect teachers_archive (count + sample rows) - useful to verify archive content
app.get('/api/debug/teachers-archive', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }
    try {
        const tbl = await pool.query(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = $1
            ) AS exists
        `, ['teachers_archive']);
        if (!tbl.rows[0] || !tbl.rows[0].exists) {
            return res.json({ success: true, count: 0, sample: [] });
        }

        const c = await pool.query('SELECT COUNT(*)::int AS cnt FROM teachers_archive');
        const sample = await pool.query('SELECT id AS archive_id, original_id, first_name, last_name, username, archived_at FROM teachers_archive ORDER BY archived_at DESC LIMIT 50');
        res.json({ success: true, count: c.rows[0].cnt, sample: sample.rows });
    } catch (err) {
        console.error('Debug: failed to inspect teachers_archive:', err);
        res.status(500).json({ success: false, message: 'Failed to inspect teachers_archive', error: err && err.message });
    }
});

// Get single archived teacher by archive id
app.get('/api/teachers/archive/:archiveId', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ictcoor') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const archiveId = req.params.archiveId;
    try {
        const tbl = await pool.query(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = $1
            ) AS exists
        `, ['teachers_archive']);
        if (!tbl.rows[0] || !tbl.rows[0].exists) {
            return res.status(404).json({ success: false, message: 'Archive table not found' });
        }

        const r = await pool.query('SELECT * FROM teachers_archive WHERE id = $1', [archiveId]);
        if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Archived teacher not found' });
        res.json({ success: true, teacher: r.rows[0] });
    } catch (err) {
        console.error('Error fetching archived teacher:', err);
        res.status(500).json({ success: false, message: 'Error fetching archived teacher' });
    }
});

// Barangay distribution stats (counts for specific barangays)
app.get('/api/stats/barangay-distribution', async (req, res) => {
    // Allow ictcoor/registrar/admin roles to view basic distribution
    if (!req.session.user || !['ictcoor','registrar','admin','guidance'].includes(req.session.user.role)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    try {
        // Strategy: prefer explicit `barangay` columns if present, else fall back to searching `current_address` for substring matches
        const hasStudentsBarangay = await pool.query("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='students' AND column_name='barangay') AS has_col");
        const hasEarlyBarangay = await pool.query("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='early_registration' AND column_name='barangay') AS has_col");

        let rows;
        if (hasStudentsBarangay.rows[0].has_col || hasEarlyBarangay.rows[0].has_col) {
            // Use barangay columns where available (union both tables if both have the column)
            const parts = [];
            if (hasStudentsBarangay.rows[0].has_col) parts.push("SELECT barangay FROM students");
            if (hasEarlyBarangay.rows[0].has_col) parts.push("SELECT barangay FROM early_registration");
            const unionSql = parts.join(' UNION ALL ');
            const q = `
                SELECT
                    SUM(CASE WHEN LOWER(barangay) = 'mainaga' THEN 1 ELSE 0 END)::int AS mainaga,
                    SUM(CASE WHEN LOWER(barangay) = 'san francisco' THEN 1 ELSE 0 END)::int AS san_francisco,
                    SUM(CASE WHEN LOWER(barangay) = 'calamias' THEN 1 ELSE 0 END)::int AS calamias,
                    SUM(CASE WHEN LOWER(barangay) NOT IN ('mainaga','san francisco','calamias') OR barangay IS NULL THEN 1 ELSE 0 END)::int AS others
                FROM (
                    ${unionSql}
                ) t
            `;
            rows = await pool.query(q);
        } else {
            // Fallback: search current_address text for substrings in both students and early_registration
            const parts = [];
            parts.push("SELECT current_address FROM students");
            parts.push("SELECT current_address FROM early_registration");
            const unionSql = parts.join(' UNION ALL ');
            const q = `
                SELECT
                    SUM(CASE WHEN LOWER(COALESCE(current_address,'')) LIKE '%mainaga%' THEN 1 ELSE 0 END)::int AS mainaga,
                    SUM(CASE WHEN LOWER(COALESCE(current_address,'')) LIKE '%san francisco%' THEN 1 ELSE 0 END)::int AS san_francisco,
                    SUM(CASE WHEN LOWER(COALESCE(current_address,'')) LIKE '%calamias%' THEN 1 ELSE 0 END)::int AS calamias,
                    SUM(CASE WHEN LOWER(COALESCE(current_address,'')) NOT LIKE '%mainaga%' AND LOWER(COALESCE(current_address,'')) NOT LIKE '%san francisco%' AND LOWER(COALESCE(current_address,'')) NOT LIKE '%calamias%' THEN 1 ELSE 0 END)::int AS others
                FROM (
                    ${unionSql}
                ) t
            `;
            rows = await pool.query(q);
        }

        const r = rows.rows[0] || { mainaga:0, san_francisco:0, calamias:0, others:0 };
        res.json({ success: true, counts: {
            Mainaga: parseInt(r.mainaga || 0),
            'San Francisco': parseInt(r.san_francisco || 0),
            Calamias: parseInt(r.calamias || 0),
            Others: parseInt(r.others || 0)
        }});
    } catch (err) {
        console.error('Error computing barangay distribution:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===== TEST EMAIL ENDPOINT =====
app.post('/api/test-email', async (req, res) => {
    const { email, type } = req.body;
    
    if (!email) {
        return res.status(400).json({ success: false, error: 'Email required' });
    }

    try {
        let result;
        
        if (type === 'enrollment-approved') {
            result = await emailService.sendEnrollmentStatusUpdate(email, 'Test Student', 'TEST-TOKEN-123', 'approved');
        } else if (type === 'enrollment-rejected') {
            result = await emailService.sendEnrollmentStatusUpdate(email, 'Test Student', 'TEST-TOKEN-123', 'rejected', 'Test rejection reason');
        } else if (type === 'document-processing') {
            result = await emailService.sendDocumentRequestStatusUpdate(email, 'Test Student', 'TEST-TOKEN-123', 'Transcript', 'processing');
        } else if (type === 'document-ready') {
            result = await emailService.sendDocumentRequestStatusUpdate(email, 'Test Student', 'TEST-TOKEN-123', 'Transcript', 'ready');
        } else if (type === 'document-rejected') {
            result = await emailService.sendDocumentRequestStatusUpdate(email, 'Test Student', 'TEST-TOKEN-123', 'Transcript', 'rejected', 'Test rejection reason');
        } else {
            return res.status(400).json({ success: false, error: 'Invalid type' });
        }

        res.json({ success: result, message: result ? 'Test email sent successfully' : 'Failed to send test email' });
    } catch (err) {
        console.error('Error sending test email:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});