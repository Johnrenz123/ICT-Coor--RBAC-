// hash_password.js
const bcrypt = require('bcrypt');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('Enter the password you want to hash: ', async (password) => {
    try {
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        console.log('\nYour hashed password is:');
        console.log(hashedPassword);
    } catch (err) {
        console.error('Error hashing password:', err);
    } finally {
        rl.close();
    }
});