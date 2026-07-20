type Caption = {
  description: string;
  sources: string[];
};

export const parseCaption = (caption: string): Caption => {
  const lines = caption
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const sourceLines = lines.filter((l) => l.startsWith('https'));
  const descriptionLines = lines.filter((l) => !l.startsWith('https'));

  const description = descriptionLines.join('\n').trim();
  return { description, sources: sourceLines };
};
