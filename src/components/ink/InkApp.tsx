'use client'

// Vortex Ink - Dibuja firmas y sellos con lápiz de presión, quita el fondo
// blanco, guarda en galería local y colócalos sobre PDFs.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PenTool,
  Eraser,
  Undo2,
  Trash2,
  Download,
  Save,
  Library,
  Wand2,
  FileSignature,
  Upload,
  Loader2,
  Check,
  X,
  Scissors,
} from 'lucide-react'
import {
  PlaceOptions,
  SignRecord,
  Stroke,
  canvasToPngBlob,
  deleteSign,
  drawStroke,
  fmtBytes,
  listSigns,
  placeInPdf,
  redrawAll,
  removeWhiteBackground,
  saveSign,
  trimTransparent,
} from '@/lib/ink'

const SUPPORT_EMAIL = 'vortexmusic.soporte.app@gmail.com'
const ACCENT = '#22d3ee'
const ACCENT2 = '#67e8f9'

function VortexLogo({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <rect width="48" height="48" rx="10" fill="#161616" />
      <circle cx="24" cy="24" r="17" fill="none" stroke={ACCENT} strokeWidth="3.5" />
      <path d="M24 10a14 14 0 1 1-9.9 4.1" fill="none" stroke={ACCENT2} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M24 17a7 7 0 1 0 7 7" fill="none" stroke={ACCENT2} strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="24" cy="24" r="3" fill={ACCENT2} />
    </svg>
  )
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-[#2b2b31] bg-[#141416] px-6 py-4">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-1 text-center">
        <p className="text-[11px] text-[#9b9ba4]">
          Vórtex Ink · Derechos Reservados © 2026 Vortex Company ·{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#67e8f9] hover:underline">
            {SUPPORT_EMAIL}
          </a>
        </p>
        <p className="text-[11px] text-[#9b9ba4]">Gratis · Sin anuncios · 100% local en tu navegador</p>
      </div>
    </footer>
  )
}

const btn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#2b2b31] bg-[#1e1e22] px-3 py-2 text-xs font-medium text-[#ececf1] hover:bg-[#26262b] disabled:opacity-40 disabled:cursor-not-allowed transition-colors'

const btnAccent =
  'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-[#0f0f10] transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-[#22d3ee] hover:bg-[#67e8f9]'

const CHECKER =
  'repeating-conic-gradient(#26262b 0% 25%, #1e1e22 0% 50%) 0 0 / 16px 16px'

const CANVAS_W = 900
const CANVAS_H = 380

export default function InkApp() {
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [current, setCurrent] = useState<Stroke | null>(null)
  const [color, setColor] = useState('#111111')
  const [width, setWidth] = useState(6)
  const [threshold, setThreshold] = useState(200)
  const [processed, setProcessed] = useState<HTMLCanvasElement | null>(null)
  const [gallery, setGallery] = useState<SignRecord[]>([])
  const [pdf, setPdf] = useState<{ file: File; pages: number } | null>(null)
  const [place, setPlace] = useState<PlaceOptions>({ pageNum: 1, xPct: 50, yPct: 70, widthPct: 30, rotation: 0 })
  const [busy, setBusy] = useState(false)
  const [pdfDone, setPdfDone] = useState<{ url: string; size: number } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pdfRef = useRef<HTMLInputElement>(null)
  const currentRef = useRef<Stroke | null>(null)
  const drawingRef = useRef(false)

  currentRef.current = current

  // canvas base
  useEffect(() => {
    const c = canvasRef.current
    if (c) redrawAll(c, strokes, '#ffffff')
  }, [strokes])

  useEffect(() => {
    void listSigns().then(setGallery)
  }, [])

  const pos = (e: React.PointerEvent): { x: number; y: number; p: number } => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const scaleX = CANVAS_W / rect.width
    const scaleY = CANVAS_H / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      p: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 1,
    }
  }

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault()
    canvasRef.current?.setPointerCapture(e.pointerId)
    drawingRef.current = true
    const p = pos(e)
    setCurrent({ points: [p], color, width })
  }

  const onMove = (e: React.PointerEvent) => {
    if (!drawingRef.current || !currentRef.current) return
    const p = pos(e)
    const pts = [...currentRef.current.points, p]
    const s: Stroke = { ...currentRef.current, points: pts }
    currentRef.current = s
    setCurrent(s)
    const ctx = canvasRef.current!.getContext('2d')!
    // refresco con fondo blanco + trazo actual para no dejar estelas
    redrawAll(canvasRef.current!, strokes, '#ffffff')
    drawStroke(ctx, s)
  }

  const onUp = (e: React.PointerEvent) => {
    if (!drawingRef.current) return
    drawingRef.current = false
    const s = currentRef.current
    setCurrent(null)
    if (s && s.points.length) setStrokes((prev) => [...prev, s])
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      // puede fallar si el puntero ya salió
    }
  }

  const undo = () => setStrokes((prev) => prev.slice(0, -1))
  const clear = () => {
    setStrokes([])
    setProcessed(null)
  }

  const makeTransparent = () => {
    const c = canvasRef.current!
    if (!strokes.length) {
      setMsg('Dibuja algo antes de quitar el fondo.')
      return
    }
    const t = removeWhiteBackground(c, threshold)
    setProcessed(trimTransparent(t))
    setMsg(null)
  }

  const downloadPng = async () => {
    const target = processed ?? canvasRef.current!
    const blob = await canvasToPngBlob(target)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = processed ? 'firma-transparente.png' : 'firma.png'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  const saveToGallery = async () => {
    const target = processed ?? canvasRef.current!
    if (!strokes.length) {
      setMsg('Dibuja algo antes de guardar.')
      return
    }
    const blob = await canvasToPngBlob(target)
    const reader = new FileReader()
    reader.onload = async () => {
      const rec = await saveSign(`Firma ${new Date().toLocaleString('es')}`, String(reader.result))
      setGallery((prev) => [rec, ...prev])
      setMsg('Guardado en tu galería local (IndexedDB).')
    }
    reader.readAsDataURL(blob)
  }

  const loadFromGallery = async (rec: SignRecord) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      c.getContext('2d')!.drawImage(img, 0, 0)
      setProcessed(c)
      setStrokes([])
      redrawAll(canvasRef.current!, [], '#ffffff')
      setMsg(`Firma «${rec.name}» cargada como pieza lista para PDF.`)
    }
    img.src = rec.dataUrl
  }

  const removeGalleryItem = async (id: string) => {
    await deleteSign(id)
    setGallery((prev) => prev.filter((g) => g.id !== id))
  }

  const onPdf = useCallback(async (f: File | null) => {
    if (!f) return
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
      setMsg('Ese archivo no es un PDF.')
      return
    }
    setMsg(null)
    setPdfDone(null)
    try {
      const { PDFDocument } = await import('pdf-lib')
      const doc = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true })
      setPdf({ file: f, pages: doc.getPageCount() })
    } catch {
      setMsg('No pude leer el PDF.')
    }
  }, [])

  const applyToPdf = async () => {
    if (!pdf || !processed) {
      setMsg('Necesitas una firma procesada (sin fondo) y un PDF cargado.')
      return
    }
    setBusy(true)
    try {
      const blob = await canvasToPngBlob(processed)
      const png = new Uint8Array(await blob.arrayBuffer())
      const bytes = await pdf.file.arrayBuffer()
      const out = await placeInPdf(bytes, png, place)
      const url = URL.createObjectURL(out)
      if (pdfDone) URL.revokeObjectURL(pdfDone.url)
      setPdfDone({ url, size: out.size })
      setMsg(null)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No pude aplicar la firma al PDF.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-[#2b2b31] bg-[#141416] px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <VortexLogo className="w-9 h-9" />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold tracking-tight">
              Vórtex Ink <span className="font-normal text-[#9b9ba4]">· Firmas y sellos, sin límites</span>
            </h1>
            <p className="text-[11px] text-[#9b9ba4]">Dibuja con presión, quita el fondo blanco y firma tus PDFs · todo local</p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {/* lienzo */}
        <section className="mb-4 grid gap-4 lg:grid-cols-[1fr_260px]">
          <div>
            <div className="overflow-hidden rounded-2xl border border-[#2b2b31] bg-white">
              <canvas
                ref={canvasRef}
                width={CANVAS_W}
                height={CANVAS_H}
                className="block w-full cursor-crosshair touch-none"
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
              />
            </div>
            <p className="mt-2 text-[11px] text-[#9b9ba4]">
              Firma con el ratón, el dedo o el lápiz de la tablet (el grosor responde a la presión).
            </p>
          </div>

          {/* herramientas */}
          <div className="space-y-3 rounded-2xl border border-[#2b2b31] bg-[#17171a] p-4">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#9b9ba4]">
              <PenTool className="h-3.5 w-3.5" /> Lápiz
            </p>
            <div className="flex gap-2">
              {['#111111', '#1d4ed8', '#b91c1c'].map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-full border-2 ${color === c ? 'border-[#22d3ee]' : 'border-transparent'}`}
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
            <label className="block text-xs text-[#9b9ba4]">
              Grosor: <span className="font-mono text-[#ececf1]">{width}</span>
              <input type="range" min={2} max={20} value={width} onChange={(e) => setWidth(parseInt(e.target.value, 10))} className="mt-1.5 w-full" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button className={btn} onClick={undo} disabled={!strokes.length}>
                <Undo2 className="h-3.5 w-3.5" /> Deshacer
              </button>
              <button className={btn} onClick={clear} disabled={!strokes.length}>
                <Trash2 className="h-3.5 w-3.5" /> Limpiar
              </button>
            </div>
            <label className="block text-xs text-[#9b9ba4]">
              Umbral de papel: <span className="font-mono text-[#ececf1]">{threshold}</span>
              <input type="range" min={120} max={245} value={threshold} onChange={(e) => setThreshold(parseInt(e.target.value, 10))} className="mt-1.5 w-full" />
            </label>
            <button className={`${btnAccent} w-full`} onClick={makeTransparent} disabled={!strokes.length}>
              <Wand2 className="h-3.5 w-3.5" /> Quitar fondo blanco
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button className={btn} onClick={() => void downloadPng()} disabled={!strokes.length}>
                <Download className="h-3.5 w-3.5" /> PNG
              </button>
              <button className={btn} onClick={() => void saveToGallery()} disabled={!strokes.length}>
                <Save className="h-3.5 w-3.5" /> Guardar
              </button>
            </div>
          </div>
        </section>

        {/* resultado sin fondo */}
        {processed && (
          <section className="mb-4 rounded-2xl border border-[#22d3ee] bg-[#121e24] p-4">
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#67e8f9]">
              <Scissors className="h-3.5 w-3.5" /> Pieza recortada con fondo transparente (lista para PDF)
            </p>
            <img src={processed.toDataURL('image/png')} alt="Firma sin fondo" className="max-h-40 rounded-lg" style={CHECKER as React.CSSProperties} />
          </section>
        )}

        {/* galería */}
        <section className="mb-4 rounded-2xl border border-[#2b2b31] bg-[#17171a] p-4">
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#9b9ba4]">
            <Library className="h-3.5 w-3.5" /> Galería local
          </p>
          {gallery.length === 0 ? (
            <p className="py-3 text-center text-xs text-[#9b9ba4]">Guarda firmas aquí para reutilizarlas después (queda solo en este navegador).</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {gallery.map((g) => (
                <div key={g.id} className="group relative rounded-xl border border-[#2b2b31] bg-[#0f0f10] p-2">
                  <img src={g.dataUrl} alt={g.name} className="h-16 w-auto max-w-[140px] object-contain" />
                  <div className="mt-1.5 flex items-center justify-center gap-1.5">
                    <button className={`${btn} px-2 py-1`} title="Usar esta firma" onClick={() => void loadFromGallery(g)}>
                      <Check className="h-3 w-3" />
                    </button>
                    <button className={`${btn} px-2 py-1 text-[#f87171]`} title="Eliminar" onClick={() => void removeGalleryItem(g.id)}>
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* PDF */}
        <section className="rounded-2xl border border-[#2b2b31] bg-[#17171a] p-4">
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#9b9ba4]">
            <FileSignature className="h-3.5 w-3.5" /> Colocar en un PDF
          </p>
          <input ref={pdfRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => void onPdf(e.target.files?.[0] ?? null)} />
          <div className="flex flex-wrap items-center gap-2">
            <button className={btn} onClick={() => pdfRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> {pdf ? pdf.file.name : 'Elegir PDF'}
            </button>
            {pdf && <span className="text-xs text-[#9b9ba4]">{pdf.pages} página(s) · {fmtBytes(pdf.file.size)}</span>}
            <button className={`${btn} px-2`} title="Quitar PDF" onClick={() => { setPdf(null); setPdfDone(null) }} disabled={!pdf}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {pdf && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs text-[#9b9ba4]">
                Página
                <input
                  type="number"
                  min={1}
                  max={pdf.pages}
                  value={place.pageNum}
                  onChange={(e) => setPlace((p) => ({ ...p, pageNum: Math.max(1, Math.min(pdf.pages, parseInt(e.target.value, 10) || 1)) }))}
                  className="mt-1 w-full rounded-lg border border-[#2b2b31] bg-[#0f0f10] px-2 py-1.5 font-mono text-xs"
                />
              </label>
              <label className="text-xs text-[#9b9ba4]">
                X: <span className="font-mono text-[#ececf1]">{place.xPct}%</span>
                <input type="range" min={0} max={100} value={place.xPct} onChange={(e) => setPlace((p) => ({ ...p, xPct: parseInt(e.target.value, 10) }))} className="mt-1.5 w-full" />
              </label>
              <label className="text-xs text-[#9b9ba4]">
                Y: <span className="font-mono text-[#ececf1]">{place.yPct}%</span>
                <input type="range" min={0} max={100} value={place.yPct} onChange={(e) => setPlace((p) => ({ ...p, yPct: parseInt(e.target.value, 10) }))} className="mt-1.5 w-full" />
              </label>
              <label className="text-xs text-[#9b9ba4]">
                Ancho: <span className="font-mono text-[#ececf1]">{place.widthPct}%</span>
                <input type="range" min={5} max={90} value={place.widthPct} onChange={(e) => setPlace((p) => ({ ...p, widthPct: parseInt(e.target.value, 10) }))} className="mt-1.5 w-full" />
              </label>
            </div>
          )}

          {pdf && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button className={btnAccent} onClick={() => void applyToPdf()} disabled={busy || !processed}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eraser className="hidden h-3.5 w-3.5" />}
                {busy ? 'Aplicando…' : 'Aplicar firma al PDF'}
              </button>
              {!processed && <span className="text-xs text-[#fbbf24]">Primero genera la pieza con «Quitar fondo blanco» o carga una de la galería.</span>}
            </div>
          )}

          {pdfDone && (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-[#3a5a1c] bg-[#182112] px-3 py-2.5">
              <Check className="h-4 w-4 text-[#22c55e]" />
              <span className="flex-1 text-xs text-[#bef264]">PDF firmado ({fmtBytes(pdfDone.size)})</span>
              <a className={btnAccent} href={pdfDone.url} download="documento-firmado.pdf">
                <Download className="h-3.5 w-3.5" /> Descargar
              </a>
            </div>
          )}
        </section>

        {msg && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#2b6b8f] bg-[#121e24] px-4 py-2.5 text-sm text-[#67e8f9]">
            {msg}
            <button className="ml-auto text-[#9b9ba4] hover:text-[#ececf1]" onClick={() => setMsg(null)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </main>

      <Footer />
    </div>
  )
}
