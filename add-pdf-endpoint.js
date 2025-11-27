const fs = require('fs');

const pdfEndpoint = `
// Download enrollment form as PDF
app.get('/download-enrollment/:token', async (req, res) => {
    const token = req.params.token;
    const format = req.query.format || 'pdf';

    try {
        const result = await pool.query(\`
            SELECT * FROM enrollment_requests WHERE request_token = $1
        \`, [token]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Enrollment request not found' });
        }

        if (format === 'pdf') {
            const data = result.rows[0];
            const filename = \`enrollment-\${token}\`;
            
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', \`attachment; filename="\${filename}.pdf"\`);

            const doc = new PDFDocument({ margin: 50 });
            doc.pipe(res);

            doc.fontSize(20).font('Helvetica-Bold').text('ENROLLMENT FORM', { align: 'center' });
            doc.fontSize(10).font('Helvetica').text('Copy/Download Record', { align: 'center' });
            doc.moveDown();

            doc.fontSize(9).text(\`Generated: \${new Date().toLocaleString()}\`, { align: 'right' });
            doc.text(\`Request Token: \${data.request_token}\`, { align: 'right' });
            doc.text(\`Status: \${data.status || 'Pending'}\`, { align: 'right' });
            doc.moveDown();

            doc.fontSize(12).font('Helvetica-Bold').text('PERSONAL INFORMATION');
            doc.fontSize(9).font('Helvetica');
            doc.text(\`Gmail: \${data.gmail_address}\`);
            doc.text(\`Name: \${data.last_name}, \${data.first_name} \${data.middle_name || ''} \${data.ext_name || ''}\`.trim());
            doc.text(\`Birthdate: \${data.birthday}\`);
            doc.text(\`Age: \${data.age}\`);
            doc.text(\`Sex: \${data.sex}\`);
            doc.text(\`Religion: \${data.religion || 'N/A'}\`);
            doc.text(\`LRN: \${data.lrn || 'N/A'}\`);
            doc.moveDown();

            doc.fontSize(12).font('Helvetica-Bold').text('ENROLLMENT DETAILS');
            doc.fontSize(9).font('Helvetica');
            doc.text(\`School Year: \${data.school_year}\`);
            doc.text(\`Grade Level: \${data.grade_level}\`);
            doc.text(\`Current Address: \${data.current_address || 'N/A'}\`);
            doc.text(\`Contact Number: \${data.contact_number || 'N/A'}\`);
            doc.moveDown();

            doc.fontSize(12).font('Helvetica-Bold').text('SPECIAL INFORMATION');
            doc.fontSize(9).font('Helvetica');
            doc.text(\`IP Community: \${data.ip_community}\`);
            if (data.ip_community_specify) {
                doc.text(\`IP Community Specify: \${data.ip_community_specify}\`);
            }
            doc.text(\`PWD: \${data.pwd}\`);
            if (data.pwd_specify) {
                doc.text(\`PWD Specify: \${data.pwd_specify}\`);
            }
            doc.moveDown();

            doc.fontSize(12).font('Helvetica-Bold').text('PARENT/GUARDIAN INFORMATION');
            doc.fontSize(9).font('Helvetica');
            doc.text(\`Father: \${data.father_name || 'N/A'}\`);
            doc.text(\`Mother: \${data.mother_name || 'N/A'}\`);
            doc.text(\`Guardian: \${data.guardian_name || 'N/A'}\`);
            doc.moveDown();

            doc.fontSize(12).font('Helvetica-Bold').text('SUBMISSION DETAILS');
            doc.fontSize(9).font('Helvetica');
            doc.text(\`Submitted: \${data.created_at}\`);
            doc.text(\`Printed Name: \${data.printed_name || 'N/A'}\`);
            doc.text(\`Signature: \${data.signature_image_path ? 'Provided' : 'Not provided'}\`);

            doc.fontSize(8).text('---', { align: 'center' });
            doc.text('This is an official copy of the enrollment form', { align: 'center' });

            doc.end();
        } else {
            res.status(404).json({ error: 'Format not supported' });
        }
    } catch (err) {
        console.error('Error downloading enrollment:', err);
        res.status(500).json({ error: 'Error generating download: ' + err.message });
    }
});
`;

// Read server.js
let content = fs.readFileSync('server.js', 'utf8');

// Find position before "// Start the server"
const insertPos = content.lastIndexOf('// Start the server');

if (insertPos === -1) {
  console.log('ERROR: Could not find insertion point');
  process.exit(1);
}

// Insert the endpoint
content = content.slice(0, insertPos) + pdfEndpoint + '\n' + content.slice(insertPos);

// Write back
fs.writeFileSync('server.js', content, 'utf8');
console.log('✓ PDF endpoint added successfully!');
