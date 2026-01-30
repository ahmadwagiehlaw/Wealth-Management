const fs = require('fs');
const filesToDelete = [
    'i:\\! WPA APPS\\Wealth Managment محفظة الاستثمار\\محفظتي V 2.0\\repair_encoding.js',
    'i:\\! WPA APPS\\Wealth Managment محفظة الاستثمار\\محفظتي V 2.0\\repair_index_surgical.js',
    'i:\\! WPA APPS\\Wealth Managment محفظة الاستثمار\\محفظتي V 2.0\\append_lessons.js',
    'i:\\! WPA APPS\\Wealth Managment محفظة الاستثمار\\محفظتي V 2.0\\lessons_logic.js',
    'i:\\! WPA APPS\\Wealth Managment محفظة الاستثمار\\محفظتي V 2.0\\lessons_ui_snippet.html',
    'i:\\! WPA APPS\\Wealth Managment محفظة الاستثمار\\محفظتي V 2.0\\lessons_styles.css'
];

filesToDelete.forEach(file => {
    try {
        if (fs.existsSync(file)) {
            fs.unlinkSync(file);
            console.log(`Deleted: ${file}`);
        }
    } catch (e) {
        console.error(`Failed to delete ${file}:`, e.message);
    }
});
