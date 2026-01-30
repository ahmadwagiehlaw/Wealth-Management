const fs = require('fs');
const filePath = 'i:\\! WPA APPS\\Wealth Managment محفظة الاستثمار\\محفظتي V 2.0\\app.js';
const snippetPath = 'i:\\! WPA APPS\\Wealth Managment محفظة الاستثمار\\محفظتي V 2.0\\app_final_restore.js';

try {
    const appContent = fs.readFileSync(filePath, 'utf8');
    const snippetContent = fs.readFileSync(snippetPath, 'utf8');

    if (appContent.includes('window.calcFib =')) {
        console.log('calcFib already exists.');
    } else {
        fs.appendFileSync(filePath, '\n' + snippetContent, 'utf8');
        console.log('Successfully appended calcFib and related logic.');
    }
} catch (e) {
    console.error(e);
}
