import { FileValidator } from '../src/services/parsers/file-validator.js';
import { TxtParserAdapter } from '../src/services/parsers/txt.parser.js';
import { DocxParserAdapter } from '../src/services/parsers/docx.parser.js';
import { PdfParserAdapter } from '../src/services/parsers/pdf.parser.js';
import { DocumentMimeType } from '@enterprise-ai/shared-types';
import { BadRequestError } from '../src/utils/errors.js';
import mammoth from 'mammoth';

describe('Document Parsers & File Validation Unit Tests', () => {
  describe('FileValidator', () => {
    it('1. Validates genuine PDF binary signature (%PDF-)', () => {
      const validPdfBuffer = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
      const result = FileValidator.validate(validPdfBuffer, 'company_policy.pdf', 'application/pdf');

      expect(result.mimeType).toBe(DocumentMimeType.PDF);
      expect(result.fileHash).toHaveLength(64);
      expect(result.fileSizeBytes).toBe(validPdfBuffer.length);
      expect(result.sanitizedFilename).toBe('company_policy.pdf');
    });

    function createTestZipBuffer(files: { name: string; content: string }[]): Buffer {
      const parts: Buffer[] = [];
      for (const f of files) {
        const nameBuf = Buffer.from(f.name, 'utf8');
        const contentBuf = Buffer.from(f.content, 'utf8');
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(0, 6);
        header.writeUInt16LE(0, 8); // stored
        header.writeUInt32LE(0, 10);
        header.writeUInt32LE(0, 14);
        header.writeUInt32LE(contentBuf.length, 18);
        header.writeUInt32LE(contentBuf.length, 22);
        header.writeUInt16LE(nameBuf.length, 26);
        header.writeUInt16LE(0, 28);
        parts.push(header, nameBuf, contentBuf);
      }
      return Buffer.concat(parts);
    }

    it('2. Validates genuine DOCX binary signature and OpenXML structure', () => {
      const validDocxBuffer = createTestZipBuffer([
        { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8"?><Types></Types>' },
        { name: 'word/document.xml', content: '<?xml version="1.0"?><w:document></w:document>' },
      ]);
      const result = FileValidator.validate(validDocxBuffer, 'quarterly_report.docx', DocumentMimeType.DOCX);

      expect(result.mimeType).toBe(DocumentMimeType.DOCX);
      expect(result.fileHash).toHaveLength(64);
    });

    it('3. Rejects generic ZIP archive disguised as DOCX lacking OpenXML structure', () => {
      const genericZipBuffer = createTestZipBuffer([
        { name: 'random_script.py', content: 'print("hello world")' },
        { name: 'notes.txt', content: 'not an openxml document' },
      ]);

      expect(() => {
        FileValidator.validate(genericZipBuffer, 'malicious.docx', DocumentMimeType.DOCX);
      }).toThrow(/missing required OpenXML structure/);
    });

    it('4. Rejects spoofed PDF (executable or binary disguised with .pdf extension)', () => {
      const fakePdfBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00This is a Windows EXE disguised as PDF');

      expect(() => {
        FileValidator.validate(fakePdfBuffer, 'trojan.pdf', 'application/pdf');
      }).toThrow(BadRequestError);
      expect(() => {
        FileValidator.validate(fakePdfBuffer, 'trojan.pdf', 'application/pdf');
      }).toThrow(/does not have %PDF- header/);
    });

    it('5. Rejects spoofed DOCX (text file renamed to .docx)', () => {
      const fakeDocxBuffer = Buffer.from('Just plain text without PK zip header');

      expect(() => {
        FileValidator.validate(fakeDocxBuffer, 'fake.docx', DocumentMimeType.DOCX);
      }).toThrow(/does not have valid PK ZIP header/);
    });

    it('5. Rejects plain text containing binary null bytes', () => {
      const binaryInTxt = Buffer.from('Hello world\x00malicious binary content');

      expect(() => {
        FileValidator.validate(binaryInTxt, 'notes.txt', 'text/plain');
      }).toThrow(/binary null bytes detected/);
    });

    it('6. Rejects empty file (0 bytes)', () => {
      expect(() => {
        FileValidator.validate(Buffer.alloc(0), 'empty.txt', 'text/plain');
      }).toThrow(/empty or corrupted/);
    });

    it('7. Rejects unsupported extensions (.exe, .jpg, .sh)', () => {
      expect(() => {
        FileValidator.validate(Buffer.from('echo hello'), 'script.sh');
      }).toThrow(/Unsupported file format/);
    });
  });

  describe('TxtParserAdapter', () => {
    const parser = new TxtParserAdapter();

    it('1. Parses UTF-8 text and normalizes CRLF to LF', async () => {
      const content = 'First line\r\nSecond line\rThird line\nFourth line';
      const result = await parser.parse(Buffer.from(content, 'utf-8'));

      expect(result.text).toBe('First line\nSecond line\nThird line\nFourth line');
    });

    it('2. Strips ASCII control characters while preserving tabs and newlines', async () => {
      const content = 'Line with\x07 bell and \x08 backspace \tand \nnewline';
      const result = await parser.parse(Buffer.from(content, 'utf-8'));

      expect(result.text).toBe('Line with bell and  backspace \tand \nnewline');
    });

    it('3. Rejects whitespace-only text files', async () => {
      await expect(parser.parse(Buffer.from('   \n\n\t  \r\n  ', 'utf-8'))).rejects.toThrow(
        /empty or contains only whitespace/
      );
    });
  });

  describe('PdfParserAdapter', () => {
    const parser = new PdfParserAdapter();

    it('1. Detects empty or unparseable text in corrupted PDF', async () => {
      const invalidPdfBuffer = Buffer.from('%PDF-1.4\ncorrupted text data here\n%%EOF');
      await expect(parser.parse(invalidPdfBuffer)).rejects.toThrow(BadRequestError);
    });
  });

  describe('DocxParserAdapter', () => {
    const parser = new DocxParserAdapter();

    it('1. Rejects corrupted DOCX zip archives cleanly', async () => {
      const corruptedDocx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
      await expect(parser.parse(corruptedDocx)).rejects.toThrow(/Failed to parse DOCX/);
    });

    it('2. Enforces 5M character extraction ceiling', async () => {
      // Mock mammoth to return oversized text (> 5M characters)
      const spy = jest.spyOn(mammoth, 'extractRawText').mockResolvedValueOnce({
        value: 'A'.repeat(5_000_001),
        messages: [],
      } as any);

      await expect(parser.parse(Buffer.from('fake-docx-buffer'))).rejects.toThrow(
        /exceeds maximum allowed character ceiling of 5,000,000/
      );

      spy.mockRestore();
    });
  });
});
