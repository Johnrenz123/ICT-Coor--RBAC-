const pg = require('pg');

// List of passwords to try
const passwords = [
    'postgres',
    'password',
    '123456',
    '',
    'admin',
    'postgres123',
    'ictcoor',
    'school',
    'enrollment'
];

async function testPassword(pwd) {
    return new Promise((resolve) => {
        const pool = new pg.Pool({
            user: 'postgres',
            host: 'localhost',
            database: 'postgres',
            password: pwd,
            port: 5432,
            connectionTimeoutMillis: 5000,
            idleTimeoutMillis: 1000
        });

        const timeout = setTimeout(() => {
            pool.end().catch(() => {});
            resolve(false);
        }, 6000);

        pool.query('SELECT 1', (err) => {
            clearTimeout(timeout);
            if (err) {
                console.log(`❌ Failed: "${pwd}"`);
                pool.end().catch(() => {});
                resolve(false);
            } else {
                console.log(`✅ SUCCESS with password: "${pwd}"`);
                pool.end().catch(() => {});
                resolve(true);
            }
        });
    });
}

async function main() {
    console.log('Testing PostgreSQL passwords...\n');
    for (const pwd of passwords) {
        const success = await testPassword(pwd);
        if (success) {
            console.log('\n✅ Found working password! Update your .env file.');
            process.exit(0);
        }
    }
    console.log('\n❌ None of the tested passwords worked.');
    console.log('You may need to reset the PostgreSQL password manually.');
    process.exit(1);
}

main();
