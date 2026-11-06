/** Map-Daten (Minimap und Objekte) laden und offline speichern */
import { parseMapData, type ApiMap, type MapData } from '../map/mapData'
import { db, getMeta, setMeta, type DeckDB } from './db'
import { API_BASE, fetchJson } from './sync'

/** Lädt die Map aus der API und speichert sie; bei Fehlern bleibt der alte Stand (wirft) */
export async function syncMap(database: DeckDB = db): Promise<MapData> {
  const data = parseMapData(await fetchJson<ApiMap>(`${API_BASE}/map`))
  await setMeta('mapData', data, database)
  return data
}

export async function getMapData(database: DeckDB = db): Promise<MapData | null> {
  return getMeta<MapData | null>('mapData', null, database)
}
