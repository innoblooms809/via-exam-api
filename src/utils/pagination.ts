// Page and limit for list endpoints, read the same way everywhere.
//
//   ?page=3&limit=25  → rows 51-75, plus { total, page, limit, totalPages, hasMore }
//
// A list that grows with the school (students × exams × sessions) never answers with the
// whole table: without page or limit it sends its first `unpagedLimit` rows (what older
// callers expect, capped), and `pagination.hasMore` says whether rows were left out.

export interface Paging {
  page: number;
  limit: number;
  offset: number;
  /** The caller asked for a page (sent page or limit). */
  requested: boolean;
}

export interface PageInfo {
  /** Rows matching the filters, on every page. */
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** Another page follows this one. */
  hasMore: boolean;
}

export interface PagingRule {
  /** Rows per page when the caller sends a page but no limit. */
  defaultLimit?: number;
  /** Most rows one request may ask for. */
  maxLimit?: number;
  /** Rows sent when the caller sends neither page nor limit (defaults to defaultLimit). */
  unpagedLimit?: number;
}

const toInt = (value: unknown): number => {
  if (value === undefined || value === null || value === "") return NaN;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : NaN;
};

export const paging = (query: any, { defaultLimit = 25, maxLimit = 100, unpagedLimit }: PagingRule = {}): Paging => {
  const rawPage = toInt(query?.page);
  const rawLimit = toInt(query?.limit);
  const requested = Number.isFinite(rawPage) || Number.isFinite(rawLimit);
  const page = Math.max(1, Number.isFinite(rawPage) ? rawPage : 1);
  const fallback = requested ? defaultLimit : (unpagedLimit ?? defaultLimit);
  const limit = Math.min(maxLimit, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : fallback));
  return { page, limit, offset: (page - 1) * limit, requested };
};

export const pageInfo = (total: number, page: number, limit: number): PageInfo => ({
  total,
  page,
  limit,
  totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
  hasMore: page * limit < total,
});
