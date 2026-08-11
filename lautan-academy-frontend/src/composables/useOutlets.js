import { ref, computed } from 'vue'
import { api } from '../api/client'

// Replaces the OUTLET_LIST / WAREHOUSE_LOCATIONS / AREAS arrays previously
// hardcoded in ~10 files. Fetches once per call site — the whole table is
// ~60 rows, cheap enough that no shared cache/store is worth the added
// complexity (YAGNI). See
// docs/superpowers/specs/2026-08-11-outlet-management-design.md.
export function useOutlets() {
  const retailOutlets = ref([])
  const warehouseLocations = ref([])
  const areas = ref([])
  const loading = ref(true)
  const error = ref('')

  const allOutletCodes = computed(() => [...retailOutlets.value].sort().concat(warehouseLocations.value))
  const areaIds = computed(() => areas.value.map((a) => a.id))

  async function load() {
    loading.value = true
    error.value = ''
    try {
      const [outletsData, areasData] = await Promise.all([api.getOutlets(), api.getAreas()])
      retailOutlets.value = outletsData.outlets.filter((o) => o.division === 'retail').map((o) => o.code).sort()
      warehouseLocations.value = outletsData.outlets.filter((o) => o.division === 'warehouse').map((o) => o.code)
      areas.value = areasData.areas
    } catch (e) {
      error.value = e.message || 'Could not load outlets.'
    } finally {
      loading.value = false
    }
  }

  function outletsForArea(areaId) {
    return areas.value.find((a) => a.id === areaId)?.outlets || []
  }

  load()

  return { retailOutlets, warehouseLocations, allOutletCodes, areas, areaIds, loading, error, outletsForArea, reload: load }
}
