import { describe, it, expect } from 'vitest'
import {
  extractMatricColumn,
  parseCsvText,
  parseMatricListFromCsvText,
  parseMatricListFromPaste,
  parseMatricListFromXlsxBuffer,
} from './parseMatricList'

describe('extractMatricColumn', () => {
  it('returns an empty array for empty input', () => {
    expect(extractMatricColumn([])).toEqual([])
  })

  it('uses the first column of every row when there is no recognizable header', () => {
    const rows = [['CSC/2021/001', 'Amina Bello'], ['CSC/2021/002', 'Femi Ade']]
    expect(extractMatricColumn(rows)).toEqual(['CSC/2021/001', 'CSC/2021/002'])
  })

  it('skips the header row when the first cell matches a known alias', () => {
    const rows = [['Matric Number', 'Name'], ['CSC/2021/001', 'Amina Bello']]
    expect(extractMatricColumn(rows)).toEqual(['CSC/2021/001'])
  })

  it('recognizes header aliases case-insensitively and with surrounding whitespace', () => {
    const rows = [[' Reg No '], ['CSC/2021/001']]
    expect(extractMatricColumn(rows)).toEqual(['CSC/2021/001'])
  })

  it('normalizes case, trims whitespace, and dedupes', () => {
    const rows = [['csc/2021/001'], [' CSC/2021/001 '], ['CSC/2021/002']]
    expect(extractMatricColumn(rows)).toEqual(['CSC/2021/001', 'CSC/2021/002'])
  })

  it('drops blank cells', () => {
    const rows = [['CSC/2021/001'], [''], ['   ']]
    expect(extractMatricColumn(rows)).toEqual(['CSC/2021/001'])
  })
})

describe('parseCsvText', () => {
  it('splits into rows and columns, trimming each cell', () => {
    expect(parseCsvText('CSC/2021/001, Amina Bello\nCSC/2021/002,Femi Ade')).toEqual([
      ['CSC/2021/001', 'Amina Bello'],
      ['CSC/2021/002', 'Femi Ade'],
    ])
  })

  it('drops blank lines', () => {
    expect(parseCsvText('CSC/2021/001\n\n\nCSC/2021/002')).toEqual([
      ['CSC/2021/001'],
      ['CSC/2021/002'],
    ])
  })
})

describe('parseMatricListFromCsvText', () => {
  it('extracts matric numbers from raw CSV text with a header row', () => {
    const csv = 'Matric Number,Name\nCSC/2021/001,Amina Bello\nCSC/2021/002,Femi Ade'
    expect(parseMatricListFromCsvText(csv)).toEqual(['CSC/2021/001', 'CSC/2021/002'])
  })

  it('extracts matric numbers from raw CSV text with no header row', () => {
    const csv = 'CSC/2021/001\nCSC/2021/002'
    expect(parseMatricListFromCsvText(csv)).toEqual(['CSC/2021/001', 'CSC/2021/002'])
  })
})

describe('parseMatricListFromPaste', () => {
  it('splits on newlines', () => {
    expect(parseMatricListFromPaste('CSC/2021/001\nCSC/2021/002')).toEqual(['CSC/2021/001', 'CSC/2021/002'])
  })

  it('splits on commas', () => {
    expect(parseMatricListFromPaste('CSC/2021/001, CSC/2021/002')).toEqual(['CSC/2021/001', 'CSC/2021/002'])
  })

  it('splits on a mix of newlines and commas, normalizes case, and dedupes', () => {
    const text = 'csc/2021/001, CSC/2021/002\nCSC/2021/001\n\nCSC/2021/003'
    expect(parseMatricListFromPaste(text)).toEqual(['CSC/2021/001', 'CSC/2021/002', 'CSC/2021/003'])
  })

  it('returns an empty array for blank input', () => {
    expect(parseMatricListFromPaste('   \n  ')).toEqual([])
  })
})

describe('parseMatricListFromXlsxBuffer', () => {
  it('extracts matric numbers from a real .xlsx workbook buffer, header row included', async () => {
    const XLSX = await import('xlsx')
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Matric Number', 'Name'],
      ['CSC/2021/001', 'Amina Bello'],
      ['CSC/2021/002', 'Femi Ade'],
    ])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })

    const result = await parseMatricListFromXlsxBuffer(buffer)

    expect(result).toEqual(['CSC/2021/001', 'CSC/2021/002'])
  })

  it('extracts matric numbers from a workbook with no header row', async () => {
    const XLSX = await import('xlsx')
    const worksheet = XLSX.utils.aoa_to_sheet([['CSC/2021/001'], ['CSC/2021/002']])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })

    const result = await parseMatricListFromXlsxBuffer(buffer)

    expect(result).toEqual(['CSC/2021/001', 'CSC/2021/002'])
  })
})
