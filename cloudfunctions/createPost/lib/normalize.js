function normalizeText(value) {
  return String(value || '')
    .replace(/[\uFF01-\uFF5E]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/[\s\u3000\u200B-\u200F\uFEFF]/g, '')
    .toLowerCase()
}

function matchWord(text, words) {
  const content = normalizeText(text)
  for (const word of words || []) {
    const normalized = normalizeText(word)
    if (normalized && content.includes(normalized)) return word
  }
  return ''
}

module.exports = { normalizeText, matchWord }
