function toPaginationDTO({ page = 1, pageSize = 20, totalItems = 0 } = {}) {
  const totalPages = pageSize > 0 ? Math.ceil(totalItems / pageSize) : 0;
  return {
    page,
    pageSize,
    totalItems,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

module.exports = { toPaginationDTO };