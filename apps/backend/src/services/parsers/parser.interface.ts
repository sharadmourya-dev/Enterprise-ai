export interface IParsedSection {
  title?: string;
  pageNumber?: number;
  text: string;
}

export interface IParsedDocument {
  text: string;
  metadata: {
    pageCount?: number;
    title?: string;
    sections?: IParsedSection[];
  };
}

export interface IDocumentParser {
  parse(buffer: Buffer): Promise<IParsedDocument>;
}
