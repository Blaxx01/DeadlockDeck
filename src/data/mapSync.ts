/** Map-Daten (Minimap und Objekte) laden und offline speichern */
import { parseMapData, type ApiMap, type MapData } from '../map/mapData'
import { db, getMeta, setMeta, type DeckDB } from './db'
import { API_BASE, fetchJson } from './sync'

/**
 * Version der Aufbereitung – erhöhen, wenn sich parseMapData ändert: dann wird die Map beim nächsten Start
 * mit Netz neu geladen (2: Ziele der API in die Kartenmitte verschoben)
 */
export const MAP_DATA_VERSION = 2

/** Lädt die Map aus der API und speichert sie; bei Fehlern bleibt der alte Stand (wirft) */
export async function syncMap(database: DeckDB = db): Promise<MapData> {
  const data = parseMapData(await fetchJson<ApiMap>(`${API_BASE}/map`))
  await setMeta('mapData', data, database)
  await setMeta('mapDataVersion', MAP_DATA_VERSION, database)
  return data
}

export async function getMapData(database: DeckDB = db): Promise<MapData | null> {
  return getMeta<MapData | null>('mapData', null, database)
}

/** Map fehlt oder ist mit einer älteren Aufbereitung gespeichert */
export async function mapNeedsSync(database: DeckDB = db): Promise<boolean> {
  if (!(await getMapData(database))) return true
  return (await getMeta<number>('mapDataVersion', 1, database)) !== MAP_DATA_VERSION
}
