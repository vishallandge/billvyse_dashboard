// Reuse one numeric collator; localeCompare with options repeats locale setup
// for every comparison, which is costly when thousands of rows are sorted.
const collator = new Intl.Collator(undefined, { numeric: true });

export function sortRows(items, accessor, direction = 'asc') {
  if (!accessor) return items;
  const factor = direction === 'desc' ? -1 : 1;
  return items.map((item) => ({ item, value: accessor(item) }))
    .sort((a, b) => {
      const left = a.value;
      const right = b.value;
      const leftEmpty = left === null || left === undefined || left === '';
      const rightEmpty = right === null || right === undefined || right === '';
      if (leftEmpty && rightEmpty) return 0;
      if (leftEmpty) return 1;
      if (rightEmpty) return -1;
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor;
      return collator.compare(String(left), String(right)) * factor;
    })
    .map(({ item }) => item);
}
