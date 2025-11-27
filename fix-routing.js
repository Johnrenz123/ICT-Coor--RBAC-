const fs = require('fs');
const filePath = 'server.js';
let content = fs.readFileSync(filePath, 'utf8');
const listenPattern = /\/\/\s*Start the server\s+app\.listen\(port,\s*\(\)\s*=>\s*\{\s+console\.log\(.+?\);\s+\}\);/s;
content = content.replace(listenPattern, '');
const appListenCode = 

// Start the server
app.listen(port, () => {
    console.log(\Server running at http://localhost:\\);
    initializeSchemas();
});;
content = content.trimEnd() + appListenCode;
fs.writeFileSync(filePath, content, 'utf8');
console.log('Fixed!');
