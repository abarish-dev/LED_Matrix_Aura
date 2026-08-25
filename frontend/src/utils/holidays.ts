// Date-based holiday accent themes. Returns the active holiday (if any) so the
// app can preview it and the matrix can shift its accent colors to match.

export type Holiday = {
  id: string;
  name: string;
  emoji: string;
  colors: [string, string]; // [primary, secondary]
};

// month is 1-12.
function within(m: number, d: number, sm: number, sd: number, em: number, ed: number) {
  const cur = m * 100 + d;
  return cur >= sm * 100 + sd && cur <= em * 100 + ed;
}

export function currentHoliday(date: Date = new Date()): Holiday | null {
  const m = date.getMonth() + 1;
  const d = date.getDate();

  if (within(m, d, 12, 1, 12, 26))
    return { id: "winter", name: "Winter Holidays", emoji: "🎄", colors: ["#e5484d", "#30a46c"] };
  if (within(m, d, 12, 27, 12, 31) || within(m, d, 1, 1, 1, 2))
    return { id: "newyear", name: "New Year", emoji: "🎆", colors: ["#f5d90a", "#8e4ec6"] };
  if (within(m, d, 2, 12, 2, 15))
    return { id: "valentines", name: "Valentine's Day", emoji: "❤️", colors: ["#e5484d", "#f5a0c9"] };
  if (within(m, d, 3, 15, 3, 18))
    return { id: "stpatricks", name: "St. Patrick's Day", emoji: "☘️", colors: ["#30a46c", "#f5d90a"] };
  if (within(m, d, 7, 1, 7, 5))
    return { id: "independence", name: "Independence Day", emoji: "🎇", colors: ["#3b82f6", "#e5484d"] };
  if (within(m, d, 10, 24, 10, 31))
    return { id: "halloween", name: "Halloween", emoji: "🎃", colors: ["#f76b15", "#8e4ec6"] };
  if (within(m, d, 11, 20, 11, 30))
    return { id: "thanksgiving", name: "Thanksgiving", emoji: "🦃", colors: ["#f76b15", "#a15c07"] };

  return null;
}
