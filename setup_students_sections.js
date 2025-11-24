// Script to create students and sections tables and seed sections data
const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'ICTCOORdb',
    password: 'bello0517',
    port: 5432
});

async function setupDatabase() {
    try {
        console.log('========================================');
        console.log('Setting up Students and Sections tables...');
        console.log('========================================\n');
        
        // 1. Create sections table
        console.log('1. Creating sections table...');
        await pool.query(`
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
            )
        `);
        console.log('✅ Sections table created\n');
        
        // 2. Create students table
        console.log('2. Creating students table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS students (
                id SERIAL PRIMARY KEY,
                enrollment_id INTEGER REFERENCES early_registration(id),
                section_id INTEGER REFERENCES sections(id) ON DELETE SET NULL,
                
                lrn VARCHAR(20),
                student_id VARCHAR(50) UNIQUE,
                
                last_name VARCHAR(100) NOT NULL,
                first_name VARCHAR(100) NOT NULL,
                middle_name VARCHAR(100),
                ext_name VARCHAR(20),
                birthday DATE NOT NULL,
                age INTEGER NOT NULL,
                sex VARCHAR(10) NOT NULL,
                religion VARCHAR(100),
                
                gmail_address VARCHAR(255),
                contact_number VARCHAR(20),
                current_address TEXT NOT NULL,
                
                ip_community VARCHAR(10) NOT NULL,
                ip_community_specify VARCHAR(200),
                pwd VARCHAR(10) NOT NULL,
                pwd_specify VARCHAR(200),
                
                father_name VARCHAR(200),
                mother_name VARCHAR(200),
                guardian_name VARCHAR(200),
                
                school_year VARCHAR(20) NOT NULL,
                grade_level VARCHAR(20) NOT NULL,
                
                enrollment_date DATE DEFAULT CURRENT_DATE,
                enrollment_status VARCHAR(50) DEFAULT 'active',
                
                printed_name VARCHAR(200),
                signature_image_path VARCHAR(500),
                
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Students table created\n');
        
        // 3. Seed sections
        console.log('3. Seeding sections data...');
        const sectionsData = [
            ['Kindergarten', 'angel'],
            ['Kindergarten', 'dahlia'],
            ['Kindergarten', 'lily'],
            ['Kindergarten', 'santan'],
            ['Grade 1', 'rosal'],
            ['Grade 1', 'rose'],
            ['Grade 2', 'camia'],
            ['Grade 2', 'daisy'],
            ['Grade 2', 'lirio'],
            ['Grade 3', 'adelfa'],
            ['Grade 3', 'orchids'],
            ['Grade 4', 'ilang-ilang'],
            ['Grade 4', 'sampaguita'],
            ['Grade 5', 'blueberry'],
            ['Grade 5', 'everlasting'],
            ['Grade 6', 'cattleya'],
            ['Grade 6', 'sunflower'],
            ['Non-Graded', 'tulips']
        ];
        
        for (const [grade, name] of sectionsData) {
            await pool.query(`
                INSERT INTO sections (grade_level, section_name)
                VALUES ($1, $2)
                ON CONFLICT (section_name) DO NOTHING
            `, [grade, name]);
        }
        console.log('✅ Seeded 18 sections\n');
        
        // 4. Verify
        const sectionsCount = await pool.query('SELECT COUNT(*) FROM sections');
        const studentsCount = await pool.query('SELECT COUNT(*) FROM students');
        
        console.log('========================================');
        console.log('Database setup complete!');
        console.log('========================================');
        console.log(`Sections in database: ${sectionsCount.rows[0].count}`);
        console.log(`Students in database: ${studentsCount.rows[0].count}`);
        
        // Show sections
        const sections = await pool.query(`
            SELECT section_name, grade_level, max_capacity, current_count 
            FROM sections 
            WHERE is_active = true 
            ORDER BY grade_level, section_name
        `);
        console.log('\nActive sections:');
        sections.rows.forEach(s => {
            console.log(`  - ${s.section_name} (${s.grade_level}): ${s.current_count}/${s.max_capacity}`);
        });
        
    } catch (err) {
        console.error('❌ Error:', err.message);
        console.error(err);
    } finally {
        await pool.end();
    }
}

setupDatabase();
