const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'BR', 'SPAN', 'P', 'UL', 'LI'])

/**
 * Reduziert HTML aus der API auf harmlose Formatierung: nur erlaubte Tags,
 * keine Attribute außer `class`. Alles andere wird zu Text.
 */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const out = doc.createElement('div')
  for (const child of Array.from(doc.body.childNodes)) out.appendChild(clean(child, doc))
  return out.innerHTML
}

function clean(node: Node, doc: Document): Node {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? '')
  if (node.nodeType !== Node.ELEMENT_NODE) return doc.createTextNode('')
  const el = node as Element
  const children = Array.from(el.childNodes).map(c => clean(c, doc))
  if (!ALLOWED_TAGS.has(el.tagName)) {
    const frag = doc.createDocumentFragment()
    // Inhalt von script/style komplett verwerfen
    if (el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE') children.forEach(c => frag.appendChild(c))
    return frag
  }
  const copy = doc.createElement(el.tagName.toLowerCase())
  const cls = el.getAttribute('class')
  if (cls) copy.setAttribute('class', cls.replace(/[^\w\s-]/g, ''))
  children.forEach(c => copy.appendChild(c))
  return copy
}
