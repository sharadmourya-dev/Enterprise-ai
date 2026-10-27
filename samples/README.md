# Synthetic Demonstration Knowledge Documents

This directory contains three synthetic knowledge documents designed for local demonstration, pipeline testing, and end-to-end evaluation of the Enterprise AI Knowledge & Support Copilot.

> **Disclaimer:** All organizations, personnel names, policy numbers, and operational details in these documents are entirely fictional. These sample documents are provided solely for demonstrating document ingestion, chunking, vector indexing, and RAG question answering. They do not represent real-world corporate policies or sensitive corporate information.

---

## Document Inventory

| File Name | Format | MIME Type | Target Category | Primary Topics / Sample Queries |
| :--- | :--- | :--- | :--- | :--- |
| [`HR_Work_From_Home_Policy.pdf`](./HR_Work_From_Home_Policy.pdf) | PDF | `application/pdf` | HR Policies | Remote eligibility, core business hours (10:00 AM - 4:00 PM EST), home office stipend ($500 one-time + $50/mo), ergonomic assessment, security compliance. |
| [`IT_Hardware_and_Security_Guide.docx`](./IT_Hardware_and_Security_Guide.docx) | DOCX (OpenXML) | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | IT Support Manuals / Security Policies | Standard laptop hardware (MacBook Pro M-series / ThinkPad T-series), mandatory full-disk encryption (FileVault/BitLocker), 16-character passphrases, VPN requirements, lost equipment reporting within 2 hours. |
| [`Corporate_Data_Retention_Policy.txt`](./Corporate_Data_Retention_Policy.txt) | Plain Text | `text/plain` | Security / Compliance | Financial records (7 years), personnel records (5 years after separation), audit logs (1 year hot + 2 years cold), chat telemetry (90 days), legal hold suspension, NIST SP 800-88 sanitization. |

---

## Pipeline Compatibility & Validation

All three files have been verified against the platform's ingestion pipeline:
1. **Magic Number & Binary Header Validation:** Inspected via `FileValidator.validate()` to ensure authentic file structure (e.g. `%PDF-1.4`, OpenXML ZIP container for DOCX, UTF-8 text for TXT).
2. **Parser Extraction:** Tested and verified through `PdfParserAdapter` (using `pdf-parse`), `DocxParserAdapter` (using `mammoth`), and `TxtParserAdapter` (using UTF-8 `TextDecoder`).
3. **Sha-256 Checksums:** Computed during validation for duplicate upload prevention.

### Regenerating Sample Documents

To re-generate or modify these synthetic sample documents, run:
```bash
npx tsx apps/backend/src/scripts/generate-samples.ts
```
