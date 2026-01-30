const fs = require('fs');
const filePath = 'i:\\! WPA APPS\\Wealth Managment محفظة الاستثمار\\محفظتي V 2.0\\app.js';
const snippetPath = 'i:\\! WPA APPS\\Wealth Managment محفظة الاستثمار\\محفظتي V 2.0\\app_pivots_restore.js';

try {
    const appContent = fs.readFileSync(filePath, 'utf8');
    const snippetContent = fs.readFileSync(snippetPath, 'utf8');

    if (appContent.includes('window.calcPivots =')) {
        console.log('calcPivots already exists.');
    } else {
        fs.appendFileSync(filePath, '\n' + snippetContent, 'utf8');
        console.log('Successfully appended calcPivots.');
    }
} catch (e) { console.error(e); }
