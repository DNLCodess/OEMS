'use client'

import { useEffect, useRef } from 'react'

// Renders HTML that may contain LaTeX math wrapped in $...$ (inline) or $$...$$ (block).
// Uses KaTeX on the client to replace those tokens with rendered math.
export function MathContent({ html, className = '' }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current || !html) return
    import('katex').then(({ default: katex }) => {
      // Walk text nodes and render any $...$ or $$...$$ found
      renderMathInElement(ref.current, katex)
    })
  }, [html])

  return (
    <div
      ref={ref}
      className={`math-content ${className}`}
      dangerouslySetInnerHTML={{ __html: html ?? '' }}
    />
  )
}

function renderMathInElement(el, katex) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const nodes = []
  let node
  while ((node = walker.nextNode())) nodes.push(node)

  for (const textNode of nodes) {
    const text = textNode.nodeValue
    if (!text.includes('$')) continue

    const frag = document.createDocumentFragment()
    let last = 0
    // Match $$...$$ first (block), then $...$ (inline)
    const re = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/g
    let m
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        frag.appendChild(document.createTextNode(text.slice(last, m.index)))
      }
      const isBlock = m[1] !== undefined
      const latex   = m[1] ?? m[2]
      const span    = document.createElement(isBlock ? 'div' : 'span')
      if (isBlock) span.className = 'math-display'
      try {
        span.innerHTML = katex.renderToString(latex, {
          displayMode: isBlock,
          throwOnError: false,
        })
      } catch {
        span.textContent = m[0]
      }
      frag.appendChild(span)
      last = m.index + m[0].length
    }
    if (last < text.length) {
      frag.appendChild(document.createTextNode(text.slice(last)))
    }
    if (last > 0) {
      textNode.parentNode.replaceChild(frag, textNode)
    }
  }
}
