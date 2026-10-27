import fs from 'fs';
import path from 'path';
import jszip from 'jszip';
import { FileValidator } from '../services/parsers/file-validator.js';
import { TxtParserAdapter } from '../services/parsers/txt.parser.js';
import { DocxParserAdapter } from '../services/parsers/docx.parser.js';
import { PdfParserAdapter } from '../services/parsers/pdf.parser.js';
import { DocumentMimeType } from '@enterprise-ai/shared-types';

let repoRoot = process.cwd();
if (repoRoot.endsWith('backend')) {
  repoRoot = path.resolve(repoRoot, '../..');
}
const samplesDir = path.resolve(repoRoot, 'samples');
if (!fs.existsSync(samplesDir)) {
  fs.mkdirSync(samplesDir, { recursive: true });
}

// --------------------------------------------------------------------------
// 1. Corporate Data Retention Policy (TXT)
// --------------------------------------------------------------------------
const txtContent = `APEX ENTERPRISE SYSTEMS - CORPORATE DATA RETENTION POLICY
Document ID: POL-SEC-2026-04
Classification: Internal Business Document
Effective Date: January 15, 2026
Version: 3.2

1. PURPOSE AND SCOPE
This policy defines mandatory data retention schedules, archival procedures, and disposal protocols for digital and physical records across Apex Enterprise Systems. All employees, contractors, and departments must adhere strictly to these schedules to maintain legal compliance, operational integrity, and data minimization principles.

2. RECORD RETENTION SCHEDULES
Records must be retained according to the following defined timelines:
- Financial and Accounting Records: Retained for seven (7) fiscal years following the close of the relevant fiscal period. Includes invoices, ledger entries, tax filings, and audit trails.
- Personnel and Employee Records: Retained for five (5) years following the employee's formal termination or separation date.
- Information Security and System Audit Logs: Retained in tamper-evident storage for a minimum of 365 days (1 year) online, followed by two (2) years of immutable cold archive.
- Customer Support and Chat Telemetry Logs: Retained for ninety (90) days, after which personally identifiable information (PII) is automatically redacted or purged.
- General Corporate Correspondence and Communications: Retained for three (3) years unless subject to an active legal litigation hold.

3. LEGAL LITIGATION HOLDS
Upon notification by General Counsel or the Compliance Office of pending litigation, government inquiry, or formal investigation, routine disposal schedules are immediately suspended for all relevant records. Destruction or alteration of records subject to a legal hold is strictly forbidden and constitutes grounds for disciplinary termination.

4. DATA DISPOSAL AND SANITIZATION
Upon expiration of mandatory retention periods:
- Digital data stored in cloud or on-premise relational databases must be cryptographically deleted or sanitized in accordance with NIST SP 800-88 Rev 1 guidelines.
- Physical documents containing confidential information must be destroyed via cross-cut shredding with formal certificates of destruction issued.

5. ROLES AND RESPONSIBILITIES
- Compliance Officers: Responsible for annual auditing of retention schedules and verification of legal hold execution.
- System Administrators: Responsible for automated database archival policies and immutable log storage verification.
- Department Managers: Responsible for ensuring departmental knowledge documents are updated and obsolete drafts are purged annually.
`;

const txtPath = path.join(samplesDir, 'Corporate_Data_Retention_Policy.txt');
fs.writeFileSync(txtPath, txtContent, 'utf8');
console.log('Created TXT sample:', txtPath);

// --------------------------------------------------------------------------
// 2. IT Hardware and Security Guide (DOCX)
// --------------------------------------------------------------------------
async function createDocx(): Promise<void> {
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>APEX ENTERPRISE SYSTEMS - IT HARDWARE &amp; SECURITY GUIDE</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Document Reference: IT-GUIDE-2026-V2 | Clearance Level: Internal</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t>1. Hardware Lifecycle and Replacement Policy</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Apex Enterprise provides all full-time employees with standardized enterprise workstation equipment. Standard corporate laptops are provisioned on a thirty-six (36) month (3-year) lifecycle. Employees become eligible for hardware replacement upon reaching 36 months of active device service, or earlier if the IT Helpdesk verifies irreparable hardware failure. Devices scheduled for replacement must be backed up to corporate cloud storage and surrendered to IT Asset Management within ten business days of receiving new hardware.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t>2. Device Security Standards and Disk Encryption</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>All company-issued laptops must have full-disk encryption enabled (BitLocker on Windows systems, FileVault on macOS) with recovery keys securely escrowed in central device management. Tampering with encryption controls or attempting to disable endpoint monitoring agents is a direct policy violation.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t>3. Password Complexity and Multi-Factor Authentication (MFA)</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Corporate access credentials require a minimum of fourteen (14) characters containing uppercase letters, lowercase letters, numbers, and symbols. Hardware-bound FIDO2 security keys or authenticator push notifications are mandatory for all single sign-on (SSO) authentication. SMS-based verification is strictly disallowed for production systems.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t>4. Reporting Lost or Stolen Devices</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>If a corporate laptop, smartphone, or security token is lost or stolen, the employee must report the incident to the Security Operations Center (SOC) hotline within two (2) hours. IT administrators will immediately trigger an emergency remote cryptographic wipe of the device to prevent unauthorized data extraction.</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const zip = new jszip();
  zip.file('[Content_Types].xml', contentTypesXml);
  zip.folder('_rels')!.file('.rels', rootRelsXml);
  zip.folder('word')!.file('document.xml', docXml);

  const docxBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const docxPath = path.join(samplesDir, 'IT_Hardware_and_Security_Guide.docx');
  fs.writeFileSync(docxPath, docxBuffer);
  console.log('Created DOCX sample:', docxPath);
}

// --------------------------------------------------------------------------
// 3. HR Work-From-Home Policy (PDF)
// --------------------------------------------------------------------------
function createPdf(): void {
  // Construct a valid PDF 1.4 document with text streams
  const streamContent = `BT
/F1 16 Tf
50 750 Td
(APEX ENTERPRISE SYSTEMS - WORK-FROM-HOME POLICY) Tj
0 -30 Td
/F1 11 Tf
(Document ID: HR-POL-2026-01 | Classification: Internal | Effective: Jan 2026) Tj
0 -40 Td
/F1 13 Tf
(1. Eligibility and Program Scope) Tj
0 -20 Td
/F1 10 Tf
(Full-time employees in good standing who have successfully completed their initial) Tj
0 -15 Td
(90-day probationary period are eligible to apply for hybrid or full remote work.) Tj
0 -15 Td
(Eligibility depends on role responsibilities, team coverage, and written manager approval.) Tj
0 -35 Td
/F1 13 Tf
(2. Core Business Hours and Availability) Tj
0 -20 Td
/F1 10 Tf
(Remote employees must be logged in and accessible via corporate Slack and email during) Tj
0 -15 Td
(core collaboration hours between 10:00 AM and 4:00 PM local time.) Tj
0 -15 Td
(Unplanned absences during core hours must be notified to department managers in advance.) Tj
0 -35 Td
/F1 13 Tf
(3. Home Office Equipment Allowance) Tj
0 -20 Td
/F1 10 Tf
(Eligible remote workers receive a one-time home office setup stipend of $500 to assist with) Tj
0 -15 Td
(ergonomic desks, chairs, or monitors. Hardware equipment is provisioned separately by IT.) Tj
0 -35 Td
/F1 13 Tf
(4. Confidentiality and Physical Workspace Security) Tj
0 -20 Td
/F1 10 Tf
(Employees must maintain a secure, private work area free from unauthorized observation.) Tj
0 -15 Td
(Confidential corporate discussions must not occur in public venues without privacy headsets.) Tj
0 -15 Td
(Workstations must be locked whenever left unattended, even in home environments.) Tj
ET`;

  const streamLength = Buffer.byteLength(streamContent, 'utf8');

  const pdfBody = `%PDF-1.4
%âãÏÓ
1 0 obj
<<
  /Type /Catalog
  /Pages 2 0 R
>>
endobj
2 0 obj
<<
  /Type /Pages
  /Kids [3 0 R]
  /Count 1
>>
endobj
3 0 obj
<<
  /Type /Page
  /Parent 2 0 R
  /MediaBox [0 0 612 792]
  /Contents 4 0 R
  /Resources <<
    /Font <<
      /F1 5 0 R
    >>
  >>
>>
endobj
4 0 obj
<<
  /Length ${streamLength}
>>
stream
${streamContent}
endstream
endobj
5 0 obj
<<
  /Type /Font
  /Subtype /Type1
  /BaseFont /Helvetica
>>
endobj
xref
0 6
0000000000 65535 f 
0000000015 00000 n 
0000000068 00000 n 
0000000125 00000 n 
0000000262 00000 n 
000000${(320 + streamLength).toString().padStart(4, '0')} 00000 n 
trailer
<<
  /Size 6
  /Root 1 0 R
>>
startxref
${400 + streamLength}
%%EOF`;

  const pdfPath = path.join(samplesDir, 'HR_Work_From_Home_Policy.pdf');
  fs.writeFileSync(pdfPath, Buffer.from(pdfBody, 'binary'));
  console.log('Created PDF sample:', pdfPath);
}

async function main() {
  await createDocx();
  createPdf();

  // Validate all three sample files with pipeline parsers
  console.log('\nValidating sample files with pipeline parsers...');
  
  // 1. TXT
  const txtBuf = fs.readFileSync(txtPath);
  const txtVal = FileValidator.validate(txtBuf, 'Corporate_Data_Retention_Policy.txt', DocumentMimeType.TXT);
  const txtParsed = await new TxtParserAdapter().parse(txtBuf);
  console.log(`TXT Validated: hash=${txtVal.fileHash.slice(0, 12)}..., textLength=${txtParsed.text.length}`);

  // 2. DOCX
  const docxPath = path.join(samplesDir, 'IT_Hardware_and_Security_Guide.docx');
  const docxBuf = fs.readFileSync(docxPath);
  const docxVal = FileValidator.validate(docxBuf, 'IT_Hardware_and_Security_Guide.docx', DocumentMimeType.DOCX);
  const docxParsed = await new DocxParserAdapter().parse(docxBuf);
  console.log(`DOCX Validated: hash=${docxVal.fileHash.slice(0, 12)}..., textLength=${docxParsed.text.length}`);

  // 3. PDF
  const pdfPath = path.join(samplesDir, 'HR_Work_From_Home_Policy.pdf');
  const pdfBuf = fs.readFileSync(pdfPath);
  const pdfVal = FileValidator.validate(pdfBuf, 'HR_Work_From_Home_Policy.pdf', DocumentMimeType.PDF);
  const pdfParsed = await new PdfParserAdapter().parse(pdfBuf);
  console.log(`PDF Validated: hash=${pdfVal.fileHash.slice(0, 12)}..., textLength=${pdfParsed.text.length}`);

  console.log('\nAll 3 sample documents created and validated successfully!');
}

main().catch(console.error);
