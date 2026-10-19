import * as pdfParseModule from 'pdf-parse';
import { IDocumentParser, IParsedDocument } from './parser.interface.js';
import { BadRequestError } from '../../utils/errors.js';
import logger from '../../utils/logger.js';

export class PdfParserAdapter implements IDocumentParser {
  public async parse(buffer: Buffer): Promise<IParsedDocument> {
    try {
      const PDFParseClass = (pdfParseModule as any).PDFParse || (pdfParseModule as any).default?.PDFParse;

      let cleanText = '';
      let pageCount = 1;
      let title: string | undefined;

      if (typeof PDFParseClass === 'function') {
        // pdf-parse v2+ Class API
        const parser = new PDFParseClass({ data: buffer });
        try {
          const textResult = await parser.getText();
          const rawText = textResult.text || '';
          pageCount = textResult.total || 1;

          cleanText = rawText
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

          try {
            const info = await parser.getInfo();
            title = info?.Title || undefined;
          } catch {
            // Optional info parsing
          }
        } finally {
          if (typeof parser.destroy === 'function') {
            await parser.destroy();
          }
        }
      } else {
        // Fallback for function-based pdf-parse
        const parseFn = (pdfParseModule as any).default || pdfParseModule;
        const data = await parseFn(buffer);
        const rawText = data.text || '';
        pageCount = data.numpages || 1;
        title = data.info?.Title || undefined;

        cleanText = rawText
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
      }

      if (!cleanText.trim()) {
        throw new BadRequestError(
          'Document contains no extractable text. Scanned or image-only PDFs requiring OCR are not supported.'
        );
      }

      return {
        text: cleanText,
        metadata: {
          pageCount,
          title,
        },
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestError) {
        throw err;
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to parse PDF document', { error: errMsg });

      if (errMsg.toLowerCase().includes('password') || errMsg.toLowerCase().includes('encrypted')) {
        throw new BadRequestError('Password-protected or encrypted PDFs are not supported.');
      }

      throw new BadRequestError(`Failed to parse PDF document: ${errMsg}`);
    }
  }
}
