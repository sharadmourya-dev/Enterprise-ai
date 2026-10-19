import { IDocumentParser, IParsedDocument } from './parser.interface.js';
import { BadRequestError } from '../../utils/errors.js';

export class TxtParserAdapter implements IDocumentParser {
  public async parse(buffer: Buffer): Promise<IParsedDocument> {
    try {
      const decoder = new TextDecoder('utf-8', { fatal: false });
      const rawText = decoder.decode(buffer);

      const cleanText = rawText
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

      if (!cleanText.trim()) {
        throw new BadRequestError('Text document is empty or contains only whitespace.');
      }

      return {
        text: cleanText,
        metadata: {},
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestError) {
        throw err;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new BadRequestError(`Failed to parse text document: ${errMsg}`);
    }
  }
}
