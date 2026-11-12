import { Document, HeadingLevel, Packer, Paragraph } from 'docx';

/** DOCX de test : un paragraphe par bloc, styles « Titre 1/2 » pour heading. */
export async function makeDocx(blocks: { heading?: 1 | 2; text: string }[]): Promise<ArrayBuffer> {
  const doc = new Document({
    sections: [
      {
        children: blocks.map(
          b =>
            new Paragraph({
              text: b.text,
              heading:
                b.heading === 1 ? HeadingLevel.HEADING_1 : b.heading === 2 ? HeadingLevel.HEADING_2 : undefined,
            }),
        ),
      },
    ],
  });
  return Packer.toArrayBuffer(doc);
}
