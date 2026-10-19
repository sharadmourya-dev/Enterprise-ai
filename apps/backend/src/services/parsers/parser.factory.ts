import { DocumentMimeType } from '@enterprise-ai/shared-types';
import { IDocumentParser } from './parser.interface.js';
import { PdfParserAdapter } from './pdf.parser.js';
import { DocxParserAdapter } from './docx.parser.js';
import { TxtParserAdapter } from './txt.parser.js';
import { BadRequestError } from '../../utils/errors.js';

export class ParserFactory {
  private static pdfParser = new PdfParserAdapter();
  private static docxParser = new DocxParserAdapter();
  private static txtParser = new TxtParserAdapter();

  public static getParser(mimeType: DocumentMimeType): IDocumentParser {
    switch (mimeType) {
      case DocumentMimeType.PDF:
        return this.pdfParser;
      case DocumentMimeType.DOCX:
        return this.docxParser;
      case DocumentMimeType.TXT:
      case DocumentMimeType.MD:
        return this.txtParser;
      default:
        throw new BadRequestError(`Unsupported document MIME type '${mimeType}' for parsing`);
    }
  }
}
