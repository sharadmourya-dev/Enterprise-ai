import crypto from 'crypto';
import path from 'path';
import { DocumentMimeType } from '@enterprise-ai/shared-types';
import { env } from '../../config/env.js';
import { BadRequestError } from '../../utils/errors.js';

export interface IValidatedFile {
  mimeType: DocumentMimeType;
  fileHash: string;
  fileSizeBytes: number;
  sanitizedFilename: string;
}

export class FileValidator {
  private static readonly PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // '%PDF-'
  private static readonly DOCX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // 'PK\x03\x04' (ZIP header for OOXML)

  /**
   * Validates file size, extension, declared MIME type, and binary magic bytes.
   */
  public static validate(buffer: Buffer, originalFilename: string, declaredMimeType?: string): IValidatedFile {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestError('Uploaded file is empty or corrupted (0 bytes)');
    }

    if (buffer.length > env.MAX_FILE_SIZE_BYTES) {
      throw new BadRequestError(
        `File size (${(buffer.length / 1024 / 1024).toFixed(2)} MB) exceeds maximum allowed limit of ${(env.MAX_FILE_SIZE_BYTES / 1024 / 1024).toFixed(2)} MB`
      );
    }

    const ext = path.extname(originalFilename).toLowerCase();
    const sanitizedFilename = path.basename(originalFilename).replace(/[^a-zA-Z0-9._-]/g, '_');

    let detectedMimeType: DocumentMimeType;

    switch (ext) {
      case '.pdf': {
        this.verifyPdfSignature(buffer);
        detectedMimeType = DocumentMimeType.PDF;
        break;
      }
      case '.docx': {
        this.verifyDocxSignature(buffer);
        detectedMimeType = DocumentMimeType.DOCX;
        break;
      }
      case '.txt': {
        this.verifyTxtContent(buffer);
        detectedMimeType = DocumentMimeType.TXT;
        break;
      }
      default:
        throw new BadRequestError(
          `Unsupported file format '${ext}'. Allowed formats for Phase 3: .pdf, .docx, .txt`
        );
    }

    // Verify declared MIME type if provided
    if (declaredMimeType && declaredMimeType !== detectedMimeType) {
      // In some browsers or clients, text/plain might be passed as application/octet-stream;
      // allow fallback only if binary signature strictly matches.
      if (
        !(
          (declaredMimeType === 'application/octet-stream' && detectedMimeType === DocumentMimeType.TXT) ||
          (declaredMimeType === 'application/x-zip-compressed' && detectedMimeType === DocumentMimeType.DOCX)
        )
      ) {
        throw new BadRequestError(
          `MIME type mismatch: declared '${declaredMimeType}' does not match file extension/content signature '${detectedMimeType}'`
        );
      }
    }

    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

    return {
      mimeType: detectedMimeType,
      fileHash,
      fileSizeBytes: buffer.length,
      sanitizedFilename,
    };
  }

  private static verifyPdfSignature(buffer: Buffer): void {
    if (buffer.length < this.PDF_MAGIC.length) {
      throw new BadRequestError('Malformed PDF: file is too small to contain valid header');
    }

    const header = buffer.subarray(0, this.PDF_MAGIC.length);
    if (!header.equals(this.PDF_MAGIC)) {
      throw new BadRequestError('Invalid file signature: file declared as PDF does not have %PDF- header');
    }
  }

  private static verifyDocxSignature(buffer: Buffer): void {
    if (buffer.length < 30) {
      throw new BadRequestError('Malformed DOCX: file is too small to contain valid header');
    }

    const header = buffer.subarray(0, this.DOCX_MAGIC.length);
    if (!header.equals(this.DOCX_MAGIC)) {
      throw new BadRequestError('Invalid file signature: file declared as DOCX does not have valid PK ZIP header');
    }

    // Deep OpenXML inspection: verify required DOCX structure ([Content_Types].xml and word/ parts)
    // and enforce resource safeguards against malformed archives and zip bombs.
    let offset = 0;
    let foundContentTypes = false;
    let foundWordDir = false;
    let totalUncompressedBytes = 0;
    let entryCount = 0;
    const maxEntries = 500;
    const maxTotalUncompressedBytes = 100 * 1024 * 1024; // 100 MB uncompressed ceiling

    while (offset + 30 <= buffer.length) {
      if (
        buffer[offset] === 0x50 &&
        buffer[offset + 1] === 0x4b &&
        buffer[offset + 2] === 0x03 &&
        buffer[offset + 3] === 0x04
      ) {
        entryCount++;
        if (entryCount > maxEntries) {
          throw new BadRequestError('Malformed DOCX: excessive number of archive entries');
        }

        const compressedSize = buffer.readUInt32LE(offset + 18);
        const uncompressedSize = buffer.readUInt32LE(offset + 22);
        const fileNameLength = buffer.readUInt16LE(offset + 26);
        const extraFieldLength = buffer.readUInt16LE(offset + 28);

        // Zip bomb heuristic: check expansion ratio on large uncompressed files
        if (compressedSize > 0 && uncompressedSize > 10 * 1024 * 1024) {
          const ratio = uncompressedSize / compressedSize;
          if (ratio > 100) {
            throw new BadRequestError('Security alert: potential zip bomb detected in DOCX archive');
          }
        }

        totalUncompressedBytes += uncompressedSize;
        if (totalUncompressedBytes > maxTotalUncompressedBytes) {
          throw new BadRequestError('DOCX uncompressed archive size exceeds maximum allowable threshold (100 MB)');
        }

        const nameStart = offset + 30;
        const nameEnd = nameStart + fileNameLength;
        if (nameEnd > buffer.length) {
          throw new BadRequestError('Malformed DOCX: corrupt ZIP entry name boundary');
        }

        const entryName = buffer.toString('utf8', nameStart, nameEnd);
        if (entryName === '[Content_Types].xml') {
          foundContentTypes = true;
        }
        if (entryName.startsWith('word/')) {
          foundWordDir = true;
        }

        offset = nameEnd + extraFieldLength + compressedSize;
      } else {
        // Stop scanning when reaching central directory headers or end of directory
        if (
          buffer[offset] === 0x50 &&
          buffer[offset + 1] === 0x4b &&
          (buffer[offset + 2] === 0x01 || buffer[offset + 2] === 0x05)
        ) {
          break;
        }
        offset++;
      }
    }

    if (!foundContentTypes || !foundWordDir) {
      throw new BadRequestError(
        'Invalid DOCX package: archive missing required OpenXML structure ([Content_Types].xml and word/ directory)'
      );
    }
  }

  private static verifyTxtContent(buffer: Buffer): void {
    // Check for null bytes or excessive non-printable binary control characters
    let nullBytes = 0;
    const sampleLength = Math.min(buffer.length, 4096);

    for (let i = 0; i < sampleLength; i++) {
      const byte = buffer[i];
      if (byte === 0x00) {
        nullBytes++;
      }
    }

    if (nullBytes > 0) {
      throw new BadRequestError('Invalid text file: binary null bytes detected in plain text payload');
    }
  }
}
