import { ref, computed, watch, unref } from 'vue'

// source: a ref/computed holding the full (already-filtered) array.
// Resets to page 1 whenever that array changes, so a filter change never
// strands the user on a page past the end of the new result set.
export function usePagination(source, pageSize = 15) {
  const currentPage = ref(1)
  const items = computed(() => unref(source) || [])
  const totalPages = computed(() => Math.max(1, Math.ceil(items.value.length / pageSize)))

  const paginatedItems = computed(() => {
    const start = (currentPage.value - 1) * pageSize
    return items.value.slice(start, start + pageSize)
  })

  watch(items, () => { currentPage.value = 1 })

  function goTo(page) {
    currentPage.value = Math.min(Math.max(1, page), totalPages.value)
  }
  function next() { goTo(currentPage.value + 1) }
  function prev() { goTo(currentPage.value - 1) }

  return { currentPage, totalPages, paginatedItems, goTo, next, prev }
}
