import { AlphaTabApi, StaveProfile } from '@coderline/alphatab'
import { parse } from 'musicxml-io'
import { PitchDetector } from 'pitchy'
import { generateTab, Tuning, type NoteModel, type TabData } from 'tutts'
import { toAlphaTex } from 'tutts-alphatab'
import './style.css'

const fileInput = document.querySelector<HTMLInputElement>('#file-input')
const tabContainer = document.querySelector<HTMLDivElement>('#tab-container')
const uploadArea = document.querySelector<HTMLLabelElement>('#upload-area')
const uploadStatus = document.querySelector<HTMLParagraphElement>('#upload-status')
const uploadPanel = document.querySelector<HTMLElement>('#upload-panel')
const settingsPanel = document.querySelector<HTMLDivElement>('#settings-panel')
const selectedFileName = document.querySelector<HTMLSpanElement>('#selected-file-name')
const convertButton = document.querySelector<HTMLButtonElement>('#convert-btn')
const showSheetMusic = document.querySelector<HTMLInputElement>('#show-sheet-music')
const resultsPanel = document.querySelector<HTMLElement>('#results-panel')
const downloadPanel = document.querySelector<HTMLDivElement>('#download-panel')
const downloadPdfButton = document.querySelector<HTMLButtonElement>('#download-pdf-btn')
const downloadXmlButton = document.querySelector<HTMLButtonElement>('#download-xml-btn')
const openTunerButton = document.querySelector<HTMLButtonElement>('#open-tuner-btn')
const tunerModal = document.querySelector<HTMLDivElement>('#tuner-modal')
const closeTunerButton = document.querySelector<HTMLButtonElement>('#close-tuner-btn')
const tunerNote = document.querySelector<HTMLParagraphElement>('#tuner-note')
const tunerFrequency = document.querySelector<HTMLParagraphElement>('#tuner-frequency')
const tunerPitchStatus = document.querySelector<HTMLParagraphElement>('#tuner-pitch-status')
const tunerNeedle = document.querySelector<HTMLDivElement>('#tuner-needle')
const tunerError = document.querySelector<HTMLParagraphElement>('#tuner-error')
const tunerStringIndicators = document.querySelectorAll<HTMLDivElement>('[data-tuner-string]')

if (
  !fileInput ||
  !tabContainer ||
  !uploadArea ||
  !uploadStatus ||
  !uploadPanel ||
  !settingsPanel ||
  !selectedFileName ||
  !convertButton ||
  !showSheetMusic ||
  !resultsPanel ||
  !downloadPanel ||
  !downloadPdfButton ||
  !downloadXmlButton ||
  !openTunerButton ||
  !tunerModal ||
  !closeTunerButton ||
  !tunerNote ||
  !tunerFrequency ||
  !tunerPitchStatus ||
  !tunerNeedle ||
  !tunerError ||
  tunerStringIndicators.length !== 6
) {
  throw new Error('Dosya yükleme alanı veya tab alanı oluşturulamadı.')
}

const fileInputElement = fileInput
const tabContainerElement = tabContainer
const uploadAreaElement = uploadArea
const uploadStatusElement = uploadStatus
const uploadPanelElement = uploadPanel
const settingsPanelElement = settingsPanel
const selectedFileNameElement = selectedFileName
const convertButtonElement = convertButton
const showSheetMusicElement = showSheetMusic
const resultsPanelElement = resultsPanel
const downloadPanelElement = downloadPanel
const downloadPdfButtonElement = downloadPdfButton
const downloadXmlButtonElement = downloadXmlButton
const openTunerButtonElement = openTunerButton
const tunerModalElement = tunerModal
const closeTunerButtonElement = closeTunerButton
const tunerNoteElement = tunerNote
const tunerFrequencyElement = tunerFrequency
const tunerPitchStatusElement = tunerPitchStatus
const tunerNeedleElement = tunerNeedle
const tunerErrorElement = tunerError
const tunerStringIndicatorElements = Array.from(tunerStringIndicators)
const maxFileSize = 10 * 1024 * 1024

let alphaTabApi: AlphaTabApi | undefined
let selectedFile: File | undefined
let currentMusicXML = ''
let tunerAudioContext: AudioContext | undefined
let tunerStream: MediaStream | undefined
let tunerSource: MediaStreamAudioSourceNode | undefined
let tunerAnalyser: AnalyserNode | undefined
let tunerAnimationFrame = 0
let tunerSession = 0
let previouslyFocusedElement: HTMLElement | null = null

const guitarStrings = [
  { note: 'E2', frequency: 82.41 },
  { note: 'A2', frequency: 110 },
  { note: 'D3', frequency: 146.83 },
  { note: 'G3', frequency: 196 },
  { note: 'B3', frequency: 246.94 },
  { note: 'E4', frequency: 329.63 },
] as const

const pitchNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

const semitonesByStep: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Dosya metin olarak okunamadı.'))
        return
      }

      resolve(reader.result)
    }

    reader.onerror = () => {
      reject(reader.error ?? new Error('Dosya okunurken bir hata oluştu.'))
    }

    reader.onabort = () => {
      reject(new Error('Dosya okuma işlemi iptal edildi.'))
    }

    reader.readAsText(file)
  })
}

function resetTunerReadout(message: string): void {
  tunerNoteElement.textContent = '--'
  tunerNoteElement.className = 'text-6xl font-bold tracking-tight text-white sm:text-7xl'
  tunerFrequencyElement.textContent = '-- Hz'
  tunerPitchStatusElement.textContent = message
  tunerPitchStatusElement.className = 'mt-4 text-sm font-semibold text-slate-300'
  tunerNeedleElement.style.left = '50%'
  tunerNeedleElement.className =
    'absolute left-1/2 top-1 h-11 w-1 -translate-x-1/2 rounded-full bg-slate-300 shadow-lg transition-[left] duration-100'
  tunerStringIndicatorElements.forEach((indicator) => {
    indicator.classList.remove('bg-white/15', 'text-white', 'ring-1', 'ring-emerald-300/70')
  })
}

function updateTunerReadout(frequency: number, clarity: number): void {
  if (clarity < 0.88 || frequency < 60 || frequency > 500) {
    resetTunerReadout('Tek bir teli çalın...')
    return
  }

  const midiNote = Math.round(69 + 12 * Math.log2(frequency / 440))
  const detectedNote = `${pitchNames[((midiNote % 12) + 12) % 12]}${Math.floor(midiNote / 12) - 1}`
  let nearestString: { string: (typeof guitarStrings)[number]; cents: number } = {
    string: guitarStrings[0],
    cents: Number.POSITIVE_INFINITY,
  }
  for (const string of guitarStrings) {
    const cents = 1200 * Math.log2(frequency / string.frequency)
    if (Math.abs(cents) < Math.abs(nearestString.cents)) {
      nearestString = { string, cents }
    }
  }

  tunerNoteElement.textContent = detectedNote
  tunerFrequencyElement.textContent = `${frequency.toFixed(2)} Hz · ${nearestString.cents > 0 ? '+' : ''}${nearestString.cents.toFixed(0)} cents`
  tunerStringIndicatorElements.forEach((indicator) => {
    const isActive = indicator.dataset.tunerString === nearestString.string.note
    indicator.classList.toggle('bg-white/15', isActive)
    indicator.classList.toggle('text-white', isActive)
    indicator.classList.toggle('ring-1', isActive)
    indicator.classList.toggle('ring-emerald-300/70', isActive)
  })

  const indicatorPosition = 50 + Math.max(-50, Math.min(50, nearestString.cents))
  tunerNeedleElement.style.left = `${indicatorPosition}%`

  if (Math.abs(nearestString.cents) <= 5) {
    tunerPitchStatusElement.textContent = 'Tam akortta'
    tunerPitchStatusElement.className = 'mt-4 text-sm font-semibold text-emerald-300'
    tunerNoteElement.className = 'text-6xl font-bold tracking-tight text-emerald-300 sm:text-7xl'
    tunerNeedleElement.className =
      'absolute top-1 h-11 w-1 -translate-x-1/2 rounded-full bg-emerald-300 shadow-lg transition-[left] duration-100'
    return
  }

  const isFlat = nearestString.cents < 0
  tunerPitchStatusElement.textContent = isFlat ? 'Çok pes · Teli sıkın' : 'Çok tiz · Teli gevşetin'
  tunerPitchStatusElement.className = 'mt-4 text-sm font-semibold text-amber-300'
  tunerNoteElement.className = 'text-6xl font-bold tracking-tight text-amber-300 sm:text-7xl'
  tunerNeedleElement.className =
    'absolute top-1 h-11 w-1 -translate-x-1/2 rounded-full bg-amber-300 shadow-lg transition-[left] duration-100'
}

function updateTunerFrame(
  detector: ReturnType<typeof PitchDetector.forFloat32Array>,
  samples: Float32Array<ArrayBuffer>,
  session: number,
): void {
  if (session !== tunerSession || !tunerAnalyser || !tunerAudioContext) {
    return
  }

  tunerAnalyser.getFloatTimeDomainData(samples)
  const [frequency, clarity] = detector.findPitch(samples, tunerAudioContext.sampleRate)
  updateTunerReadout(frequency, clarity)
  tunerAnimationFrame = window.requestAnimationFrame(() =>
    updateTunerFrame(detector, samples, session),
  )
}

async function startTuner(): Promise<void> {
  const session = ++tunerSession
  tunerErrorElement.textContent = ''
  tunerErrorElement.classList.add('hidden')
  resetTunerReadout('Mikrofon başlatılıyor...')

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Mikrofon erişimi için siteyi HTTPS veya localhost üzerinden açın.')
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  })

  if (session !== tunerSession) {
    stream.getTracks().forEach((track) => track.stop())
    return
  }

  tunerStream = stream
  tunerAudioContext = new AudioContext()
  await tunerAudioContext.resume()

  if (session !== tunerSession) {
    await stopTunerAudio()
    return
  }

  tunerSource = tunerAudioContext.createMediaStreamSource(stream)
  tunerAnalyser = tunerAudioContext.createAnalyser()
  tunerAnalyser.fftSize = 4096
  tunerAnalyser.smoothingTimeConstant = 0
  tunerSource.connect(tunerAnalyser)

  const detector = PitchDetector.forFloat32Array(tunerAnalyser.fftSize)
  detector.clarityThreshold = 0.88
  tunerPitchStatusElement.textContent = 'Mikrofon aktif · Bir gitar teli çalın'
  const samples: Float32Array<ArrayBuffer> = new Float32Array(tunerAnalyser.fftSize)
  tunerAnimationFrame = window.requestAnimationFrame(() =>
    updateTunerFrame(detector, samples, session),
  )
}

async function stopTunerAudio(): Promise<void> {
  window.cancelAnimationFrame(tunerAnimationFrame)
  tunerAnimationFrame = 0
  tunerStream?.getTracks().forEach((track) => track.stop())
  tunerSource?.disconnect()
  tunerAnalyser?.disconnect()
  tunerStream = undefined
  tunerSource = undefined
  tunerAnalyser = undefined

  const audioContext = tunerAudioContext
  tunerAudioContext = undefined
  if (audioContext && audioContext.state !== 'closed') {
    await audioContext.close()
  }
}

async function closeTuner(): Promise<void> {
  tunerSession++
  tunerModalElement.classList.add('hidden')
  tunerModalElement.classList.remove('flex')
  tunerModalElement.setAttribute('aria-hidden', 'true')
  document.body.classList.remove('overflow-hidden')
  await stopTunerAudio()
  resetTunerReadout('Akort cihazını açmak için mikrofonu etkinleştirin.')
  previouslyFocusedElement?.focus()
}

async function openTuner(): Promise<void> {
  previouslyFocusedElement = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
  tunerModalElement.classList.remove('hidden')
  tunerModalElement.classList.add('flex')
  tunerModalElement.setAttribute('aria-hidden', 'false')
  document.body.classList.add('overflow-hidden')
  closeTunerButtonElement.focus()

  try {
    await startTuner()
  } catch (error: unknown) {
    if (tunerModalElement.hidden || tunerModalElement.classList.contains('hidden')) {
      return
    }
    const message = error instanceof Error ? error.message : 'Mikrofona erişilemedi.'
    tunerErrorElement.textContent = message
    tunerErrorElement.classList.remove('hidden')
    resetTunerReadout('Mikrofon izni gerekli')
    await stopTunerAudio()
  }
}

function getMidi(step: string, alter: number | undefined, octave: number): number {
  const semitone = semitonesByStep[step]

  if (semitone === undefined) {
    throw new Error(`Desteklenmeyen nota basamağı: ${step}`)
  }

  const accidental = alter ?? 0
  if (!Number.isInteger(accidental)) {
    throw new Error('Yarım ses dışındaki alter değerleri desteklenmiyor.')
  }

  return (octave + 1) * 12 + semitone + accidental
}

function getMonophonicNotes(xml: string) {
  const score = parse(xml)
  const firstPart = score.parts[0]

  if (!firstPart) {
    throw new Error('MusicXML dosyasında part bulunamadı.')
  }

  const notes: NoteModel[] = []
  let divisions = 1
  let beatsPerMeasure = 4
  let measureStartBeats = 0

  for (const measure of firstPart.measures) {
    let cursorBeats = 0
    let measureEndBeats = 0
    let previousNoteStartBeats = 0

    const applyAttributes = (attributes: {
      divisions?: number
      time?: {
        beats: string
        beatType: number
        beatsList?: number[]
        beatTypeList?: number[]
      }
    }) => {
      if (attributes.divisions !== undefined) {
        divisions = attributes.divisions
      }
      if (attributes.time) {
        const beatGroups =
          attributes.time.beatsList ??
          attributes.time.beats.split('+').map((beats) => Number(beats))
        beatsPerMeasure = beatGroups.reduce((total, beats, index) => {
          const beatType =
            attributes.time?.beatTypeList?.[index] ?? attributes.time?.beatType
          if (!Number.isFinite(beats) || !beatType || beatType <= 0) {
            throw new Error('MusicXML içinde geçersiz ölçü bilgisi bulundu.')
          }
          return total + (beats * 4) / beatType
        }, 0)
      }
    }

    if (measure.attributes) {
      applyAttributes(measure.attributes)
    }

    for (const entry of measure.entries) {
      if (entry.type === 'attributes') {
        applyAttributes(entry.attributes)
        continue
      }

      if (entry.type === 'backup' || entry.type === 'forward') {
        if (!Number.isFinite(divisions) || divisions <= 0) {
          throw new Error('MusicXML içinde geçersiz divisions değeri bulundu.')
        }
        const durationBeats = entry.duration / divisions
        cursorBeats += entry.type === 'backup' ? -durationBeats : durationBeats
        if (cursorBeats < 0) {
          throw new Error('MusicXML içindeki nota zamanlaması geçersiz.')
        }
        measureEndBeats = Math.max(measureEndBeats, cursorBeats)
        continue
      }

      if (entry.type !== 'note') {
        continue
      }

      if (!Number.isFinite(divisions) || divisions <= 0) {
        throw new Error('MusicXML içinde geçersiz divisions değeri bulundu.')
      }

      const durationBeats = entry.duration / divisions
      if (!Number.isFinite(durationBeats) || durationBeats < 0) {
        throw new Error('MusicXML içinde geçersiz nota süresi bulundu.')
      }

      const noteStartBeats = entry.chord ? previousNoteStartBeats : cursorBeats
      if (!entry.chord) {
        previousNoteStartBeats = cursorBeats
      }

      if (entry.pitch) {
        if (durationBeats === 0) {
          throw new Error('Süresiz veya grace notalar desteklenmiyor.')
        }

        notes.push({
          midi: getMidi(entry.pitch.step, entry.pitch.alter, entry.pitch.octave),
          startBeats: measureStartBeats + noteStartBeats,
          durationBeats,
        })
      }

      if (!entry.chord) {
        cursorBeats += durationBeats
      }
      measureEndBeats = Math.max(
        measureEndBeats,
        cursorBeats,
        noteStartBeats + durationBeats,
      )
    }

    const measureLength = measure.implicit
      ? measureEndBeats
      : Math.max(measureEndBeats, beatsPerMeasure)
    measureStartBeats += measureLength
  }

  const melodyNotesByStart = new Map<number, NoteModel>()
  for (const note of notes) {
    const current = melodyNotesByStart.get(note.startBeats)
    if (!current || note.midi > current.midi) {
      melodyNotesByStart.set(note.startBeats, note)
    }
  }

  const melodyNotes = [...melodyNotesByStart.values()].sort(
    (a, b) => a.startBeats - b.startBeats,
  )

  if (melodyNotes.length === 0) {
    throw new Error('MusicXML içinden hiç nota okunamadı.')
  }

  return melodyNotes
}

function renderMusicXml(xml: string): void {
  const notes = getMonophonicNotes(xml)
  const tabData: TabData = generateTab({
    notes,
    tuning: Tuning.standardGuitar(),
  }).data
  const hasTabNotes = tabData.measures.some((measure) =>
    measure.events.some((event) => (event.notes?.length ?? 0) > 0),
  )
  if (!hasTabNotes) {
    throw new Error(
      'Notalar okundu ancak gitar tabına dönüştürülecek geçerli bir melodi bulunamadı.',
    )
  }

  const { tex: alphaTex } = toAlphaTex(tabData)

  console.log('ALPHATAB TEX:', alphaTex)
  tabContainerElement.textContent = ''
  if (!alphaTabApi) {
    alphaTabApi = new AlphaTabApi(tabContainerElement, {
      display: {
        staveProfile: showSheetMusicElement.checked
          ? StaveProfile.ScoreTab
          : StaveProfile.Tab,
      },
      core: {
        tex: true,
        fontDirectory: '/font/',
      },
      player: {
        enablePlayer: false,
        soundFont: '/soundfont/sonivox.sf2',
      },
    })
    alphaTabApi.renderFinished.on(() => {
      if (currentMusicXML) {
        downloadPanelElement.classList.remove('hidden')
      }
    })
  } else {
    alphaTabApi.settings.display.staveProfile = showSheetMusicElement.checked
      ? StaveProfile.ScoreTab
      : StaveProfile.Tab
    alphaTabApi.updateSettings()
  }
  currentMusicXML = xml
  alphaTabApi.tex(alphaTex)
}

function showLoadingState(): void {
  tabContainerElement.innerHTML = `
    <div class="relative isolate flex min-h-[560px] flex-col items-center justify-center gap-5 overflow-hidden text-center" role="status" aria-live="polite">
      <span class="animate-spin text-6xl text-purple-600" aria-hidden="true">𝄞</span>
      <p class="text-base font-medium text-slate-700">Notalar analiz ediliyor...</p>
    </div>
  `
}

async function processFile(file: File): Promise<void> {
  showLoadingState()
  currentMusicXML = ''
  downloadPanelElement.classList.add('hidden')
  try {
    if (file.size > maxFileSize) {
      throw new Error('Dosya boyutu 10MB sınırını aşamaz.')
    }

    const extension = file.name.split('.').pop()?.toLowerCase()

    if (extension === 'xml' || extension === 'musicxml') {
      renderMusicXml(await readFileAsText(file))
      uploadStatusElement.textContent = `${file.name} başarıyla dönüştürüldü.`
      return
    }

    if (!['pdf', 'jpg', 'jpeg', 'png'].includes(extension ?? '')) {
      throw new Error('Desteklenmeyen dosya türü. JPG, PNG, PDF veya MusicXML seçin.')
    }

    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch('/api/convert', {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const responseBody = await response.text()
      let message = responseBody || `Dönüştürme sunucusu hata döndürdü (${response.status}).`
      try {
        const errorResult: unknown = JSON.parse(responseBody)
        if (
          typeof errorResult === 'object' &&
          errorResult !== null &&
          'error' in errorResult &&
          typeof errorResult.error === 'string'
        ) {
          message = errorResult.error
        }
      } catch {
        // The server may return a plain-text error message.
      }
      throw new Error(message)
    }

    const result: unknown = await response.json()
    if (
      typeof result !== 'object' ||
      result === null ||
      !('musicxml' in result) ||
      typeof result.musicxml !== 'string'
    ) {
      throw new Error('Sunucudan geçerli bir MusicXML yanıtı alınamadı.')
    }

    renderMusicXml(result.musicxml)
    uploadStatusElement.textContent = `${file.name} başarıyla dönüştürüldü.`
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu.'
    uploadStatusElement.textContent = message
    tabContainerElement.textContent = `HATA: ${message}`
    console.error(error)
    settingsPanelElement.classList.remove('hidden')
    settingsPanelElement.hidden = false
    uploadStatusElement.setAttribute('role', 'alert')
  } finally {
    uploadPanelElement.classList.remove('hidden')
    convertButtonElement.disabled = false
  }
}

function stageFile(file: File): void {
  selectedFile = file
  selectedFileNameElement.textContent = file.name
  uploadStatusElement.textContent = ''
  uploadStatusElement.removeAttribute('role')
  settingsPanelElement.classList.remove('hidden')
  settingsPanelElement.hidden = false
}

fileInputElement.addEventListener('change', () => {
  const file = fileInputElement.files?.[0]
  if (file) {
    stageFile(file)
  }
})

document.addEventListener('paste', (event: ClipboardEvent) => {
  const imageFile = Array.from(event.clipboardData?.files ?? []).find((file) =>
    file.type.startsWith('image/'),
  )

  if (imageFile) {
    event.preventDefault()
    stageFile(imageFile)
  }
})

convertButtonElement.addEventListener('click', () => {
  if (!selectedFile) {
    uploadStatusElement.textContent = 'Önce dönüştürülecek bir dosya seçin.'
    uploadStatusElement.setAttribute('role', 'alert')
    return
  }

  settingsPanelElement.classList.add('hidden')
  settingsPanelElement.hidden = true
  uploadPanelElement.classList.add('hidden')
  resultsPanelElement.classList.remove('hidden')
  resultsPanelElement.hidden = false
  tabContainerElement.classList.remove('hidden')
  tabContainerElement.hidden = false
  uploadStatusElement.textContent = `${selectedFile.name} dönüştürülüyor...`
  convertButtonElement.disabled = true
  void processFile(selectedFile)
})

downloadXmlButtonElement.addEventListener('click', () => {
  if (!currentMusicXML) {
    uploadStatusElement.textContent = 'İndirilecek MusicXML bulunamadı.'
    uploadStatusElement.setAttribute('role', 'alert')
    return
  }

  const blob = new Blob([currentMusicXML], { type: 'application/xml' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'tab-export.musicxml'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
})

downloadPdfButtonElement.addEventListener('click', () => {
  if (!alphaTabApi || !currentMusicXML) {
    uploadStatusElement.textContent = 'Yazdırılacak bir gitar tabı bulunamadı.'
    uploadStatusElement.setAttribute('role', 'alert')
    return
  }

  alphaTabApi.print()
})

const clearDropHighlight = () => {
  uploadAreaElement.classList.remove('border-violet-600', 'bg-violet-50')
}

openTunerButtonElement.addEventListener('click', () => {
  void openTuner().catch((error: unknown) => {
    console.error('Akort cihazı başlatılamadı.', error)
  })
})

closeTunerButtonElement.addEventListener('click', () => {
  void closeTuner().catch((error: unknown) => {
    console.error('Akort cihazı kapatılırken mikrofon temizlenemedi.', error)
  })
})

tunerModalElement.addEventListener('click', (event: MouseEvent) => {
  if (event.target === tunerModalElement) {
    void closeTuner().catch((error: unknown) => {
      console.error('Akort cihazı kapatılırken mikrofon temizlenemedi.', error)
    })
  }
})

document.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape' && !tunerModalElement.classList.contains('hidden')) {
    void closeTuner().catch((error: unknown) => {
      console.error('Akort cihazı kapatılırken mikrofon temizlenemedi.', error)
    })
  }
})

uploadAreaElement.addEventListener('dragenter', (event: DragEvent) => {
  event.preventDefault()
  uploadAreaElement.classList.add('border-violet-600', 'bg-violet-50')
})

uploadAreaElement.addEventListener('dragover', (event: DragEvent) => {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
})

uploadAreaElement.addEventListener('dragleave', (event: DragEvent) => {
  if (!event.relatedTarget || !uploadAreaElement.contains(event.relatedTarget as Node)) {
    clearDropHighlight()
  }
})

uploadAreaElement.addEventListener('drop', (event: DragEvent) => {
  event.preventDefault()
  clearDropHighlight()
  const file = event.dataTransfer?.files[0]
  if (file) {
    stageFile(file)
  }
})
