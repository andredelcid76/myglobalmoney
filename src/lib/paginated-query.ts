const DEFAULT_PAGE_SIZE = 1000;

export async function fetchAllPages<T>(buildQuery: () => any, pageSize = DEFAULT_PAGE_SIZE): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);

    const page = (data ?? []) as T[];
    if (page.length === 0) break;

    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}