import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import Editor from '@monaco-editor/react'
import { X, GitCompare } from 'lucide-react'
import { computeLineDiff } from './diffUtils'

/**
 * Build aligned content for WinMerge-style side-by-side diff.
 * Inserts padding lines so that matching lines appear at the same row.
 * Returns { leftLines, rightLines, lineMap } where lineMap tracks each row's type.
 */
function buildAlignedDiff(oldContent, newContent) {
  const oldLines = (oldContent || '').split('\n')
  const newLines = (newContent || '').split('\n')

  if (oldLines.length === 0 && newLines.length === 0) {
    return { leftText: '', rightText: '', lineMap: [], stats: { added: 0, removed: 0 } }
  }

  const { oldStatus, newStatus } = computeLineDiff(oldLines, newLines)

  // Walk both arrays in parallel to build aligned rows
  const rows = [] // { type, leftLine, rightLine, leftNum, rightNum }
  let oi = 0, ni = 0

  while (oi < oldLines.length || ni < newLines.length) {
    if (oi < oldLines.length && oldStatus[oi] === 'removed') {
      // Deleted line — show on left, padding on right
      rows.push({ type: 'removed', leftLine: oldLines[oi], rightLine: '', leftNum: oi + 1, rightNum: null })
      oi++
    } else if (ni < newLines.length && newStatus[ni] === 'added') {
      // Added line — padding on left, show on right
      rows.push({ type: 'added', leftLine: '', rightLine: newLines[ni], leftNum: null, rightNum: ni + 1 })
      ni++
    } else if (oi < oldLines.length && ni < newLines.length) {
      // Unchanged — show on both
      rows.push({ type: 'unchanged', leftLine: oldLines[oi], rightLine: newLines[ni], leftNum: oi + 1, rightNum: ni + 1 })
      oi++; ni++
    } else if (oi < oldLines.length) {
      rows.push({ type: 'removed', leftLine: oldLines[oi], rightLine: '', leftNum: oi + 1, rightNum: null })
      oi++
    } else {
      rows.push({ type: 'added', leftLine: '', rightLine: newLines[ni], leftNum: null, rightNum: ni + 1 })
      ni++
    }
  }

  const leftText = rows.map(r => r.leftLine).join('\n')
  const rightText = rows.map(r => r.rightLine).join('\n')

  return {
    leftText,
    rightText,
    lineMap: rows,
    stats: {
      added: rows.filter(r => r.type === 'added').length,
      removed: rows.filter(r => r.type === 'removed').length,
    }
  }
}

export default function DiffViewer({ oldContent, newContent, fileName, onClose }) {
  const [editorsReady, setEditorsReady] = useState({ old: false, new: false })
  const oldEditorRef = useRef(null)
  const newEditorRef = useRef(null)
  const oldMonacoRef = useRef(null)
  const newMonacoRef = useRef(null)
  const isSyncing = useRef(false)
  const oldDecorationsRef = useRef([])
  const newDecorationsRef = useRef([])
  const locationPaneRef = useRef(null)

  const bothReady = editorsReady.old && editorsReady.new

  // Build aligned diff content
  const aligned = useMemo(() => buildAlignedDiff(oldContent, newContent), [oldContent, newContent])

  // Apply decorations when editors are ready
  useEffect(() => {
    if (!bothReady) return

    const applyDecorations = () => {
      const oldEditor = oldEditorRef.current
      const newEditor = newEditorRef.current
      const monaco = oldMonacoRef.current
      if (!oldEditor || !newEditor || !monaco) return

      const oldDecos = []
      const newDecos = []

      aligned.lineMap.forEach((row, i) => {
        const line = i + 1
        if (row.type === 'removed') {
          oldDecos.push({
            range: new monaco.Range(line, 1, line, 1),
            options: { isWholeLine: true, className: 'diff-line-removed', glyphMarginClassName: 'diff-glyph-removed' }
          })
          newDecos.push({
            range: new monaco.Range(line, 1, line, 1),
            options: { isWholeLine: true, className: 'diff-line-padding' }
          })
        } else if (row.type === 'added') {
          oldDecos.push({
            range: new monaco.Range(line, 1, line, 1),
            options: { isWholeLine: true, className: 'diff-line-padding' }
          })
          newDecos.push({
            range: new monaco.Range(line, 1, line, 1),
            options: { isWholeLine: true, className: 'diff-line-added', glyphMarginClassName: 'diff-glyph-added' }
          })
        }
      })

      oldDecorationsRef.current = oldEditor.deltaDecorations(oldDecorationsRef.current, oldDecos)
      newDecorationsRef.current = newEditor.deltaDecorations(newDecorationsRef.current, newDecos)
    }

    applyDecorations()
    const t = setTimeout(applyDecorations, 300)
    return () => clearTimeout(t)
  }, [bothReady, aligned])

  // Synchronized scrolling
  useEffect(() => {
    if (!bothReady) return
    const oldEditor = oldEditorRef.current
    const newEditor = newEditorRef.current
    if (!oldEditor || !newEditor) return

    const d1 = oldEditor.onDidScrollChange((e) => {
      if (isSyncing.current) return
      isSyncing.current = true
      newEditor.setScrollTop(e.scrollTop)
      newEditor.setScrollLeft(e.scrollLeft)
      updateLocationPaneViewport(e.scrollTop, oldEditor)
      isSyncing.current = false
    })

    const d2 = newEditor.onDidScrollChange((e) => {
      if (isSyncing.current) return
      isSyncing.current = true
      oldEditor.setScrollTop(e.scrollTop)
      oldEditor.setScrollLeft(e.scrollLeft)
      updateLocationPaneViewport(e.scrollTop, oldEditor)
      isSyncing.current = false
    })

    return () => { d1.dispose(); d2.dispose() }
  }, [bothReady])

  // Resize canvas to match container and draw location pane
  useEffect(() => {
    if (!bothReady) return
    const canvas = locationPaneRef.current
    if (canvas) {
      const resizeObserver = new ResizeObserver(() => {
        const rect = canvas.parentElement.getBoundingClientRect()
        canvas.width = 42
        canvas.height = Math.round(rect.height)
        drawLocationPane()
      })
      resizeObserver.observe(canvas.parentElement)
      // Initial draw
      const rect = canvas.parentElement.getBoundingClientRect()
      canvas.width = 42
      canvas.height = Math.round(rect.height)
      drawLocationPane()
      return () => resizeObserver.disconnect()
    }
  }, [bothReady, aligned, drawLocationPane])

  const drawLocationPane = useCallback(() => {
    const canvas = locationPaneRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const h = canvas.height
    const w = canvas.width
    const total = aligned.lineMap.length

    ctx.fillStyle = '#1b1c1e'
    ctx.fillRect(0, 0, w, h)

    if (total === 0) return

    // Draw a 1px border on the left
    ctx.fillStyle = '#2a2b2f'
    ctx.fillRect(0, 0, 1, h)

    // Draw change markers
    for (let i = 0; i < total; i++) {
      const row = aligned.lineMap[i]
      if (row.type === 'unchanged') continue

      const y = Math.round((i / total) * h)
      const blockH = Math.max(2, Math.round(h / total))

      if (row.type === 'removed') {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.7)'
      } else if (row.type === 'added') {
        ctx.fillStyle = 'rgba(34, 197, 94, 0.7)'
      }
      ctx.fillRect(2, y, w - 3, blockH)
    }
  }, [aligned])

  const updateLocationPaneViewport = useCallback((scrollTop, editor) => {
    const canvas = locationPaneRef.current
    if (!canvas || !editor) return

    // Redraw the base
    drawLocationPane()

    const ctx = canvas.getContext('2d')
    const h = canvas.height
    const w = canvas.width
    const total = aligned.lineMap.length
    if (total === 0) return

    // Draw viewport indicator
    const lineHeight = editor.getOption(/* lineHeight */ 66) || 19
    const visibleLines = Math.floor(editor.getLayoutInfo().height / lineHeight)
    const topLine = Math.floor(scrollTop / lineHeight)

    const viewTop = Math.round((topLine / total) * h)
    const viewH = Math.max(8, Math.round((visibleLines / total) * h))

    ctx.strokeStyle = 'rgba(74, 222, 128, 0.5)'
    ctx.lineWidth = 1
    ctx.strokeRect(1, viewTop, w - 2, viewH)
  }, [aligned, drawLocationPane])

  // Click on location pane to scroll
  const handleLocationPaneClick = useCallback((e) => {
    const canvas = locationPaneRef.current
    const editor = oldEditorRef.current
    if (!canvas || !editor) return

    const rect = canvas.getBoundingClientRect()
    const y = e.clientY - rect.top
    const ratio = y / rect.height
    const targetLine = Math.floor(ratio * aligned.lineMap.length) + 1

    editor.revealLineInCenter(targetLine)
  }, [aligned])

  const defineTheme = useCallback((monaco) => {
    monaco.editor.defineTheme('neu-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#1b1c1e',
        'editor.lineHighlightBackground': '#22242700',
        'editorLineNumber.foreground': '#4a4b4f',
        'editorLineNumber.activeForeground': '#4ade80',
        'scrollbarSlider.background': '#3a3b3f88',
        'scrollbarSlider.hoverBackground': '#4a4b4faa',
      }
    })
  }, [])

  // Custom line number functions — show original line numbers, empty for padding
  const leftLineNumbers = useCallback((lineNumber) => {
    const row = aligned.lineMap[lineNumber - 1]
    if (!row || row.leftNum == null) return ' '
    return String(row.leftNum)
  }, [aligned])

  const rightLineNumbers = useCallback((lineNumber) => {
    const row = aligned.lineMap[lineNumber - 1]
    if (!row || row.rightNum == null) return ' '
    return String(row.rightNum)
  }, [aligned])

  const leftOptions = useMemo(() => ({
    readOnly: true,
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    wrappingStrategy: 'advanced',
    lineNumbers: leftLineNumbers,
    renderWhitespace: 'all',
    padding: { top: 12 },
    glyphMargin: true,
    folding: false,
    scrollbar: { vertical: 'visible', horizontal: 'visible', verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  }), [leftLineNumbers])

  const rightOptions = useMemo(() => ({
    readOnly: true,
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    wrappingStrategy: 'advanced',
    lineNumbers: rightLineNumbers,
    renderWhitespace: 'all',
    padding: { top: 12 },
    glyphMargin: true,
    folding: false,
    scrollbar: { vertical: 'visible', horizontal: 'visible', verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  }), [rightLineNumbers])

  const language = getLanguage(fileName)

  const handleOldMount = useCallback((editor, monaco) => {
    oldEditorRef.current = editor
    oldMonacoRef.current = monaco
    setEditorsReady(prev => ({ ...prev, old: true }))
  }, [])

  const handleNewMount = useCallback((editor, monaco) => {
    newEditorRef.current = editor
    newMonacoRef.current = monaco
    setEditorsReady(prev => ({ ...prev, new: true }))
  }, [])

  return (
    <div className="fixed inset-0 z-[60] flex flex-col backdrop-animate"
         style={{ backgroundColor: 'rgba(10, 10, 14, 0.95)', backdropFilter: 'blur(10px)' }}>

      {/* Diff decoration styles */}
      <style>{`
        .diff-line-removed { background: rgba(239, 68, 68, 0.12) !important; }
        .diff-line-added { background: rgba(34, 197, 94, 0.12) !important; }
        .diff-line-padding { background: rgba(100, 100, 100, 0.06) !important; }
        .diff-glyph-removed { background: rgba(239, 68, 68, 0.6); width: 3px !important; margin-left: 3px; }
        .diff-glyph-added { background: rgba(34, 197, 94, 0.6); width: 3px !important; margin-left: 3px; }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#2a2b2f]">
        <div className="flex items-center gap-3">
          <GitCompare size={16} className="text-[#4ade80]" />
          <span className="text-sm font-bold text-[#4ade80]">Compare</span>
          <span className="text-xs text-[#9ca3af] font-mono">{fileName}</span>
          <div className="flex items-center gap-2 ml-3">
            {aligned.stats.removed > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-medium">
                −{aligned.stats.removed}
              </span>
            )}
            {aligned.stats.added > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
                +{aligned.stats.added}
              </span>
            )}
          </div>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-[#272a2d] transition-colors">
          <X size={16} className="text-[#9ca3af]" />
        </button>
      </div>

      {/* Labels */}
      <div className="flex border-b border-[#2a2b2f]">
        <div className="flex-1 px-5 py-1.5 text-[10px] uppercase tracking-widest text-rose-400/70 font-medium border-r border-[#2a2b2f]">
          Old Version
        </div>
        <div className="flex-1 px-5 py-1.5 text-[10px] uppercase tracking-widest text-emerald-400/70 font-medium">
          New Version
        </div>
        {/* Location pane label space */}
        <div className="w-[42px] border-l border-[#2a2b2f]" />
      </div>

      {/* Editors + Location Pane */}
      <div className="flex-1 min-h-0 relative flex">
        {/* Loading overlay */}
        {!bothReady && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4"
               style={{ backgroundColor: '#1b1c1e' }}>
            <div className="relative w-14 h-14">
              <div className="absolute inset-0 rounded-full border-2 border-[#2a2b2f]" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#4ade80] animate-spin" />
              <div className="absolute inset-2 rounded-full border-2 border-transparent border-t-[#4ade80]/50 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
              <div className="absolute inset-0 flex items-center justify-center">
                <GitCompare size={16} className="text-[#4ade80]" />
              </div>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-[#e0e0e0]">Loading diff editor...</p>
              <p className="text-[10px] text-[#6b7280] mt-1">Initializing Monaco Editor</p>
            </div>
          </div>
        )}

        {/* Left (old) editor */}
        <div className="flex-1 min-w-0 border-r border-[#2a2b2f]">
          <Editor
            value={aligned.leftText}
            language={language}
            theme="neu-dark"
            beforeMount={defineTheme}
            onMount={handleOldMount}
            options={leftOptions}
          />
        </div>

        {/* Right (new) editor */}
        <div className="flex-1 min-w-0">
          <Editor
            value={aligned.rightText}
            language={language}
            theme="neu-dark"
            beforeMount={defineTheme}
            onMount={handleNewMount}
            options={rightOptions}
          />
        </div>

        {/* Location Pane (WinMerge-style minimap) */}
        <div className="w-[42px] flex-shrink-0 border-l border-[#2a2b2f] cursor-pointer"
             style={{ backgroundColor: '#1b1c1e' }}
             onClick={handleLocationPaneClick}>
          <canvas
            ref={locationPaneRef}
            width={42}
            height={800}
            className="w-full h-full"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>
      </div>
    </div>
  )
}

function getLanguage(filename) {
  if (!filename) return 'plaintext'
  const ext = filename.split('.').pop()?.toLowerCase()
  const map = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    java: 'java', py: 'python', sql: 'sql', xml: 'xml', html: 'html',
    htm: 'html', xhtml: 'html', css: 'css', scss: 'scss', less: 'less',
    json: 'json', yml: 'yaml', yaml: 'yaml', sh: 'shell', bash: 'shell',
    bat: 'bat', cmd: 'bat', ps1: 'powershell',
    properties: 'ini', cfg: 'ini', ini: 'ini', conf: 'ini',
    txt: 'plaintext', log: 'plaintext', csv: 'plaintext',
    md: 'markdown', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp',
    cs: 'csharp', rb: 'ruby', go: 'go', rs: 'rust',
    php: 'php', swift: 'swift', kt: 'kotlin', kts: 'kotlin',
    groovy: 'groovy', gradle: 'groovy', scala: 'scala',
    r: 'r', lua: 'lua', perl: 'perl', pl: 'perl',
    jsp: 'html', jspx: 'xml', jsf: 'xml', xsl: 'xml', xslt: 'xml',
    wsdl: 'xml', xsd: 'xml', pom: 'xml', dtd: 'xml',
    dockerfile: 'dockerfile', tf: 'hcl',
  }
  return map[ext] || 'plaintext'
}
