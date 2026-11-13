import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx';

/** PNG 1×1 transparent. */
const PNG_1PX = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

/** DOCX de test : un paragraphe par bloc, styles « Titre 1/2 » pour heading ; `image` : image PNG avant le texte. */
export async function makeDocx(blocks: { heading?: 1 | 2; text: string; image?: boolean }[]): Promise<ArrayBuffer> {
  const doc = new Document({
    sections: [
      {
        children: blocks.map(
          b =>
            new Paragraph({
              ...(b.image
                ? {
                    children: [
                      new ImageRun({ type: 'png', data: PNG_1PX, transformation: { width: 10, height: 10 } }),
                      new TextRun(b.text),
                    ],
                  }
                : { text: b.text }),
              heading:
                b.heading === 1 ? HeadingLevel.HEADING_1 : b.heading === 2 ? HeadingLevel.HEADING_2 : undefined,
            }),
        ),
      },
    ],
  });
  return Packer.toArrayBuffer(doc);
}
