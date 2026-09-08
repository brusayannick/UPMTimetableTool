import { describe, expect, it } from 'vitest'
import { decodeCustom, encodeCustom, parseTimeInput, type CustomLesson } from './custom.ts'

const lesson = (over: Partial<CustomLesson> = {}): CustomLesson => ({
  id: 'x1',
  name: 'Spanish B1',
  day: 1,
  start: 1080,
  end: 1170,
  room: 'A-101',
  ...over,
})

describe('custom hash codec', () => {
  it('round-trips lessons, including delimiters in names', () => {
    const lessons = [
      lesson(),
      lesson({ id: 'x2', name: 'a|b,c~d', day: 5, start: 600, end: 630, room: null }),
    ]
    expect(decodeCustom(encodeCustom(lessons)).map((l) => [l.name, l.day, l.start, l.end, l.room])).toEqual([
      ['Spanish B1', 1, 1080, 1170, 'A-101'],
      ['a|b,c~d', 5, 600, 630, null],
    ])
  })

  it('drops broken entries but keeps the valid ones', () => {
    const good = encodeCustom([lesson()])
    expect(decodeCustom(`${good}~bogus|1|2`).length).toBe(1)
    expect(decodeCustom('||').length).toBe(0)
    // Outside the grid, wrong step, end before start, bad weekday.
    expect(decodeCustom('n|1|480|540|r').length).toBe(0)
    expect(decodeCustom('n|1|600|615|r').length).toBe(0)
    expect(decodeCustom('n|1|700|600|r').length).toBe(0)
    expect(decodeCustom('n|9|600|660|r').length).toBe(0)
    expect(decodeCustom('')).toEqual([])
  })
})

describe('parseTimeInput', () => {
  it('parses 24-hour HH:MM', () => {
    expect(parseTimeInput('18:30')).toBe(1110)
    expect(parseTimeInput('09:00')).toBe(540)
    expect(parseTimeInput(' 8:05 ')).toBe(485)
  })

  it('rejects garbage', () => {
    expect(parseTimeInput('')).toBeNull()
    expect(parseTimeInput('18')).toBeNull()
    expect(parseTimeInput('24:00')).toBeNull()
    expect(parseTimeInput('18:60')).toBeNull()
    expect(parseTimeInput('6pm')).toBeNull()
  })
})
