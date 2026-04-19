'use client'

import { useState, useRef } from 'react'
import { X, GripHorizontal } from 'lucide-react'

const BUTTONS = [
  // Row 1 — scientific
  ['sin', 'cos', 'tan', 'log', '√'],
  // Row 2 — memory / power
  ['(', ')', 'x²', 'xʸ', 'π'],
  // Row 3 — clear
  ['AC', '+/-', '%', '÷', '←'],
  // Row 4 — digits
  ['7', '8', '9', '×', ''],
  ['4', '5', '6', '−', ''],
  ['1', '2', '3', '+', '='],
  ['0', '', '.', '', ''],
]

const FLAT_BUTTONS = [
  { label: 'sin',  fn: 'sin' },   { label: 'cos',  fn: 'cos' },
  { label: 'tan',  fn: 'tan' },   { label: 'log',  fn: 'log' },
  { label: '√',    fn: 'sqrt' },

  { label: '(',    fn: '(' },     { label: ')',    fn: ')' },
  { label: 'x²',   fn: 'sq' },   { label: 'xʸ',   fn: 'pow' },
  { label: 'π',    fn: 'pi' },

  { label: 'AC',   fn: 'ac' },    { label: '+/-',  fn: 'neg' },
  { label: '%',    fn: '%' },     { label: '÷',    fn: '/' },
  { label: '←',    fn: 'del' },

  { label: '7',    fn: '7' },     { label: '8',    fn: '8' },
  { label: '9',    fn: '9' },     { label: '×',    fn: '*' },

  { label: '4',    fn: '4' },     { label: '5',    fn: '5' },
  { label: '6',    fn: '6' },     { label: '−',    fn: '-' },

  { label: '1',    fn: '1' },     { label: '2',    fn: '2' },
  { label: '3',    fn: '3' },     { label: '+',    fn: '+' },

  { label: '0',    fn: '0', wide: true },
  { label: '.',    fn: '.' },
  { label: '=',    fn: '=', accent: true },
]

export function Calculator({ onClose }) {
  const [display, setDisplay] = useState('0')
  const [expr, setExpr]       = useState('')
  const [justEvaled, setJustEvaled] = useState(false)

  // Drag state
  const [pos, setPos]     = useState({ x: 0, y: 0 })
  const dragging          = useRef(false)
  const dragStart         = useRef({ mx: 0, my: 0, px: 0, py: 0 })

  function onMouseDown(e) {
    dragging.current = true
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }
  function onMouseMove(e) {
    if (!dragging.current) return
    setPos({
      x: dragStart.current.px + e.clientX - dragStart.current.mx,
      y: dragStart.current.py + e.clientY - dragStart.current.my,
    })
  }
  function onMouseUp() {
    dragging.current = false
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  function press(fn) {
    if (fn === 'ac') {
      setDisplay('0'); setExpr(''); setJustEvaled(false); return
    }
    if (fn === 'del') {
      const next = expr.length <= 1 ? '0' : expr.slice(0, -1)
      setExpr(next === '0' ? '' : next)
      setDisplay(next === '0' ? '0' : next)
      return
    }
    if (fn === '=') {
      evaluate(); return
    }

    const newExpr = justEvaled && /\d/.test(fn) ? fn : expr + resolveToken(fn)
    setExpr(newExpr)
    setDisplay(newExpr || '0')
    setJustEvaled(false)
  }

  function resolveToken(fn) {
    if (fn === 'neg')  return expr ? `-(${expr})` : ''
    if (fn === 'pi')   return 'π'
    if (fn === 'sq')   return `²`
    if (fn === 'pow')  return '^'
    if (fn === 'sin')  return 'sin('
    if (fn === 'cos')  return 'cos('
    if (fn === 'tan')  return 'tan('
    if (fn === 'log')  return 'log('
    if (fn === 'sqrt') return '√('
    if (fn === '%')    return '%'
    return fn
  }

  function evaluate() {
    try {
      const result = computeExpr(expr)
      setDisplay(String(result))
      setExpr(String(result))
      setJustEvaled(true)
    } catch {
      setDisplay('Error')
      setExpr('')
    }
  }

  return (
    <div
      className="fixed z-50 shadow-2xl rounded-2xl overflow-hidden border border-border bg-slate-900"
      style={{ width: 260, bottom: 100, right: 24, transform: `translate(${pos.x}px, ${pos.y}px)` }}
    >
      {/* Title bar — drag handle */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-slate-800 cursor-grab active:cursor-grabbing"
        onMouseDown={onMouseDown}
      >
        <div className="flex items-center gap-1.5 text-slate-400">
          <GripHorizontal size={14} />
          <span className="text-xs font-medium select-none">Calculator</span>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Display */}
      <div className="px-4 py-3 bg-slate-800 text-right select-none">
        <p className="text-xs text-slate-500 h-4 truncate">{expr || ''}</p>
        <p className="text-2xl font-bold text-white tabular-nums truncate mt-0.5">{display}</p>
      </div>

      {/* Buttons */}
      <div className="p-2 grid grid-cols-5 gap-1.5">
        {FLAT_BUTTONS.map((btn, i) => (
          <button
            key={i}
            onMouseDown={e => e.stopPropagation()}
            onClick={() => press(btn.fn)}
            className={[
              'rounded-xl py-2.5 text-sm font-medium transition-all active:scale-95 select-none',
              btn.wide    ? 'col-span-2' : '',
              btn.accent  ? 'bg-primary text-white hover:bg-primary-hover' :
              btn.fn === 'ac' || btn.fn === 'del' || btn.fn === 'neg' || btn.fn === '%'
                ? 'bg-slate-600 text-white hover:bg-slate-500' :
              /^[+\-*/÷×−]$/.test(btn.fn) || btn.fn === '/'
                ? 'bg-amber-500 text-white hover:bg-amber-400' :
              /^[a-z]/.test(btn.fn) || btn.fn === '√' || btn.fn === 'x²' || btn.fn === 'xʸ' || btn.fn === 'π'
                ? 'bg-slate-700 text-blue-300 hover:bg-slate-600' :
              'bg-slate-700 text-white hover:bg-slate-600',
            ].join(' ')}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Expression evaluator (no eval — safe) ─────────────────────────────────────
function computeExpr(raw) {
  // Normalise symbols
  let s = raw
    .replace(/π/g, String(Math.PI))
    .replace(/÷/g, '/')
    .replace(/×/g, '*')
    .replace(/−/g, '-')
    .replace(/²/g, '**2')
    .replace(/\^/g, '**')

  // Replace functions
  s = s.replace(/sin\(([^)]*)\)/g, (_, a) => String(Math.sin(toRad(parseFloat(a)))))
  s = s.replace(/cos\(([^)]*)\)/g, (_, a) => String(Math.cos(toRad(parseFloat(a)))))
  s = s.replace(/tan\(([^)]*)\)/g, (_, a) => String(Math.tan(toRad(parseFloat(a)))))
  s = s.replace(/log\(([^)]*)\)/g, (_, a) => String(Math.log10(parseFloat(a))))
  s = s.replace(/√\(([^)]*)\)/g,   (_, a) => String(Math.sqrt(parseFloat(a))))

  // Handle % — treat as /100
  s = s.replace(/(\d+(?:\.\d+)?)%/g, (_, n) => String(parseFloat(n) / 100))

  // Safe arithmetic-only eval using Function constructor scoped to nothing
  // We allow only: digits, operators, parens, dots, spaces
  if (!/^[\d\s+\-*/.()e-]+$/.test(s)) throw new Error('invalid')
  // eslint-disable-next-line no-new-func
  const result = Function(`"use strict"; return (${s})`)()
  if (!isFinite(result)) throw new Error('overflow')
  // Round to avoid floating point noise
  return Math.round(result * 1e10) / 1e10
}

function toRad(deg) { return deg * (Math.PI / 180) }
