#!/usr/bin/env node
/**
 * Database Connection Tester
 */

require('dotenv').config();
const { Pool } = require('pg');

console.log('\n📋 DATABASE CONNECTION TEST\n');
console.log('Current Configuration:');
console.log(`  Host: ${process.env.DB_HOST}`);
console.log(`  Port: ${process.env.DB_PORT}`);
console.log(`  User: ${process.env.DB_USER}`);
console.log(`  Database: ${process.env.DB_NAME}`);
console.log(`  Password: ${'*'.repeat(process.env.DB_PASSWORD.length)}\n`);

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ Connection Failed:');
        console.error(`   Error: ${err.message}`);
        console.error(`   Code: ${err.code}`);
        console.error('\n💡 Troubleshooting Steps:');
        console.error('   1. Verify PostgreSQL is running: psql --version');
        console.error('   2. Check .env file for correct credentials');
        console.error('   3. Verify the database exists');
        console.error('   4. Try resetting the postgres password');
        console.error('   5. Check PostgreSQL logs for errors\n');
    } else {
        console.log('✅ Connection Successful!');
        console.log(`   Server time: ${res.rows[0].now}\n`);
    }
    pool.end();
});
