import type { MapData } from '../utils/fetchCS2Maps';
import { CURATED_MAPS } from '../shared/mapCatalog';

export { CURATED_ACTIVE_DUTY_MAP_IDS } from '../shared/mapCatalog';

/**
 * Maps maintained by this fork in addition to the upstream thumbnail catalog.
 */
export function getCuratedMaps(): MapData[] {
  return CURATED_MAPS.map((map) => ({ ...map }));
}
