const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function recreateTable() {
    try {
        console.log('Dropping old enrollment_requests table...');
        await pool.query('DROP TABLE IF EXISTS enrollment_requests CASCADE');
        
        console.log('Creating new enrollment_requests table...');
        const sql = `
        CREATE TABLE enrollment_requests (
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
        
        CREATE INDEX idx_request_token ON enrollment_requests(request_token);
        CREATE INDEX idx_status ON enrollment_requests(status);
        `;

        await pool.query(sql);
        console.log('✅ enrollment_requests table created successfully with all columns!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

recreateTable();
