const fs = require('fs');
const path = require('path');

const filePath = 'i:\\! WPA APPS\\Wealth Managment محفظة الاستثمار\\محفظتي V 2.0\\app.js';
const snippetPath = 'i:\\! WPA APPS\\Wealth Managment محفظة الاستثمار\\محفظتي V 2.0\\app_fib_append.js';

try {
    const appContent = fs.readFileSync(filePath, 'utf8');
    const snippetContent = fs.readFileSync(snippetPath, 'utf8');

    // Check availability
    if (appContent.includes('calcFib')) {
        console.log('Fibonacci logic already exists.');
    } else {
        fs.appendFileSync(filePath, '\n' + snippetContent, 'utf8');
        console.log('Successfully appended Fibonacci logic.');
    }
} catch (e) {
    console.error('Error:', e);
}
