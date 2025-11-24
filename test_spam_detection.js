// Test script to simulate spam/attacks on the enrollment system
// Run this to generate test data for the analytics dashboard

const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3000';
const ENDPOINT = '/submit-enrollment';

// Helper to generate random data
function randomString(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function generateLRN() {
    return Math.floor(100000000000 + Math.random() * 900000000000).toString();
}

// Test 1: Rapid submission (Rate Limiting Test)
async function testRateLimiting() {
    console.log('\n🔴 TEST 1: Rate Limiting (Rapid Submissions)');
    console.log('Attempting 10 rapid submissions from same IP...\n');
    
    for (let i = 1; i <= 10; i++) {
        try {
            const response = await fetch(`${BASE_URL}${ENDPOINT}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    gmail: `test${randomString(5)}@gmail.com`,
                    schoolYear: '2025 - 2026',
                    gradeLevel: 'Grade 7',
                    lastName: 'TestSpam',
                    firstName: `User${i}`,
                    middleName: 'Middle',
                    birthday: '2010-01-01',
                    age: 15,
                    sex: 'Male',
                    printedName: `TestSpam User${i}`,
                    lrn: generateLRN()
                })
            });
            
            const data = await response.json();
            console.log(`Attempt ${i}: ${response.status} - ${data.success ? '✅ SUCCESS' : '❌ BLOCKED'} ${data.message || ''}`);
            
            // Small delay to avoid overwhelming
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
            console.log(`Attempt ${i}: ❌ ERROR - ${err.message}`);
        }
    }
}

// Test 2: Duplicate email attack
async function testDuplicateEmail() {
    console.log('\n🔴 TEST 2: Duplicate Email Detection');
    console.log('Attempting to register same email 5 times...\n');
    
    const duplicateEmail = `duplicate${randomString(4)}@gmail.com`;
    
    for (let i = 1; i <= 5; i++) {
        try {
            const response = await fetch(`${BASE_URL}${ENDPOINT}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    gmail: duplicateEmail, // Same email every time
                    schoolYear: '2025 - 2026',
                    gradeLevel: 'Grade 7',
                    lastName: 'Duplicate',
                    firstName: `Test${i}`,
                    middleName: 'Spam',
                    birthday: '2010-01-01',
                    age: 15,
                    sex: 'Male',
                    printedName: `Duplicate Test${i}`,
                    lrn: generateLRN()
                })
            });
            
            const data = await response.json();
            console.log(`Attempt ${i}: ${response.status} - ${data.success ? '✅ ACCEPTED' : '❌ DUPLICATE DETECTED'} - ${data.message}`);
            
            await new Promise(resolve => setTimeout(resolve, 200));
        } catch (err) {
            console.log(`Attempt ${i}: ❌ ERROR - ${err.message}`);
        }
    }
}

// Test 3: Invalid data (Validation Test)
async function testValidation() {
    console.log('\n🔴 TEST 3: Validation Testing');
    console.log('Attempting submissions with invalid data...\n');
    
    const invalidTests = [
        { name: 'Invalid Gmail', data: { gmail: 'notgmail@yahoo.com' } },
        { name: 'Invalid Phone', data: { gmail: `valid${randomString(4)}@gmail.com`, contactNumber: '1234567890' } },
        { name: 'Invalid LRN', data: { gmail: `valid${randomString(4)}@gmail.com`, lrn: '123' } },
        { name: 'Missing Required', data: { gmail: `valid${randomString(4)}@gmail.com` } }
    ];
    
    for (const test of invalidTests) {
        try {
            const baseData = {
                schoolYear: '2025 - 2026',
                gradeLevel: 'Grade 7',
                lastName: 'Invalid',
                firstName: 'Test',
                middleName: 'Data',
                birthday: '2010-01-01',
                age: 15,
                sex: 'Male',
                printedName: 'Invalid Test'
            };
            
            const response = await fetch(`${BASE_URL}${ENDPOINT}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...baseData, ...test.data })
            });
            
            const data = await response.json();
            console.log(`${test.name}: ${response.status} - ${data.success ? '⚠️ PASSED' : '✅ REJECTED'} - ${data.message}`);
            
            await new Promise(resolve => setTimeout(resolve, 200));
        } catch (err) {
            console.log(`${test.name}: ❌ ERROR - ${err.message}`);
        }
    }
}

// Test 4: Honeypot trap
async function testHoneypot() {
    console.log('\n🔴 TEST 4: Honeypot Bot Detection');
    console.log('Simulating bot filling hidden honeypot field...\n');
    
    try {
        const response = await fetch(`${BASE_URL}${ENDPOINT}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                gmail: `bot${randomString(5)}@gmail.com`,
                schoolYear: '2025 - 2026',
                gradeLevel: 'Grade 7',
                lastName: 'Bot',
                firstName: 'Spam',
                middleName: 'Test',
                birthday: '2010-01-01',
                age: 15,
                sex: 'Male',
                printedName: 'Bot Spam Test',
                lrn: generateLRN(),
                website: 'http://spam.com' // Honeypot field!
            })
        });
        
        const data = await response.json();
        console.log(`Honeypot Test: ${response.status} - ${data.success ? '❌ BOT PASSED (BAD)' : '✅ BOT CAUGHT!'} - ${data.message}`);
    } catch (err) {
        console.log(`Honeypot Test: ❌ ERROR - ${err.message}`);
    }
}

// Main test runner
async function runAllTests() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('🧪 SPAM DETECTION & SECURITY ANALYTICS TEST SUITE');
    console.log('═══════════════════════════════════════════════════════');
    console.log('This will simulate various attacks on your enrollment system.');
    console.log('Check the Registrar Analytics page to see results!\n');
    
    try {
        await testRateLimiting();
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await testDuplicateEmail();
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await testValidation();
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await testHoneypot();
        
        console.log('\n═══════════════════════════════════════════════════════');
        console.log('✅ TEST SUITE COMPLETE!');
        console.log('═══════════════════════════════════════════════════════');
        console.log('\n📊 NOW CHECK YOUR ANALYTICS DASHBOARD:');
        console.log('1. Login as registrar');
        console.log('2. Go to Security Analytics');
        console.log('3. You should see:');
        console.log('   - Rate limited attempts in stats');
        console.log('   - Duplicate submissions caught');
        console.log('   - Validation failures logged');
        console.log('   - Honeypot catches (if any)');
        console.log('   - Your IP in suspicious activity list');
        console.log('\n🚫 Try blocking your own IP to test the block feature!\n');
        
    } catch (err) {
        console.error('Test suite error:', err);
    }
}

// Check if node-fetch is available
(async () => {
    try {
        await runAllTests();
    } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
            console.error('\n❌ Error: node-fetch not found');
            console.log('\nPlease install it first:');
            console.log('npm install node-fetch@2\n');
        } else {
            console.error('Error:', err);
        }
    }
})();
