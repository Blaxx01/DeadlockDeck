/**
 * Bilder für die README (docs/readme/): Screenshots, zwei Animationen, Banner und Knopf „App öffnen“.
 *
 * Echte Daten aus der API, dazu ein erfundener, gefüllter Lernstand (Rang, Streak, Missionen, Lane-Angriff,
 * Statistik, Sammelalbum) – eingespielt über die Backup-Funktion der App.
 *
 *   npm run screenshots
 *
 * Braucht: Internet (Deadlock-API), Playwright mit Chromium (einmalig `npx playwright install chromium`)
 * und ffmpeg (WebP und Animationen).
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, devices } from 'playwright'
import { preview } from 'vite'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs', 'readme')
const TMP = mkdtempSync(join(tmpdir(), 'deadlockdeck-shots-'))
/** Erst hier sammeln – nach docs/readme/ kommt nur ein vollständiger Satz */
const STAGE = join(TMP, 'out')
/** Handy im Vollbild (installierte App) */
const VIEW = { width: 412, height: 915 }
/** Pixel je CSS-Pixel: ~536 px breit – in der README mit 260 px gezeigt, scharf auch auf Retina */
const SCALE = 1.3
/** Breite der Animationen */
const ANIM_WIDTH = 360

// ---------- Hilfen ----------

const log = (...args) => console.log(' ', ...args)

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysAgo(n, hour = 12, minute = 0) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, minute, 0, 0)
  return d
}

/** Fester Zufall – der Demo-Stand sieht bei jedem Lauf gleich aus */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })
}

/** PNG → WebP (verlustbehaftet, klein); `alpha`: durchsichtiger Hintergrund */
function toWebp(png, name, { alpha = false, quality = 86 } = {}) {
  const out = join(STAGE, `${name}.webp`)
  ffmpeg(['-i', png, '-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '6', ...(alpha ? ['-pix_fmt', 'yuva420p'] : []), out])
  log('✓', `${name}.webp`)
}

/** Ausschnitt eines aufgenommenen Videos → animiertes WebP */
function videoToWebp(video, name, { start, duration, crop }) {
  const out = join(STAGE, `${name}.webp`)
  const filters = [crop && `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`, 'fps=20', `scale=${ANIM_WIDTH}:-2:flags=lanczos`].filter(Boolean)
  ffmpeg(['-ss', (start / 1000).toFixed(2), '-t', (duration / 1000).toFixed(2), '-i', video, '-vf', filters.join(','),
    '-c:v', 'libwebp_anim', '-quality', '72', '-compression_level', '6', '-loop', '0', out])
  log('✓', `${name}.webp (Animation)`)
}

/**
 * Im Browser: direkt auf die Datenbank der App zugreifen (Daten lesen, Demo-Werte setzen).
 * Läuft in der Seite – daher ohne Bezüge nach außen, gesteuert über `cmd.op`.
 */
async function dbOp(cmd) {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('deadlockdeck')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const done = (tx, value) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(typeof value === 'function' ? value() : value)
    tx.onerror = () => reject(tx.error)
  })
  try {
    if (cmd.op === 'getAll' || cmd.op === 'count') {
      const tx = db.transaction(cmd.store)
      const q = cmd.op === 'getAll' ? tx.objectStore(cmd.store).getAll() : tx.objectStore(cmd.store).count()
      return await done(tx, () => q.result)
    }
    if (cmd.op === 'getMeta') {
      const tx = db.transaction('meta')
      const q = tx.objectStore('meta').get(cmd.key)
      return await done(tx, () => q.result?.value)
    }
    if (cmd.op === 'putMeta') {
      const tx = db.transaction('meta', 'readwrite')
      for (const [key, value] of Object.entries(cmd.values)) tx.objectStore('meta').put({ key, value })
      return await done(tx)
    }
    if (cmd.op === 'patchDay') {
      const tx = db.transaction('days', 'readwrite')
      const q = tx.objectStore('days').get(cmd.date)
      q.onsuccess = () => {
        const day = q.result
        tx.objectStore('days').put({ ...day, cards: [...day.cards, ...cmd.cards], reviewed: day.reviewed + cmd.cards.length })
      }
      return await done(tx)
    }
    if (cmd.op === 'addSouls') {
      const tx = db.transaction(['souls', 'meta'], 'readwrite')
      for (const e of cmd.entries) tx.objectStore('souls').add(e)
      const q = tx.objectStore('meta').get('soulsTotal')
      q.onsuccess = () => tx.objectStore('meta').put({
        key: 'soulsTotal', value: (q.result?.value ?? 0) + cmd.entries.reduce((sum, e) => sum + e.amount, 0),
      })
      return await done(tx)
    }
    throw new Error(`unbekannt: ${cmd.op}`)
  } finally {
    db.close()
  }
}

const getAll = (page, store) => page.evaluate(dbOp, { op: 'getAll', store })
const count = (page, store) => page.evaluate(dbOp, { op: 'count', store })
const getMeta = (page, key) => page.evaluate(dbOp, { op: 'getMeta', key })
const putMeta = (page, values) => page.evaluate(dbOp, { op: 'putMeta', values })
const addSouls = (page, entries) => page.evaluate(dbOp, { op: 'addSouls', entries })

/**
 * Zur Startseite: Die App öffnet nach dem Neuladen die zuletzt offene Ansicht (Verlaufseintrag) –
 * den also vorher leeren. Gleiche Adresse noch einmal laden zählt als Neuladen.
 */
async function openHome(page, url) {
  if (page.url().startsWith(url)) await page.evaluate(() => history.replaceState(null, ''))
  await page.goto(url)
  await page.locator('.lane-bar').waitFor()
}

async function settle(page) {
  await page.waitForFunction(() => [...document.images].every(i => i.complete), null, { timeout: 30_000 })
  await page.waitForTimeout(250)
}

async function shot(page, name, options = {}) {
  await settle(page)
  const png = join(TMP, `${name}.png`)
  await page.screenshot({ path: png, animations: 'disabled', ...options })
  toWebp(png, name)
  return png
}

// ---------- Demo-Stand ----------

const RANK_COST = i => Math.round((762.5 + 37.5 * i) / 50) * 50
/** Souls-Schwellen der Ränge (wie src/game/ranks.ts) */
const RANK_SOULS = (() => {
  const out = []
  let souls = 100
  for (let i = 0; i < 66; i++) {
    if (i > 0) souls += RANK_COST(i)
    out.push(souls)
  }
  return out
})()

/** Lernstand einer Karte: zuletzt vor `ago` Tagen wiederholt, nächste Wiederholung in `interval` Tagen */
function review(id, interval, ago, extra = {}) {
  const last = daysAgo(ago, 18)
  const due = new Date(last)
  due.setDate(due.getDate() + interval)
  return {
    id, due: due.toISOString(), last_review: last.toISOString(), stability: Math.max(1, interval), difficulty: 5,
    elapsed_days: 0, scheduled_days: interval, learning_steps: 0, reps: 3 + (interval > 20 ? 3 : 0), lapses: 0, state: 2, ...extra,
  }
}

/** Siege (W), Niederlagen (L) und Tage ohne Lernen (-) der letzten Tage beim Lane-Angriff, ältester zuerst */
const LANE_DAYS = 'WWLWWWWWWLWW-WWLWWWWWWW'.split('')
/** Tage ohne Lernen bzw. unter dem Tagesziel (Tage zurück) */
const MISSED = new Set([97, 96, 83, 72, 71, 58, 47, 46, 33, 11])
const LOW = new Set([88, 64, 39, 21, 7])
/** 16 Wochen – füllt den Kalender der Statistik (20 Wochen) gut */
const HISTORY_DAYS = 112
const MISSION_IDS = ['learn-items', 'learn-abilities', 'learn-heroes', 'learn-counters', 'quiz-7', 'guess-600', 'sprint-15', 'map-7', 'survival-10']
/** Missionen heute: Held des Tages (4 von 6 Karten), Quiz (5 von 7), Map-Quiz (offen) */
const TODAY_MISSIONS = ['hero', 'quiz-7', 'map-7']
/** Davon schon gelernt: so viele Karten des Helden */
const HERO_DONE = 4

function demoBackup(data) {
  const r = rng(20261107)
  const pick = (list, n) => [...list].sort(() => r() - 0.5).slice(0, n)
  const int = (a, b) => a + Math.floor(r() * (b - a + 1))
  const today = ymd(new Date())

  // Heroes mit allen Karten mind. Silber (Sterne), die übrigen gemischt
  const heroes = [...data.heroes].sort((a, b) => a.name.localeCompare(b.name))
  const counterIds = new Set(data.counters.map(c => c.id))
  const starHeroes = pick(heroes.filter(h => h.abilities?.length === 4 && counterIds.has(`counter:${h.className}`)), 4)
  const reviews = new Map()
  const learn = (id, level, ago = int(1, 20)) => {
    if (reviews.has(id)) return
    const interval = level === 'gold' ? int(62, 120) : level === 'silver' ? int(22, 55) : int(2, 15)
    reviews.set(id, review(id, interval, Math.min(ago, interval - 1)))
  }
  for (const h of starHeroes) {
    learn(h.id, 'gold')
    for (const a of h.abilities) learn(a.id, r() < 0.5 ? 'gold' : 'silver')
    learn(`counter:${h.className}`, 'silver')
  }
  const levels = (ids, gold, silver, bronze) => {
    const list = pick(ids, gold + silver + bronze)
    list.forEach((id, i) => learn(id, i < gold ? 'gold' : i < gold + silver ? 'silver' : 'bronze'))
  }
  // Ausstellungsstück: diese Item-Karte ist als erste fällig (Lern-Screenshots)
  // aktives Item mit Build-Pfad und möglichst vielen Werten (passt noch auf die Karte)
  const lines = i => (i.sections ?? []).reduce((n, sec) => n + (sec.stats?.length ?? 0), 0) + (i.timings?.length ?? 0)
  const showcase = data.items
    .filter(i => i.isActive && i.tier >= 2 && i.tier <= 3 && i.buildsFrom?.length && lines(i) <= 7)
    .sort((a, b) => lines(b) - lines(a) || a.name.localeCompare(b.name))[0]
    ?? data.items.find(i => i.tier >= 2 && i.buildsFrom?.length)
  levels(data.items.map(i => i.id).filter(id => id !== showcase?.id), 30, 36, 44)
  levels(data.abilities.map(a => a.id), 16, 26, 30)
  levels(data.heroes.map(h => h.id), 6, 9, 9)
  levels(data.counters.map(c => c.id), 3, 5, 6)
  // Held des Tages: ein Hero, dessen Karten noch nicht gelernt sind – heute schon 4 seiner 6 Karten
  const heroCardsOf = h => [h.id, ...h.abilities.map(a => a.id), ...(counterIds.has(`counter:${h.className}`) ? [`counter:${h.className}`] : [])]
  const fresh = heroes.filter(h => h.abilities?.length === 4 && heroCardsOf(h).every(id => !reviews.has(id)))
  const dayHero = fresh[0] ?? heroes[0]
  const offer = [...new Set([...fresh.slice(0, 3), ...heroes]).values()].slice(0, 3).map(h => h.id)
  const dayHeroCards = heroCardsOf(dayHero)
  for (const id of dayHeroCards.slice(0, HERO_DONE)) reviews.set(id, review(id, 1, 0))
  // Heute gelernt: 10 Item-Karten und 2 Fähigkeiten
  const todayItems = pick(data.items.filter(i => !reviews.has(i.id) && i.id !== showcase?.id), 10).map(i => i.id)
  const todayAbilities = pick(data.abilities.filter(a => !reviews.has(a.id)), 2).map(a => a.id)
  for (const id of [...todayItems, ...todayAbilities]) reviews.set(id, review(id, int(1, 3), 0))
  if (showcase) reviews.set(showcase.id, review(showcase.id, 6, 8))
  // ein paar fällige Karten in jedem Deck
  for (const prefix of ['item:', 'ability:', 'hero:']) {
    for (const rec of [...reviews.values()].filter(x => x.id.startsWith(prefix) && x.scheduled_days < 16 && x.id !== showcase?.id).slice(0, 3)) {
      rec.due = daysAgo(1, 9).toISOString()
    }
  }

  // Tage und Souls-Verlauf
  const days = []
  const souls = []
  const entry = (ago, minute, amount, reason, extra) => {
    const at = daysAgo(ago, 17, minute)
    souls.push({ at: at.getTime(), date: ymd(at), amount, reason, ...(extra ? { data: extra } : {}) })
  }
  const laneStartAgo = LANE_DAYS.length
  for (let ago = HISTORY_DAYS; ago >= 1; ago--) {
    const laneDay = ago <= laneStartAgo ? LANE_DAYS[laneStartAgo - ago] : undefined
    if (MISSED.has(ago) || laneDay === '-') continue
    const reviewed = LOW.has(ago) ? int(11, 17) : r() < 0.25 ? int(40, 52) : int(20, 36)
    days.push({ date: ymd(daysAgo(ago)), reviewed, newIntroduced: Math.min(10, int(4, 12)), newByDeck: { items: int(2, 6) } })
    let minute = 0
    entry(ago, minute++, reviewed * 10, 'card', { count: reviewed })
    if (reviewed >= 20) entry(ago, minute++, 100, 'goal')
    if (r() < 0.6) { const score = int(60, 132) * 10; entry(ago, minute++, score / 10, 'quiz', { score, correct: Math.round(score / 140), base: score / 10 }) }
    if (r() < 0.3) { const score = int(40, 92) * 10; entry(ago, minute++, score / 10, 'guess', { score, base: score / 10 }) }
    if (r() < 0.25) { const score = int(11, 24); entry(ago, minute++, score * 5, 'sprint', { score, base: score * 5 }) }
    if (r() < 0.25) { const score = int(50, 118) * 10; entry(ago, minute++, score / 10, 'map', { score, correct: Math.round(score / 140), base: score / 10 }) }
    // Tagesmissionen: Sieg = alle drei (+150 Bonus), sonst ein oder zwei
    const won = laneDay ? laneDay === 'W' : r() < 0.6
    const done = won ? 3 : int(1, 2)
    for (const id of pick(MISSION_IDS, done)) entry(ago, minute++, 100, 'mission', { id })
    if (won) entry(ago, minute++, 150, 'missions', laneDay ? { hero: pick(starHeroes.concat(heroes.slice(0, 6)), 1)[0].id } : undefined)
    // Mid Boss vor zwei Tagen: Rejuvenator auf Vorrat
    if (ago === 2) entry(ago, minute++, 0, 'midboss')
  }
  // heute: 16 Karten (4 davon vom Helden), eine Quiz-Runde mit 5 richtigen, 2 Schwächen geübt (Mid Boss)
  const todayCards = [...todayItems, ...todayAbilities, ...dayHeroCards.slice(0, HERO_DONE)]
  days.push({ date: today, reviewed: todayCards.length, cards: todayCards, newIntroduced: HERO_DONE, newByDeck: { heroes: 1, abilities: 3 }, weak: todayItems.slice(0, 2) })
  const now = new Date()
  souls.push({ at: now.getTime() - 3_600_000, date: today, amount: 10 * todayCards.length, reason: 'card', data: { count: todayCards.length } })
  souls.push({ at: now.getTime() - 3_000_000, date: today, amount: 70, reason: 'quiz', data: { score: 700, correct: 5, base: 70 } })

  // Rückwirkend gutgeschrieben (vor den 60 Tagen): Rang mitten in einer Stufe – der Sieg später bringt keinen Aufstieg
  const sum = souls.reduce((s, e) => s + e.amount, 0)
  let history = 1500
  // Sieg später: zwei Runden, drei Missionen, Bonus, Serien-Bonus (höchstens 100)
  const VICTORY = 90 + 80 + 3 * 100 + 150 + 100
  const nextAbove = total => RANK_SOULS.find(s => s > total) ?? Infinity
  while (nextAbove(sum + history) - (sum + history) < VICTORY + 300) history += 50
  souls.unshift({ at: daysAgo(HISTORY_DAYS + 1, 20).getTime(), date: ymd(daysAgo(HISTORY_DAYS + 1)), amount: history, reason: 'history', data: { cards: 600 } })

  // Meilensteine und Sterne passend zum Stand (sonst würden sie beim Einspielen „heute“ gutgeschrieben)
  const milestones = {}
  for (const rec of reviews.values()) {
    if (rec.scheduled_days >= 60) milestones[rec.id] = 'gold'
    else if (rec.scheduled_days >= 21) milestones[rec.id] = 'silver'
  }
  const buildBest = {}
  for (const [i, h] of heroes.slice(0, 8).entries()) buildBest[`typical:${h.heroId}`] = { errors: i < 2 ? 0 : int(1, 4), ms: int(40, 95) * 1000, at: daysAgo(int(2, 30)).getTime() }
  const guessClean = starHeroes.slice(0, 2).map(h => h.id)
  const heroStars = {}
  for (const h of heroes) {
    const stars = []
    const ok = id => (reviews.get(id)?.scheduled_days ?? 0) >= 21
    if (ok(h.id)) stars.push('hero')
    if (h.abilities?.length && h.abilities.every(a => ok(a.id))) stars.push('abilities')
    if (counterIds.has(`counter:${h.className}`) && ok(`counter:${h.className}`)) stars.push('counter')
    if (buildBest[`typical:${h.heroId}`]?.errors === 0) stars.push('build')
    if (guessClean.includes(h.id)) stars.push('guess')
    if (stars.length) heroStars[h.id] = stars
  }
  const learnedItems = [...reviews.keys()].filter(id => id.startsWith('item:'))
  const mistakes = pick(learnedItems, 5).map((cardId, i) => {
    const at = daysAgo(1 + i * 2, 19)
    return { cardId, source: ['quiz', 'learn', 'sprint', 'quiz', 'survival'][i], at: at.getTime(), date: ymd(at) }
  })

  return {
    showcase,
    dayHero: { id: dayHero.id, name: dayHero.name, heroId: dayHero.heroId, image: dayHero.smallImage ?? dayHero.image, cards: dayHeroCards, offer },
    backup: {
      app: 'deadlockdeck', version: 1, exportedAt: new Date().toISOString(),
      settings: {
        dailyGoal: 20, newPerDay: 10, slots: ['weapon', 'vitality', 'spirit'],
        // fürs Quiz: Bild → Name (anschaulich); Hero erraten: Silhouette; Map-Quiz erst „Wo ist …?“ bei den Zielen
        quizKinds: ['image'], knownQuizKinds: ['image', 'description', 'number', 'build', 'counterItem', 'counterHero', 'upgrade', 'effect'],
        guessKinds: ['silhouette'], effects: true, typeAnswers: [], quizScope: 'learned-first',
        mapGroups: ['objectives'], mapQuestionTypes: ['where'], introNew: true,
      },
      reviews: [...reviews.values()],
      days,
      quizHighscore: 1340, guessHighscore: 920, sprintHighscore: { all: 24, items: 21 }, survivalHighscore: 19, mapHighscore: 1180,
      buildBest, souls, soulsStart: ymd(daysAgo(HISTORY_DAYS + 1)), laneStart: ymd(daysAgo(laneStartAgo)),
      mistakes, milestones, heroStars, guessClean, notes: [],
    },
  }
}

// ---------- Ablauf ----------

async function main() {
  mkdirSync(STAGE, { recursive: true })
  const server = await preview({ root: ROOT, logLevel: 'warn', preview: { port: 4180, strictPort: false, open: false } })
  const url = server.resolvedUrls.local[0]
  log('App:', url)
  const browser = await chromium.launch()
  const context = await browser.newContext({
    ...devices['Pixel 7'], viewport: VIEW, screen: VIEW, deviceScaleFactor: SCALE,
    serviceWorkers: 'block', locale: 'de-DE', recordVideo: { dir: join(TMP, 'video'), size: VIEW },
  })
  const errors = []
  const watch = page => {
    page.on('pageerror', e => errors.push(String(e)))
    page.on('dialog', d => void d.accept())
  }
  const page = await context.newPage()
  watch(page)
  try {
    await takePictures({ browser, context, page, url, watch })
  } catch (e) {
    // Zum Nachsehen: was die App beim Fehler zeigte
    const debug = join(tmpdir(), 'deadlockdeck-screenshots-fehler.png')
    await page.screenshot({ path: debug }).catch(() => {})
    console.error(`Abgebrochen – Bildschirm beim Fehler: ${debug}`, errors.length ? `\nFehler in der App: ${errors.join('\n')}` : '')
    throw e
  } finally {
    await browser.close()
    await new Promise(resolve => server.httpServer.close(resolve))
  }
  if (errors.length) {
    rmSync(TMP, { recursive: true, force: true })
    console.error('Fehler in der App:', errors)
    process.exitCode = 1
    return
  }
  mkdirSync(OUT, { recursive: true })
  cpSync(STAGE, OUT, { recursive: true })
  rmSync(TMP, { recursive: true, force: true })
  log(`Fertig: ${OUT}`)
}

async function takePictures({ browser, context, page, url, watch }) {
  const button = name => page.getByRole('button', { name, exact: true })
  const deckRow = name => page.locator('.deck-row').filter({ has: page.locator('.deck-name', { hasText: new RegExp(`^${name}$`) }) })

  // 1) Daten aus der API laden (Items, Heroes, Map, Counter, Builds)
  log('Lade Daten aus der API …')
  await page.goto(url)
  await deckRow('Items').getByRole('button').waitFor({ timeout: 180_000 })
  for (let i = 0; i < 180; i++) {
    const [counters, builds, map] = await Promise.all([count(page, 'counters'), count(page, 'builds'), getMeta(page, 'mapData')])
    if (counters > 0 && builds > 0 && map) break
    if (i === 179) throw new Error('Counter-, Build- oder Map-Daten fehlen')
    await page.waitForTimeout(1000)
  }
  const data = {
    items: await getAll(page, 'items'), abilities: await getAll(page, 'abilities'),
    heroes: await getAll(page, 'heroes'), counters: await getAll(page, 'counters'),
  }
  const mapData = await getMeta(page, 'mapData')
  log(`${data.items.length} Items, ${data.abilities.length} Fähigkeiten, ${data.heroes.length} Heroes, ${data.counters.length} Counter`)

  // 2) Demo-Stand als Backup einspielen (über die App – Meilensteine, Souls usw. stimmen dann zusammen)
  const { backup, showcase, dayHero } = demoBackup(data)
  await button('Einstellungen').click()
  await page.locator('input[type=file]').setInputFiles({ name: 'demo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await page.getByText(/^Backup eingespielt/).waitFor()
  const today = ymd(new Date())
  // Missionen von heute; die Leiste hat diesen Stand schon gesehen (keine Animation auf dem Screenshot)
  // Gesamtfortschritt: 4 von 6 Hero-Karten + 5 von 7 im Quiz
  const progress = HERO_DONE / dayHero.cards.length + 5 / 7
  await putMeta(page, {
    missions: {
      date: today, ids: TODAY_MISSIONS, heroOffer: dayHero.offer, midBoss: { kind: 'weak', target: 5 },
      hero: { id: dayHero.id, name: dayHero.name, heroId: dayHero.heroId, image: dayHero.image, mode: 'learn', cards: dayHero.cards },
    },
    laneShown: { date: today, hp: [0, 1 - (progress - 1), 1], won: false },
    persistAskedOn: today,
  })
  await openHome(page, url)
  log('Demo-Stand eingespielt', showcase ? `(erste Karte: ${showcase.name})` : '')

  // 3) Screenshots
  const shots = {}
  await page.waitForTimeout(800)
  shots.start = await shot(page, 'start')

  await deckRow('Items').getByRole('button', { name: /^Lernen/ }).click()
  await page.locator('.card-swipe').waitFor()
  await settle(page)
  await page.keyboard.press('Space')
  await page.waitForTimeout(600)
  shots.karte = await shot(page, 'karte')
  await page.keyboard.press('Escape')

  await button('Shop öffnen').click()
  await page.locator('.album-summary').waitFor()
  await shot(page, 'album')
  await page.goBack()

  await button('Quiz starten').click()
  await page.locator('.quiz-image').waitFor()
  await settle(page)
  const src = await page.locator('.quiz-image').getAttribute('src')
  const answer = data.items.find(i => i.image === src)?.name
  await page.locator('.options .option').filter({ has: page.getByText(answer, { exact: true }) }).first().click()
  await page.waitForTimeout(400)
  await shot(page, 'quiz')
  await page.keyboard.press('Escape')

  await button('Hero erraten starten').click()
  await page.locator('.guess-stage').waitFor()
  await page.waitForTimeout(600)
  await shot(page, 'hero-erraten')
  await page.keyboard.press('Escape')

  await button('Sprint starten').click()
  // Items: am Bild am besten zu erkennen
  await page.getByRole('tab', { name: 'Items', exact: true }).click()
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.locator('.sprint-options').waitFor()
  await page.waitForTimeout(2500)
  await shot(page, 'sprint')
  await openHome(page, url)

  await button('Map öffnen').click()
  await page.locator('.map-overlay').waitFor()
  await page.locator('.legend-item', { hasText: 'Teleporter' }).click()
  await page.evaluate(() => window.scrollTo(0, 0))
  await shot(page, 'map')
  await page.goBack()

  // Map-Quiz „Wo ist …?“ (Ziele): auf die richtige Stelle tippen
  await button('Map-Quiz starten').click()
  const prompt = await page.locator('.quiz-prompt').innerText()
  const kind = /Mid Boss/.test(prompt) ? 'midBoss' : /Patron/.test(prompt) ? 'patron' : /Walker/.test(prompt) ? 'walker' : 'guardian'
  const target = mapData.points.find(p => p.kind === kind)
  const overlay = page.locator('.map-overlay')
  await overlay.scrollIntoViewIfNeeded()
  const box = await overlay.boundingBox()
  await page.mouse.click(box.x + target.x * box.width, box.y + target.y * box.height)
  await page.waitForTimeout(500)
  await page.evaluate(() => window.scrollTo(0, 0))
  await shot(page, 'map-quiz')
  await page.keyboard.press('Escape')

  // „Was ist hier?“ (Orientierung): Frage mit markierter Stelle
  const settings = await getMeta(page, 'settings')
  await putMeta(page, { settings: { ...settings, mapGroups: ['orientation', 'camps'], mapQuestionTypes: ['what'] } })
  await openHome(page, url)
  await button('Map-Quiz starten').click()
  await page.locator('.map-options').waitFor()
  await page.evaluate(() => window.scrollTo(0, 0))
  await shot(page, 'map-quiz-was')
  await page.keyboard.press('Escape')

  await button('Statistik öffnen').click()
  await page.locator('.cal-grid').waitFor()
  await page.locator('section.panel', { hasText: 'Lerntage' }).evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 12))
  await shot(page, 'statistik')

  // die Hauptseite verlassen (eine Datei vom selben Server: die Datenbank bleibt erreichbar) –
  // sonst merkt sich ihre Startseite die Lane-Animation
  await page.goto(new URL('icon.svg', url).href)

  // 4) Animation: Karte umdrehen und nach rechts wischen
  {
    const p = await context.newPage()
    watch(p)
    const t0 = Date.now()
    await p.goto(url)
    await p.locator('.deck-row').filter({ has: p.locator('.deck-name', { hasText: /^Items$/ }) }).getByRole('button', { name: /^Lernen/ }).click()
    await p.locator('.card-swipe').waitFor()
    await p.waitForFunction(() => [...document.images].every(i => i.complete))
    await p.waitForTimeout(300)
    const start = Date.now() - t0
    await p.waitForTimeout(900)
    await p.locator('.card-swipe').click()
    await p.waitForTimeout(2300)
    const card = await p.locator('.card-swipe').boundingBox()
    const y = card.y + card.height * 0.45
    await p.mouse.move(card.x + card.width * 0.3, y)
    await p.mouse.down()
    for (let i = 1; i <= 14; i++) {
      await p.mouse.move(card.x + card.width * (0.3 + 0.045 * i), y + i * 1.5)
      await p.waitForTimeout(35)
    }
    await p.mouse.up()
    await p.waitForTimeout(1300)
    const end = Date.now() - t0
    await p.close()
    videoToWebp(await p.video().path(), 'karte-wischen', { start, duration: end - start })
  }

  // 5) Animation: Lane-Angriff – Quiz und Map-Quiz geschafft → Walker und Patron fallen, Sieg mit Konfetti
  {
    const now = Date.now()
    await addSouls(page, [
      { at: now, date: today, amount: 90, reason: 'quiz', data: { score: 900, correct: 8, base: 90 } },
      { at: now + 1, date: today, amount: 80, reason: 'map', data: { score: 800, correct: 7, base: 80 } },
    ])
    // die letzten beiden Karten des Helden
    await page.evaluate(dbOp, { op: 'patchDay', date: today, cards: dayHero.cards.slice(HERO_DONE) })
    const p = await context.newPage()
    watch(p)
    // das Porträt des Helden gleich beim Laden der Seite anfordern – sonst blitzt am Anfang ein leerer Rahmen auf
    if (dayHero.image) await p.addInitScript(src => { window.__portrait = new Image(); window.__portrait.src = src }, dayHero.image)
    const t0 = Date.now()
    await p.goto(url)
    await p.locator('.lane-bar').waitFor()
    const start = Date.now() - t0
    await p.waitForTimeout(5600)
    const end = Date.now() - t0
    await p.close()
    // ganzer Bildschirm wie die Screenshots daneben (gleich hoch in der Bilderreihe)
    videoToWebp(await p.video().path(), 'lane-sieg', { start, duration: end - start })
  }

  // 6) Banner und Knopf „App öffnen“
  const icon = readFileSync(join(ROOT, 'public', 'icon.svg')).toString('base64')
  const img = file => `data:image/png;base64,${readFileSync(file).toString('base64')}`
  const art = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1.5 })
  await art.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; width: 1280px; height: 640px; overflow: hidden; display: flex; align-items: center; color: #ece4d6;
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      background: radial-gradient(circle at 78% 50%, #3b2c14 0%, #1b1712 38%, #0f0d0b 70%); }
    .text { padding-left: 80px; width: 640px; flex: none; }
    .name { display: flex; align-items: center; gap: 22px; font-size: 56px; font-weight: 800; letter-spacing: 0.01em; }
    .claim { margin: 30px 0 0; font-size: 31px; line-height: 1.38; color: #ddd2c0; }
    .facts { margin: 22px 0 0; font-size: 23px; color: #a39783; }
    .facts b { color: #e0b25c; font-weight: 700; }
    .phones { position: relative; flex: 1; height: 100%; }
    .phone { position: absolute; width: 236px; border-radius: 28px; border: 3px solid #4a4134;
      box-shadow: 0 30px 60px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.04); }
    .a { left: 34px; top: 54px; transform: rotate(-6deg); }
    .b { left: 300px; top: 70px; transform: rotate(5deg); }
  </style></head><body>
    <div class="text">
      <div class="name"><img src="data:image/svg+xml;base64,${icon}" width="104" height="104" alt="">DeadlockDeck</div>
      <p class="claim">Deadlock lernen wie Vokabeln:<br>Items, Heroes, Counter und die Map.</p>
      <p class="facts"><b>Kostenlos</b> · ohne Konto · <b>offline</b> auf dem Handy</p>
    </div>
    <div class="phones"><img class="phone a" src="${img(shots.start)}" alt=""><img class="phone b" src="${img(shots.karte)}" alt=""></div>
  </body></html>`)
  await art.waitForFunction(() => [...document.images].every(i => i.complete))
  const bannerPng = join(TMP, 'banner.png')
  await art.screenshot({ path: bannerPng })
  toWebp(bannerPng, 'banner', { quality: 88 })

  await art.setViewportSize({ width: 400, height: 140 })
  await art.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; background: transparent; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
    a { display: inline-flex; align-items: center; gap: 14px; padding: 15px 30px 15px 26px; border-radius: 16px;
      background: linear-gradient(180deg, #ecc46f, #d9a64c); color: #1b1408; font-size: 27px; font-weight: 800; text-decoration: none;
      box-shadow: 0 2px 0 #8a6428, 0 6px 16px rgba(0,0,0,.35); }
    svg { width: 24px; height: 24px; }
    #w { display: inline-block; padding: 4px 10px 16px; }
  </style></head><body><div id="w"><a><svg viewBox="0 0 24 24"><path d="M6 3.5v17l14-8.5z" fill="#1b1408"/></svg>App öffnen</a></div></body></html>`)
  const buttonPng = join(TMP, 'app-oeffnen.png')
  await art.locator('#w').screenshot({ path: buttonPng, omitBackground: true })
  toWebp(buttonPng, 'app-oeffnen', { alpha: true, quality: 92 })

}

main().catch(e => {
  console.error(e)
  rmSync(TMP, { recursive: true, force: true })
  process.exit(1)
})
