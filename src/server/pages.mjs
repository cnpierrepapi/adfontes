// Read every page of a contract list (17 Nov): market_listings and market_sales hand back at most 500 at a time,
// and the market passed 500 listings and 500 sales around 16 Nov, so reading only from 0 hid the newest ones
// (the marketplace showed 75 of 142 open listings). page(from) -> one page; stops at the first short page.
export const PAGE = 500;

export async function readAll(page, { size = PAGE, maxPages = 40 } = {}) {
  const out = [];
  for (let i = 0; i < maxPages; i++) {
    const l = (await page(i * size, size)) || [];
    out.push(...l);
    if (l.length < size) break;
  }
  return out;
}
