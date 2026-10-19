import mammoth from 'mammoth';
import { IDocumentParser, IParsedDocument } from './parser.interface.js';
import { BadRequestError } from '../../utils/errors.js';
import logger from '../../utils/logger.js';

export class DocxParserAdapter implements IDocumentParser {
  public static readonly MAX_CHARACTERS = 5_000_000; // 5M characters ceiling
  public static readonly PARSE_TIMEOUT_MS = 30_000; // 30 seconds timeout

  public async parse(buffer: Buffer): Promise<IParsedDocument> {
    try {
      const parsePromise = mammoth.extractRawText({ buffer });
      let timeoutHandle: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new BadRequestError('DOCX parsing timed out after 30 seconds')),
          DocxParserAdapter.PARSE_TIMEOUT_MS
        );
      });

      const result = await Promise.race([parsePromise, timeoutPromise]).finally(() => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      });

      const rawText = result.value || '';
      if (rawText.length > DocxParserAdapter.MAX_CHARACTERS) {
        throw new BadRequestError(
          `DOCX extracted content exceeds maximum allowed character ceiling of ${DocxParserAdapter.MAX_CHARACTERS.toLocaleString('en-US')} characters.`
        );
      }

      const cleanText = rawText
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

      if (!cleanText.trim()) {
        throw new BadRequestError('DOCX document contains no extractable text.');
      }

      return {
        text: cleanText,
        metadata: {
          title: undefined,
        },
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestError) {
        throw err;
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to parse DOCX document', { error: errMsg });
      throw new BadRequestError(`Failed to parse DOCX document: ${errMsg}`);
    }
  }
}
