export function parseWhatsAppText(text: string): string {
  let result = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const codeTokens: string[] = [];
  result = result.replace(/```([\s\S]*?)```/g, (_m, code) => {
    const idx = codeTokens.length;
    codeTokens.push(`<code class="wa-code-block">${code}</code>`);
    return `\x00CODE${idx}\x00`;
  });
  result = result.replace(/`([^`\n]+)`/g, (_m, code) => {
    const idx = codeTokens.length;
    codeTokens.push(`<code class="wa-code-inline">${code}</code>`);
    return `\x00CODE${idx}\x00`;
  });

  result = result.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
  result = result.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '<em>$1</em>');
  result = result.replace(/~([^~\n]+)~/g, '<del>$1</del>');

  result = result.replace(/\x00CODE(\d+)\x00/g, (_m, idx) => codeTokens[parseInt(idx)]);

  return result;
}

const EMOJI_ONLY_REGEX = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s\u200d\uFE0F]{1,10}$/u;
const FEW_EMOJI_REGEX = /^(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}|\u200d|\uFE0F|\s){1,10}$/u;

export function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 20) return false;
  return EMOJI_ONLY_REGEX.test(trimmed) || FEW_EMOJI_REGEX.test(trimmed);
}
