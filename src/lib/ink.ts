// Vortex Ink - Firmas y sellos dibujados a mano.
// Trazos con Pointer Events y presión, suavizado por curvas cuadráticas,
// quitar fondo blanco por umbral, galería en IndexedDB y colocación en PDFs.
// 100% local en el navegador, sin backend.

import { PDFDocument, degrees } from 'pdf-lib'

// ---------- Trazos ----------

export interface Point {
  x: number
  y: number
  p: number // presión 0..1
}

export interface Stroke {
  points: Point[]
  color: string
  width: number
}

/** dibuja un trazo con curvas suavizadas sobre el contexto */
export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  const pts = s.points
  if (!pts.length) return
  ctx.save()
  ctx.strokeStyle = s.color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (pts.length === 1) {
    const r = (s.width * (pts[0].p || 0.5)) / 2 + s.width / 3
    ctx.fillStyle = s.color
    ctx.beginPath()
    ctx.arc(pts[0].x, pts[0].y, Math.max(1, r), 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2
    const my = (pts[i].y + pts[i + 1].y) / 2
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
  ctx.lineWidth = s.width
  ctx.stroke()
  ctx.restore()
}

export function redrawAll(canvas: HTMLCanvasElement, strokes: Stroke[], background: string | null) {
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  for (const s of strokes) drawStroke(ctx, s)
}

// ---------- Quitar fondo blanco ----------

/**
 * Convierte el fondo blanco del canvas en transparencia.
 * threshold: qué luminancia se considera "papel" (0-255)
 * softness: suaviza la transición de alpha en los bordes
 */
export function removeWhiteBackground(
  source: HTMLCanvasElement,
  threshold: number,
  softness = 60
): HTMLCanvasElement {
  const w = source.width
  const h = source.height
  const src = source.getContext('2d')!.getImageData(0, 0, w, h)
  const out = new ImageData(w, h)
  const data = src.data
  const o = out.data
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    // alpha 0 (papel) → 255 (tinta) de forma progresiva
    let alpha = ((threshold + softness / 2 - lum) / softness) * 255
    alpha = Math.max(0, Math.min(255, alpha))
    if (lum > threshold) {
      // zona de papel: transparencia total
      o[i] = r
      o[i + 1] = g
      o[i + 2] = b
      o[i + 3] = alpha > 0 ? alpha : 0
    } else {
      o[i] = r
      o[i + 1] = g
      o[i + 2] = b
      o[i + 3] = alpha
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.putImageData(out, 0, 0)
  return canvas
}

/** recorta el margen transparente alrededor del trazo */
export function trimTransparent(canvas: HTMLCanvasElement, padding = 12): HTMLCanvasElement {
  const ctx = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  let minX = w, minY = h, maxX = 0, maxY = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (minX > maxX || minY > maxY) return canvas // todo vacío
  minX = Math.max(0, minX - padding)
  minY = Math.max(0, minY - padding)
  maxX = Math.min(w - 1, maxX + padding)
  maxY = Math.min(h - 1, maxY + padding)
  const nw = maxX - minX + 1
  const nh = maxY - minY + 1
  const out = document.createElement('canvas')
  out.width = nw
  out.height = nh
  out.getContext('2d')!.drawImage(canvas, minX, minY, nw, nh, 0, 0, nw, nh)
  return out
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No pude exportar el PNG'))), 'image/png')
  })
}

// ---------- Galería (IndexedDB) ----------

export interface SignRecord {
  id: string
  name: string
  dataUrl: string
  ts: number
}

const DB_NAME = 'vortex-ink'
const STORE = 'signs'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveSign(name: string, dataUrl: string): Promise<SignRecord> {
  const db = await openDb()
  const rec: SignRecord = { id: Math.random().toString(36).slice(2, 10), name, dataUrl, ts: Date.now() }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(rec)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  return rec
}

export async function listSigns(): Promise<SignRecord[]> {
  try {
    const db = await openDb()
    const res = await new Promise<SignRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).getAll()
      req.onsuccess = () => resolve((req.result as SignRecord[]).sort((a, b) => b.ts - a.ts))
      req.onerror = () => reject(req.error)
    })
    db.close()
    return res
  } catch {
    return []
  }
}

export async function deleteSign(id: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // noop
  }
}

// ---------- PDF ----------

export interface PlaceOptions {
  pageNum: number // 1-indexed
  xPct: number // 0..100 desde la izquierda
  yPct: number // 0..100 desde arriba
  widthPct: number // ancho de la firma como % del ancho de la página
  rotation: number
}

export async function placeInPdf(
  pdfBytes: ArrayBuffer,
  pngBytes: Uint8Array,
  opts: PlaceOptions
): Promise<Blob> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
  const pages = doc.getPages()
  const page = pages[Math.min(Math.max(opts.pageNum - 1, 0), pages.length - 1)]
  if (!page) throw new Error('Ese número de página no existe')
  const { width: W, height: H } = page.getSize()
  const img = await doc.embedPng(pngBytes)
  const w = (opts.widthPct / 100) * W
  const h = (w / img.width) * img.height
  const x = (opts.xPct / 100) * W - w / 2
  const y = H - (opts.yPct / 100) * H - h / 2
  page.drawImage(img, {
    x,
    y,
    width: w,
    height: h,
    rotate: degrees(opts.rotation),
  })
  const out = await doc.save()
  return new Blob([out as unknown as BlobPart], { type: 'application/pdf' })
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
