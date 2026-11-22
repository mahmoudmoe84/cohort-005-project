// Implementation detail: private to the example module.

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
